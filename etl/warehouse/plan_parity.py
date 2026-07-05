"""Q3/Q4 cutover parity — the planning-hub's published demand vs our sheet-derived warehouse.

Gates the Aug 1 2026 flip of the two remaining loops (client→pod attribution +
category ×1.4, and projected articles) to Hub-first, per contract v1.1 in
`etl/handoff_planning_hub_cutover_proposal.md`. The INT compose will take
`editorial_capacity_plan_demand` rows WHERE source='app' AND ym >= current
calendar month AND client_id > 0; everything else stays sheet-derived. This
gate proves, throughout the Jul 20–31 soak, that:

  A. BASELINE FIDELITY (gates the flip): the Hub's `source='baseline'` rows —
     echoes of our own sheet data — match the warehouse row-for-row on
     (ym >= current, client_id > 0): articles equal AND pod equal ("Pod N" /
     "N" format-tolerant). PASS = zero mismatches. Weight differences are
     reported but informational (category derivation is latest-known vs
     per-month; the flip carries the Hub's weight by design).
  B. APP-ROW VALIDITY (never a failure to exist — DaniQ's edits are the
     point): every `source='app'` row with client_id > 0 must join to
     dim_client, and weight must be sane (0 < w <= 2). Violations FAIL.
     Counts + samples reported per ym.
  C. FRESHNESS (the 3-day staleness valve, contract v1.1): MAX(published_at)
     must be younger than 3 days. Older FAILS the soak — the compose would
     ignore the Hub entirely, so cutting over would be meaningless.

  WARN (listed, never fails): non-zero sheet demand invisible to the Hub
  board (sheet-only rows with a pod + articles_projected > 0) — at cutover
  DaniQ stops maintaining the sheet, so these clients would freeze. As of
  2026-07-05 this is exactly 1 row (Tempo XYZ identity dup, flagged).

Standalone (like gen_bq_schema_catalog): only needs BigQuery + sa-key.json.
Writes etl/PARITY_REPORT_PLAN.md.

    .venv/bin/python -m etl.warehouse.plan_parity
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone

from etl.gen_bq_schema_catalog import DS, _get_bq

HUB = f"`{DS}.editorial_capacity_plan_demand`"
PROD = f"`{DS}.editorial_raw_production`"
CLIENTS = f"`{DS}.editorial_raw_clients`"
STALENESS_DAYS = 3  # contract v1.1 valve


def main() -> int:
    bq = _get_bq()
    q = lambda sql: list(bq.query(sql).result())  # noqa: E731

    cur_ym = datetime.now(timezone.utc).strftime("%Y-%m")

    # ── C. freshness (check first — a stale table invalidates A/B too) ──────
    fresh = q(
        f"""SELECT MAX(published_at) ts,
        TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), MAX(published_at), HOUR) age_h FROM {HUB}"""
    )[0]
    fresh_pass = fresh.age_h is not None and fresh.age_h < STALENESS_DAYS * 24

    # ── A. baseline fidelity ─────────────────────────────────────────────────
    base = q(
        f"""
    WITH hub AS (
      SELECT ym, client_id, client_name, pod, articles
      FROM {HUB}
      WHERE source = 'baseline' AND client_id > 0 AND ym >= '{cur_ym}'
    ),
    sheet AS (
      SELECT FORMAT('%04d-%02d', p.year, p.month) ym, p.client_id,
             c.name client_name, c.editorial_pod pod, p.articles_projected articles
      FROM {PROD} p JOIN {CLIENTS} c ON c.id = p.client_id
      WHERE FORMAT('%04d-%02d', p.year, p.month) >= '{cur_ym}'
        AND p.articles_projected IS NOT NULL
    )
    SELECT h.ym, h.client_id, h.client_name,
           h.articles hub_articles, s.articles sheet_articles,
           h.pod hub_pod, s.pod sheet_pod
    FROM hub h JOIN sheet s USING (ym, client_id)
    WHERE h.articles != s.articles
       OR (h.pod != CONCAT('Pod ', s.pod) AND h.pod != s.pod)
    ORDER BY h.ym, h.client_name"""
    )
    matched = q(
        f"""
    SELECT COUNT(*) n FROM (
      SELECT ym, client_id FROM {HUB}
      WHERE source = 'baseline' AND client_id > 0 AND ym >= '{cur_ym}') h
    JOIN (
      SELECT FORMAT('%04d-%02d', year, month) ym, client_id FROM {PROD}
      WHERE FORMAT('%04d-%02d', year, month) >= '{cur_ym}'
        AND articles_projected IS NOT NULL) s
    USING (ym, client_id)"""
    )[0].n
    base_pass = not base

    # ── B. app-row validity (existence = intentional; invalid rows fail) ────
    app_by_ym = q(
        f"""SELECT ym, COUNT(*) n, COUNTIF(articles = 0) zeros
        FROM {HUB} WHERE source = 'app' AND ym >= '{cur_ym}' GROUP BY ym ORDER BY ym"""
    )
    app_bad = q(
        f"""
    SELECT h.ym, h.client_id, h.client_name, h.weight,
           CASE WHEN c.id IS NULL AND h.client_id > 0 THEN 'no dim_client match'
                WHEN h.weight IS NULL OR h.weight <= 0 OR h.weight > 2 THEN 'weight out of range'
           END problem
    FROM {HUB} h LEFT JOIN {CLIENTS} c ON c.id = h.client_id
    WHERE h.source = 'app' AND h.ym >= '{cur_ym}'
      AND ((c.id IS NULL AND h.client_id > 0)
        OR h.weight IS NULL OR h.weight <= 0 OR h.weight > 2)
    ORDER BY h.ym"""
    )
    planned = q(
        f"SELECT COUNT(*) n FROM {HUB} WHERE client_id < 0 AND ym >= '{cur_ym}'"
    )[0].n
    app_pass = not app_bad

    # ── WARN: non-zero sheet demand the Hub board doesn't model ─────────────
    invisible = q(
        f"""
    SELECT s.ym, s.client_name, s.pod, s.articles FROM (
      SELECT FORMAT('%04d-%02d', p.year, p.month) ym, p.client_id, c.name client_name,
             c.editorial_pod pod, p.articles_projected articles
      FROM {PROD} p JOIN {CLIENTS} c ON c.id = p.client_id
      WHERE FORMAT('%04d-%02d', p.year, p.month) >= '{cur_ym}'
        AND p.articles_projected > 0 AND c.editorial_pod IS NOT NULL) s
    LEFT JOIN (SELECT DISTINCT ym, client_id FROM {HUB} WHERE client_id > 0) h
      USING (ym, client_id)
    WHERE h.client_id IS NULL ORDER BY s.ym, s.client_name"""
    )

    # ── report ───────────────────────────────────────────────────────────────
    weight_diff = q(
        f"""
    SELECT COUNT(*) n FROM (
      SELECT ym, client_id, weight FROM {HUB}
      WHERE source = 'baseline' AND client_id > 0 AND ym >= '{cur_ym}') h
    JOIN (SELECT FORMAT('%04d-%02d', year, month) ym, client_id FROM {PROD}) s
      USING (ym, client_id)
    WHERE h.weight NOT IN (1.0, 1.4)"""
    )[0].n

    verdict = base_pass and app_pass and fresh_pass
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lines = [
        "# Q3/Q4 cutover parity — planning-hub demand vs sheet-derived warehouse",
        "",
        f"_Generated {now}. Hub table: `editorial_capacity_plan_demand` · window ym >= {cur_ym} "
        f"· contract v1.1 (source='app'-only authority)._",
        "",
        "## A. Baseline fidelity: " + ("✅ PASS" if base_pass else "❌ FAIL"),
        "",
        f"- (ym, client) intersections compared: {matched} · mismatches: {len(base)}",
        f"- non-standard weights on baseline rows (informational): {weight_diff}",
        "",
        "## B. App-row validity: " + ("✅ PASS" if app_pass else "❌ FAIL"),
        "",
        "- app rows per ym (DaniQ's edits — intentional divergence, never a failure): "
        + (
            ", ".join(f"{r.ym}×{r.n} ({r.zeros} zeros)" for r in app_by_ym)
            or "none yet"
        ),
        f"- invalid app rows (gate): {len(app_bad)}",
        f"- planned-client rows (negative ids, excluded from compose by contract): {planned}",
        "",
        f"## C. Freshness (≤{STALENESS_DAYS}d valve): "
        + ("✅ PASS" if fresh_pass else "❌ FAIL"),
        "",
        f"- MAX(published_at): {fresh.ts} ({fresh.age_h}h ago)",
        "",
        f"## WARN — non-zero sheet demand invisible to the Hub board: {len(invisible)} row(s)",
        "",
        "These freeze at cutover when DaniQ stops maintaining the sheet — resolve or accept each:",
    ]
    for r in invisible[:20]:
        lines.append(f"- {r.ym} · {r.client_name} ({r.pod}) · {r.articles} projected")
    for label, rows in (
        (
            "A mismatches",
            [
                (
                    r.ym,
                    r.client_name,
                    f"art {r.sheet_articles}→{r.hub_articles}",
                    f"pod {r.sheet_pod}→{r.hub_pod}",
                )
                for r in base
            ],
        ),
        (
            "B invalid app rows",
            [(r.ym, r.client_name, r.problem, r.weight) for r in app_bad],
        ),
    ):
        if rows:
            lines += ["", f"### {label}", "```"]
            lines += [str(t) for t in rows[:40]]
            lines.append("```")
    lines += [
        "",
        "## Verdict: "
        + (
            "✅ SOAK GREEN — cutover unblocked"
            if verdict
            else "❌ SOAK RED — do not cut over"
        ),
    ]
    out = os.path.join(
        os.path.dirname(os.path.dirname(__file__)), "PARITY_REPORT_PLAN.md"
    )
    with open(out, "w") as f:
        f.write("\n".join(lines) + "\n")
    print("\n".join(lines))
    print(f"\n→ {out}")
    return 0 if verdict else 1


if __name__ == "__main__":
    sys.exit(main())
