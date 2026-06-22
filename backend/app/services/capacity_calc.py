"""Pure capacity-utilization math — the single source of truth shared by the
API router (`app/routers/capacity.py`) and the ETL marts (`etl/transform.py`).

Extracted verbatim from the router so the dashboard endpoint and the BigQuery
`editorial_capacity_member_utilization` mart can never drift: both fetch rows
and hand them to these functions. No I/O here — plain data in, dicts out.

Model (verified against Ricardo's sheet, 2026-06-09):
  %allocation   = capacity ÷ pod total capacity            (editorial_member_capacity)
  %distribution = member articles ÷ pod total articles     (article_records)
  projected_used (member) = %allocation × pod RAW projected (production_history)
  actual_used    (member) = %distribution × pod RAW actual  ← FALLBACK:
        articles are only a *distribution key*; the magnitude comes from the
        authoritative pod actual, because the article log under-counts.
  %util_real     = actual_used ÷ capacity        (use of max capacity)
  %util_weighted = actual_used ÷ projected_used  (delivery vs plan)

Pod RAW totals (no ×1.4) drive the per-member math; the category-weighted
(specialized ×1.4) pod totals are carried for the pod-level reference util.
"""

from __future__ import annotations

import re
from collections import defaultdict

SPEC_WEIGHT = 1.4  # specialized articles cost ~40% more effort (matches the sheet)


def norm_name(name: str | None) -> str:
    """Lowercase + collapse whitespace for matching member names to editor names."""
    return re.sub(r"\s+", " ", str(name or "").strip().lower())


def version_num(version: str | None) -> int:
    """Numeric rank of a 'V## Mon YYYY' version string. Alphabetical sort is
    wrong (V9 > V14); we rank by the integer after 'V'. Unparseable → -1."""
    m = re.search(r"V(\d+)", version or "")
    return int(m.group(1)) if m else -1


def aggregate_pod_production(
    cph_rows: list[dict],
    ph_rows: list[dict],
) -> tuple[dict[int, str], dict[int, str], dict[str, dict[str, float]]]:
    """Join production_history facts onto the as-of-month client→pod dim and
    aggregate per pod. Returns (pod_by_client, cat_by_client, pod_agg) where
    pod_agg[pod] = {"pr": raw projected, "pw": weighted projected,
                    "ar": raw actual,    "aw": weighted actual}.

    cph_rows: [{client_id, editorial_pod, category}] for ONE (year, month)
    ph_rows:  [{client_id, projected_original, articles_actual}] same month
    """
    pod_by_client = {r["client_id"]: r["editorial_pod"] for r in cph_rows}
    cat_by_client = {r["client_id"]: r["category"] for r in cph_rows}

    pod_agg: dict[str, dict[str, float]] = defaultdict(
        lambda: {"pr": 0.0, "pw": 0.0, "ar": 0.0, "aw": 0.0}
    )
    for r in ph_rows:
        pod = pod_by_client.get(r["client_id"])
        if not pod:
            continue
        w = SPEC_WEIGHT if cat_by_client.get(r["client_id"]) == "specialized" else 1.0
        proj = r["projected_original"] or 0
        act = r["articles_actual"] or 0
        a = pod_agg[pod]
        a["pr"] += proj
        a["pw"] += proj * w
        a["ar"] += act
        a["aw"] += act * w
    return pod_by_client, cat_by_client, pod_agg


