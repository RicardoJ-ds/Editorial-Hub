"""Exact Python ports of the frontend math — the warehouse "brain".

Every function here is a line-faithful port of the TypeScript the dashboards
run today (file:line refs on each). BUG-FOR-BUG: where the frontend has quirks
(see WAREHOUSE_DESIGN.md bug register) we replicate them, because the goal of
this branch is byte-identical numbers. The parity harness re-runs the REAL
TS functions (frontend/scripts/parity-dump.ts) and diffs against these ports.

JS semantics notes:
- Math.round = floor(x + 0.5)  (NOT banker's rounding) → js_round().
- "today" anchors: the dashboards use the browser clock; builders pass
  as_of = date.today() so a same-day parity run matches.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from datetime import date


def js_round(x: float) -> int:
    """JavaScript Math.round: half-up, incl. negatives (-0.5 → 0)."""
    return int(math.floor(x + 0.5))


def cell_of(year: int, month: int) -> int:
    """Month ordinal — `y * 12 + (m - 1)` everywhere in the frontend."""
    return year * 12 + (month - 1)


def last_completed_calendar_month(as_of: date) -> tuple[int, int]:
    """`new Date(y, m-1, 1)` — the previous calendar month (year, month)."""
    y, m = as_of.year, as_of.month - 1
    if m == 0:
        y, m = y - 1, 12
    return y, m


# ──────────────────────────────────────────────────────────────────────────────
# contentTypeRatio — shared-helpers.tsx:254-278
# NOTE (bug register B1): NO glossary branch in code; unknown types fall to the
# ratios "a:b" string, then ×1. Replicated exactly.
# ──────────────────────────────────────────────────────────────────────────────

def content_type_ratio(content_type: str | None, ratios: str | None = None) -> float:
    if content_type:
        t = content_type.strip().lower()
        if t in ("article", "articles"):
            return 1.0
        if t == "jumbo":
            return 2.0
        if t in ("lp", "landing page", "landing pages"):
            return 0.5
    if ratios:
        m = re.match(r"^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$", ratios)
        if m:
            a, b = float(m.group(1)), float(m.group(2))
            if b > 0:
                return a / b
    return 1.0


# ──────────────────────────────────────────────────────────────────────────────
# varianceTier — shared-helpers.tsx:409-437 (classifies on js_round(v))
# ──────────────────────────────────────────────────────────────────────────────

VARIANCE_WITHIN_LIMIT = 5


def variance_tier(variance: float, is_new: bool = False) -> str:
    if is_new:
        return "new"
    v = js_round(variance)
    if v == 0:
        return "on_track"
    if abs(v) <= VARIANCE_WITHIN_LIMIT:
        return "within_limit"
    return "ahead" if v > 0 else "behind"


# ──────────────────────────────────────────────────────────────────────────────
# buildLifetimeSummaries — frontend/src/lib/overviewSummary.ts:12-72
# Input month rows: dicts {year, month, delivered, invoiced} per client.
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class LifetimeSummary:
    delivered: int
    invoiced: int
    sow: int
    variance: int
    pct_complete: int
    monthly_breakdown: list[dict]  # {year, month, delivered, invoiced, is_future}


def build_lifetime_summary(
    month_rows: list[dict], articles_sow: int | None, as_of: date
) -> LifetimeSummary:
    lc_y, lc_m = last_completed_calendar_month(as_of)
    lc_cell = cell_of(lc_y, lc_m)

    delivered = 0
    invoiced = 0
    breakdown: list[dict] = []
    for r in sorted(month_rows, key=lambda r: (r["year"], r["month"])):
        past = cell_of(r["year"], r["month"]) <= lc_cell
        d = r.get("delivered") or 0
        i = r.get("invoiced") or 0
        if past:
            delivered += d
            invoiced += i
        breakdown.append(
            {"year": r["year"], "month": r["month"], "delivered": d, "invoiced": i,
             "is_future": not past}
        )
    sow = articles_sow or 0
    return LifetimeSummary(
        delivered=delivered,
        invoiced=invoiced,
        sow=sow,
        variance=delivered - invoiced,
        pct_complete=js_round(delivered / sow * 100) if sow > 0 else 0,
        monthly_breakdown=breakdown,
    )


# ──────────────────────────────────────────────────────────────────────────────
# Billing periods — BOTH detectors (they diverge; bug register B3)
#   detectSummaryBillingPeriods — DeliveryOverviewCards.tsx:1059-1117 (Overview)
#   detectBillingPeriods       — ClientDeliveryCards.tsx:170-307 (D1, with
#                                post-contract truncation for finished clients)
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class BillingPeriod:
    q_idx: int
    label: str
    start_year: int
    start_month: int
    end_year: int
    end_month: int
    months: list[dict] = field(default_factory=list)
    invoiced_q: int = 0
    is_prelude: bool = False
    is_post_contract: bool = False


def _label_periods(raw: list[BillingPeriod], start_date: date | None) -> list[BillingPeriod]:
    start_year = start_date.year if start_date else None
    start_month = start_date.month if start_date else None
    prev_year_idx = -1
    q_in_year = 0
    for idx, p in enumerate(raw):
        p.q_idx = idx
        skip = p.is_prelude or p.is_post_contract
        if not skip and start_year is not None and start_month is not None:
            mi = (p.start_year - start_year) * 12 + (p.start_month - start_month) + 1
            year_idx = math.floor((mi - 1) / 12) if mi >= 1 else 0
            if year_idx != prev_year_idx:
                q_in_year = 0
                prev_year_idx = year_idx
            q_in_year += 1
            p.label = f"Q{q_in_year}" if year_idx == 0 else f"Q{q_in_year} Y{year_idx + 1}"
        elif not skip:
            q_in_year += 1
            p.label = f"Q{q_in_year}"
        else:
            p.label = ""
    return raw


def detect_summary_billing_periods(
    monthly_breakdown: list[dict], start_date: date | None
) -> list[BillingPeriod]:
    """Overview variant — no post-contract handling."""
    if not monthly_breakdown:
        return []
    sorted_rows = sorted(monthly_breakdown, key=lambda r: (r["year"], r["month"]))
    raw: list[BillingPeriod] = []
    cur: BillingPeriod | None = None
    prelude: BillingPeriod | None = None
    for r in sorted_rows:
        if (r.get("invoiced") or 0) > 0:
            if prelude is not None:
                raw.append(prelude)
                prelude = None
            if cur is not None:
                raw.append(cur)
            cur = BillingPeriod(0, "", r["year"], r["month"], r["year"], r["month"],
                                [r], r["invoiced"], False, False)
        elif cur is not None:
            cur.end_year, cur.end_month = r["year"], r["month"]
            cur.months.append(r)
        elif prelude is not None:
            prelude.end_year, prelude.end_month = r["year"], r["month"]
            prelude.months.append(r)
        else:
            prelude = BillingPeriod(0, "", r["year"], r["month"], r["year"], r["month"],
                                    [r], 0, True, False)
    if cur is not None:
        raw.append(cur)
    if prelude is not None:
        raw.append(prelude)
    return _label_periods(raw, start_date)


def detect_d1_billing_periods(
    monthly_breakdown: list[dict],
    start_date: date | None,
    end_date: date | None,
    status: str | None,
) -> list[BillingPeriod]:
    """D1 variant — post-contract truncation for finished clients."""
    if not monthly_breakdown:
        return []
    sorted_rows = sorted(monthly_breakdown, key=lambda r: (r["year"], r["month"]))
    is_finished = status in ("COMPLETED", "INACTIVE", "PAUSED")
    enforce_post = is_finished and end_date is not None
    end_y = end_date.year if end_date else None
    end_m = end_date.month if end_date else None

    def is_post(y: int, m: int) -> bool:
        if not enforce_post:
            return False
        return y > end_y or (y == end_y and m > end_m)

    raw: list[BillingPeriod] = []
    cur: BillingPeriod | None = None
    prelude: BillingPeriod | None = None
    for r in sorted_rows:
        if is_post(r["year"], r["month"]):
            if prelude is not None:
                raw.append(prelude)
                prelude = None
            if cur is not None:
                raw.append(cur)
                cur = None
            if (r.get("invoiced") or 0) == 0 and (r.get("delivered") or 0) == 0:
                continue
            raw.append(BillingPeriod(0, "", r["year"], r["month"], r["year"], r["month"],
                                     [r], r.get("invoiced") or 0, False, True))
            continue
        if (r.get("invoiced") or 0) > 0:
            if prelude is not None:
                raw.append(prelude)
                prelude = None
            if cur is not None:
                raw.append(cur)
            cur = BillingPeriod(0, "", r["year"], r["month"], r["year"], r["month"],
                                [r], r["invoiced"], False, False)
        elif cur is not None:
            cur.end_year, cur.end_month = r["year"], r["month"]
            cur.months.append(r)
        elif prelude is not None:
            prelude.end_year, prelude.end_month = r["year"], r["month"]
            prelude.months.append(r)
        else:
            prelude = BillingPeriod(0, "", r["year"], r["month"], r["year"], r["month"],
                                    [r], 0, True, False)
    if cur is not None:
        raw.append(cur)
    if prelude is not None:
        raw.append(prelude)
    return _label_periods(raw, start_date)


# ──────────────────────────────────────────────────────────────────────────────
# computeCurrentQ — DeliveryOverviewCards.tsx:1613-1671
# computeLastFullQ — DeliveryOverviewCards.tsx:1674-1740
# ──────────────────────────────────────────────────────────────────────────────

def compute_current_q(periods: list[BillingPeriod], as_of: date) -> dict | None:
    if not periods:
        return None
    today_y, today_m = as_of.year, as_of.month
    today_cell = cell_of(today_y, today_m)

    cum_delivered = 0
    cum_invoiced = 0
    for p in periods:
        cum_invoiced += p.invoiced_q
        for m in p.months:
            if not m.get("is_future", False):
                cum_delivered += m.get("delivered") or 0
        if p.is_prelude:
            continue
        start_cell = cell_of(p.start_year, p.start_month)
        end_cell = cell_of(p.end_year, p.end_month)
        if start_cell <= today_cell <= end_cell:
            projected_remaining = 0
            month_in_q = 0
            for i, m in enumerate(p.months):
                if m.get("is_future", False):
                    projected_remaining += m.get("delivered") or 0
                if m["year"] == today_y and m["month"] == today_m:
                    month_in_q = i + 1
            if month_in_q == 0:
                month_in_q = max(1, today_cell - start_cell + 1)
            projected_end = cum_delivered + projected_remaining
            return {
                "label": p.label,
                "delivered": cum_delivered,
                "projected_remaining": projected_remaining,
                "projected_end": projected_end,
                "invoiced": cum_invoiced,
                "projected_variance": projected_end - cum_invoiced,
                "month_in_q": month_in_q,
                "q_length": len(p.months),
            }
    return None


def compute_last_full_q(periods: list[BillingPeriod], as_of: date) -> dict | None:
    if not periods:
        return None
    lc_y, lc_m = last_completed_calendar_month(as_of)
    last_cell = cell_of(lc_y, lc_m)

    last_full: BillingPeriod | None = None
    cum_delivered = 0
    cum_invoiced = 0
    cum_delivered_at = 0
    cum_invoiced_at = 0
    for p in periods:
        for m in p.months:
            if not m.get("is_future", False):
                cum_delivered += m.get("delivered") or 0
        cum_invoiced += p.invoiced_q
        if p.is_prelude:
            continue
        if cell_of(p.end_year, p.end_month) <= last_cell:
            last_full = p
            cum_delivered_at = cum_delivered
            cum_invoiced_at = cum_invoiced
    if last_full is None:
        return None
    delivered = sum(
        (m.get("delivered") or 0) for m in last_full.months if not m.get("is_future", False)
    )
    return {
        "label": last_full.label,
        "delivered": delivered,
        "invoiced": last_full.invoiced_q,
        "cum_delivered": cum_delivered_at,
        "cum_invoiced": cum_invoiced_at,
        "cum_variance": cum_delivered_at - cum_invoiced_at,
        "is_first_q": last_full.label == "Q1",
    }


def is_first_contract_q(periods: list[BillingPeriod], as_of: date) -> bool:
    """isFirstContractQ — DeliveryOverviewCards.tsx:1123-1134."""
    today_cell = cell_of(as_of.year, as_of.month)
    for p in periods:
        if p.is_prelude:
            continue
        if cell_of(p.start_year, p.start_month) <= today_cell <= cell_of(p.end_year, p.end_month):
            return p.label == "Q1"
    return False


# ──────────────────────────────────────────────────────────────────────────────
# quarterMetaFromPeriods — ClientDeliveryCards.tsx:359-431 (D1 twin)
# NOTE: cum_delivered INCLUDES future projections here (unlike computeLastFullQ);
# lastFullQ.delivered sums ALL months incl. future. Bug register B4 — replicated.
# ──────────────────────────────────────────────────────────────────────────────

def quarter_meta_from_periods(periods: list[BillingPeriod], as_of: date) -> dict:
    if not periods:
        return {"current_q": None, "last_full_q": None}
    today_y, today_m = as_of.year, as_of.month
    today_cell = cell_of(today_y, today_m)
    lc_y, lc_m = last_completed_calendar_month(as_of)
    last_cell = cell_of(lc_y, lc_m)

    current_q: dict | None = None
    last_full_q: dict | None = None
    cum_delivered = 0
    cum_delivered_actual = 0
    cum_invoiced = 0
    for p in periods:
        cum_invoiced += p.invoiced_q
        for m in p.months:
            cum_delivered += m.get("delivered") or 0
            if not m.get("is_future", False):
                cum_delivered_actual += m.get("delivered") or 0
        if p.is_prelude or p.is_post_contract:
            continue
        start_cell = cell_of(p.start_year, p.start_month)
        end_cell = cell_of(p.end_year, p.end_month)

        if start_cell <= today_cell <= end_cell:
            delivered_actual = 0
            month_in_q = 0
            for i, m in enumerate(p.months):
                if not m.get("is_future", False):
                    delivered_actual += m.get("delivered") or 0
                if m["year"] == today_y and m["month"] == today_m:
                    month_in_q = i + 1
            current_q = {
                "q_idx": p.q_idx,
                "label": p.label,
                "delivered_actual": delivered_actual,
                "invoiced": p.invoiced_q,
                "month_in_q": month_in_q,
                "q_length": len(p.months),
                "projected_end_cum_delivered": cum_delivered,
                "actual_cum_delivered": cum_delivered_actual,
                "end_of_q_cum_invoiced": cum_invoiced,
                "projected_end_cum_variance": cum_delivered - cum_invoiced,
            }

        if end_cell <= last_cell:
            delivered = sum((m.get("delivered") or 0) for m in p.months)
            last_full_q = {
                "q_idx": p.q_idx,
                "label": p.label,
                "delivered": delivered,
                "invoiced": p.invoiced_q,
                "cum_delivered": cum_delivered,
                "cum_invoiced": cum_invoiced,
                "cum_variance": cum_delivered - cum_invoiced,
            }
    return {"current_q": current_q, "last_full_q": last_full_q}


# ──────────────────────────────────────────────────────────────────────────────
# Goals 3-step aggregation — GoalsVsDeliverySection.tsx:40-148 (step 1+2 feed the
# int table; step 3's goal-gating is replicated in the views/parity).
# ──────────────────────────────────────────────────────────────────────────────

def goals_month_ct_rows(goal_rows: list[dict]) -> list[dict]:
    """Step 1: max-of-week per (client, month_year, content_type) + ratio.
    Input rows = raw goals_vs_delivery dicts. Output = int-table rows with both
    raw and weighted measures (step 2 weighting applied per row; sums happen
    downstream)."""
    per_cmc: dict[tuple, dict] = {}
    for r in goal_rows:
        ct = (r.get("content_type") or "").strip().lower() or "default"
        key = (r["client_name"], r["month_year"], ct)
        e = per_cmc.get(key)
        if e is None:
            e = {
                "client_name": r["client_name"],
                "month_year": r["month_year"],
                "content_type": ct,
                "ratio": content_type_ratio(r.get("content_type"), r.get("ratios")),
                "cb_goal": 0.0,
                "cb_delivered": 0.0,
                "ad_goal": 0.0,
                "ad_delivered": 0.0,
            }
            per_cmc[key] = e
        e["cb_goal"] = max(e["cb_goal"], r.get("cb_monthly_goal") or 0)
        e["ad_goal"] = max(e["ad_goal"], r.get("ad_monthly_goal") or 0)
        e["cb_delivered"] = max(e["cb_delivered"], r.get("cb_delivered_to_date") or 0)
        e["ad_delivered"] = max(e["ad_delivered"], r.get("ad_delivered_to_date") or 0)
    out = []
    for e in per_cmc.values():
        ratio = e["ratio"]
        out.append(
            {
                **e,
                "w_cb_goal": e["cb_goal"] * ratio,
                "w_cb_delivered": e["cb_delivered"] * ratio,
                "w_ad_goal": e["ad_goal"] * ratio,
                "w_ad_delivered": e["ad_delivered"] * ratio,
            }
        )
    return out


def goals_grand_totals(month_ct_rows: list[dict]) -> dict:
    """Steps 2+3 over int rows: weighted (client×month), then per-client sums
    GATED on month goal > 0 (independently for CB and AD), then grand totals.
    Mirrors aggregateGoalsSummary's return (cb/ad goal+del, pcts)."""
    per_cm: dict[tuple, dict] = {}
    for e in month_ct_rows:
        k = (e["client_name"], e["month_year"])
        cm = per_cm.setdefault(k, {"cb_goal": 0.0, "cb_del": 0.0, "ad_goal": 0.0, "ad_del": 0.0})
        cm["cb_goal"] += e["w_cb_goal"]
        cm["cb_del"] += e["w_cb_delivered"]
        cm["ad_goal"] += e["w_ad_goal"]
        cm["ad_del"] += e["w_ad_delivered"]
    per_client: dict[str, dict] = {}
    for (client, _my), cm in per_cm.items():
        c = per_client.setdefault(client, {"cb_goal": 0.0, "cb_del": 0.0, "ad_goal": 0.0, "ad_del": 0.0})
        if cm["cb_goal"] > 0:
            c["cb_goal"] += cm["cb_goal"]
            c["cb_del"] += cm["cb_del"]
        if cm["ad_goal"] > 0:
            c["ad_goal"] += cm["ad_goal"]
            c["ad_del"] += cm["ad_del"]
    cb_goal = sum(c["cb_goal"] for c in per_client.values())
    cb_del = sum(c["cb_del"] for c in per_client.values())
    ad_goal = sum(c["ad_goal"] for c in per_client.values())
    ad_del = sum(c["ad_del"] for c in per_client.values())
    return {
        "cb_goal": cb_goal,
        "cb_delivered": cb_del,
        "ad_goal": ad_goal,
        "ad_delivered": ad_del,
        "cb_pct": js_round(cb_del / cb_goal * 100) if cb_goal > 0 else 0,
        "ad_pct": js_round(ad_del / ad_goal * 100) if ad_goal > 0 else 0,
        "per_client": per_client,
    }