def compute_member_utilization(
    cph_rows: list[dict],
    ph_rows: list[dict],
    article_rows: list[dict],
    emc_rows: list[dict],
) -> list[dict]:
    """% of capacity per editor for one month. JOINS-ONLY over 4 origins.

    Inputs (all for ONE year+month):
      cph_rows:     [{client_id, editorial_pod, category}]   client_pod_history
      ph_rows:      [{client_id, projected_original, articles_actual}] production_history
      article_rows: [{editor_name}]                          article_records
      emc_rows:     [{pod, role, member_raw, member_breakdown, capacity}]
                                                             editorial_member_capacity
    Output: one dict per person with the exact fields the API returns.
    """
    _, _, pod_agg = aggregate_pod_production(cph_rows, ph_rows)

    # ── this-month delivered articles per editor ──
    ed_raw: dict[str, int] = defaultdict(int)
    for r in article_rows:
        ed_raw[norm_name(r["editor_name"])] += 1

    # ── member capacity, pod total = SUM members ──
    pod_total_cap: dict[str, int] = defaultdict(int)
    for m in emc_rows:
        pod_total_cap[m["pod"]] += m["capacity"] or 0

    # Article editor names are first-name/nickname ("Jimmy", "Sam"); capacity
    # members are full names ("Jimmy Bunes", "Samantha Marceau"). Match on the
    # member's first token, allowing nickname/prefix overlap (≥3 chars, e.g.
    # "sam" ↔ "samantha"). Best-effort — unmatched members surface in the UI.
    editor_keys = list(ed_raw.keys())

    def _resolve_editor(full_name: str) -> str | None:
        mf = norm_name(full_name).split(" ")[0]
        if not mf:
            return None
        if mf in ed_raw:
            return mf
        for e in editor_keys:
            if len(e) >= 3 and (mf.startswith(e) or e.startswith(mf)):
                return e
        return None

    # Pass 1 — expand members into people + match their article count.
    people_rows: list[dict] = []
    pod_total_articles: dict[str, int] = defaultdict(int)
    for m in emc_rows:
        # Expand combined cells ("Lauren K (28) + Anabelle (15)") into one row
        # per person; fall back to the slot's single name + capacity.
        people = list(m["member_breakdown"] or [])
        if not people:
            nm = (m["member_raw"] or "").strip()
            if nm and nm not in ("-", "—"):
                people = [{"name": nm, "capacity": m["capacity"]}]
        for person in people:
            nm = (person.get("name") or "").strip()
            if not nm:
                continue
            ek = _resolve_editor(nm)
            articles = ed_raw.get(ek, 0) if ek else 0
            people_rows.append(
                {
                    "pod": m["pod"],
                    "role": m["role"],
                    "member": nm,
                    "capacity": person.get("capacity") or m["capacity"],
                    "matched": ek is not None,
                    "articles": articles,
                }
            )
            pod_total_articles[m["pod"]] += articles

    # Pass 2 — derive the model per member from pod totals.
    rows: list[dict] = []
    for p in people_rows:
        pod = p["pod"]
        agg = pod_agg.get(pod, {"pr": 0.0, "pw": 0.0, "ar": 0.0, "aw": 0.0})
        cap = p["capacity"] or 0
        tot_cap = pod_total_cap.get(pod, 0)
        tot_art = pod_total_articles.get(pod, 0)
        pr, ar_, pw, aw = agg["pr"], agg["ar"], agg["pw"], agg["aw"]

        pct_alloc = (cap / tot_cap) if tot_cap else 0.0
        pct_dist = (p["articles"] / tot_art) if tot_art else 0.0
        projected_used = pct_alloc * pr  # %alloc × pod RAW projected
        actual_used = pct_dist * ar_  # %dist × pod RAW actual (fallback)

        rows.append(
            {
                "pod": pod,
                "role": p["role"],
                "member": p["member"],
                "capacity": p["capacity"],
                "matched": p["matched"],
                "articles": p["articles"],
                "pct_allocation": round(pct_alloc, 4),
                "pct_distribution": round(pct_dist, 4),
                "projected_used": round(projected_used, 1),
                "actual_used": round(actual_used, 1),
                "pct_util_real": round(actual_used / cap, 4) if cap else None,
                "pct_util_weighted": (
                    round(actual_used / projected_used, 4) if projected_used else None
                ),
                "pod_total_capacity": tot_cap,
                "pod_total_articles": tot_art,
                "pod_projected_raw": round(pr),
                "pod_actual_raw": round(ar_),
                "pod_projected_weighted": round(pw, 1),
                "pod_actual_weighted": round(aw, 1),
                "pod_util_projected_weighted": round(pw / tot_cap, 4) if tot_cap else None,
                "pod_util_actual_weighted": round(aw / tot_cap, 4) if tot_cap else None,
            }
        )
    rows.sort(key=lambda r: (r["pod"], -(r["capacity"] or 0), r["member"]))
    return rows


def compute_client_contributions(
    cph_rows: list[dict],
    ph_rows: list[dict],
    client_names: dict[int, str],
) -> list[dict]:
    """The processed per-client table that DRIVES the pod totals above: one row
    per (pod, client) for one month, with the raw + ×1.4-weighted projected and
    actual contributions. `client_names` maps client_id → display name."""
    pod_by_client = {r["client_id"]: r["editorial_pod"] for r in cph_rows}
    cat_by_client = {r["client_id"]: r["category"] for r in cph_rows}

    rows: list[dict] = []
    for r in ph_rows:
        pod = pod_by_client.get(r["client_id"])
        if not pod:
            continue
        cat = cat_by_client.get(r["client_id"])
        w = SPEC_WEIGHT if cat == "specialized" else 1.0
        proj = r["projected_original"] or 0
        act = r["articles_actual"] or 0
        rows.append(
            {
                "pod": pod,
                "client_id": r["client_id"],
                "client_name": client_names.get(r["client_id"], f"#{r['client_id']}"),
                "category": cat,
                "weight": w,
                "projected_raw": proj,
                "actual_raw": act,
                "projected_weighted": round(proj * w, 1),
                "actual_weighted": round(act * w, 1),
            }
        )
    rows.sort(key=lambda r: (r["pod"], -r["actual_raw"], r["client_name"]))
    return rows
