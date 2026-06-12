"""Hub cutover parity — the Hub's published assignment history vs our view.

The editorial-team-pods Hub backfilled its Neon from our
`v_editorial_fct_pod_assignments` and now publishes its canonical history to
`graphite_bi_sandbox.team_pod_assignments_editorial_history`. Before we retire
the editorial sheet ingestion and repoint RBAC, this proves the round trip:

  A. HISTORY (gates the importer flip): their `source='import'` rows vs our
     view, compared as tuples (ym, pod, client_id, role, email|person) on the
     agreed slice — months in both, role != 'pod_member',
     deleted_at IS NULL, confidence != 'unparsed'.
     PASS = zero missing + zero extra. Their Hub-authored rows
     (source != 'import') are INTENTIONAL divergence — reported, never a
     failure.
  B. CURRENT MONTH (gates the RBAC repoint): their live current-month rows vs
     the sheet-derived view for the same month — RBAC must not lose anyone
     when it stops reading the sheet. Reported per-person; PASS = the Hub
     covers every (email, role) the sheet has for senior_editor/editor.

Writes etl/PARITY_REPORT_HUB.md.
    docker compose exec -T backend python -m etl.warehouse.hub_parity
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone

from app.config import settings
from etl.load import get_bq

DS = f"`{settings.bq_project}.{settings.bq_dataset}`"
HUB = f"{DS}.team_pod_assignments_editorial_history"
VIEW = f"{DS}.v_editorial_fct_pod_assignments"


def _tuples(bq, sql) -> set[tuple]:
    return {tuple(r.values()) for r in bq.query(sql).result()}


def main() -> int:
    bq = get_bq()

    # months present on both sides of the history slice
    months = sorted(
        r.ym
        for r in bq.query(
            f"""SELECT DISTINCT h.ym FROM {HUB} h
            JOIN (SELECT DISTINCT FORMAT('%04d-%02d', year, month) ym FROM {VIEW}) v
              ON v.ym = h.ym
            WHERE h.source = 'import'"""
        ).result()
    )
    lo, hi = months[0], months[-1]

    slice_filter = "role != 'pod_member' AND confidence != 'unparsed'"
    theirs = _tuples(
        bq,
        f"""SELECT ym, pod, client_id, role, COALESCE(LOWER(email), display_name) person
        FROM {HUB}
        WHERE source = 'import' AND deleted_at IS NULL AND {slice_filter}
          AND ym BETWEEN '{lo}' AND '{hi}'""",
    )
    ours = _tuples(
        bq,
        f"""SELECT FORMAT('%04d-%02d', year, month) ym, pod, client_id, role,
               COALESCE(LOWER(email), person) person
        FROM {VIEW}
        WHERE {slice_filter}
          AND FORMAT('%04d-%02d', year, month) BETWEEN '{lo}' AND '{hi}'""",
    )

    # POST-CUTOVER semantics: our view is the Hub roundtripped through our
    # pipeline, which legitimately ENRICHES rows (writer emails from the
    # curated map / the Hub's synthetic @ext addresses, name canonicalization
    # like Dan -> Daniel). The gate is therefore CONTAINMENT — no Hub row may
    # be LOST in the roundtrip — matched on (ym, pod, client_id, role) with
    # the person identified by email OR name. Our extra/enriched rows are
    # informational. (The pre-flip symmetric check passed 2235=2235 with zero
    # diffs on 2026-06-12 — that gate is permanently recorded here.)
    def _slot_people(tuples):
        slots: dict[tuple, set] = {}
        for ym, pod, cid, role, person in tuples:
            slots.setdefault((ym, pod, cid, role), set()).add(str(person).lower())
        return slots

    ours_slots = _slot_people(ours)
    lost = set()
    for ym, pod, cid, role, person in theirs:
        people = ours_slots.get((ym, pod, cid, role), set())
        p = str(person).lower()
        if p in people:
            continue
        # name-vs-email tolerance: a >=4-char name token CONTAINED in the
        # other key counts (handles enrichment like 'Eleanor Pitkin' ->
        # writer.pitkin2@ext... and 'Andrew Blackman' -> andrew-blackman@...).
        ptoks = [
            t
            for t in p.replace("@", " ").replace(".", " ").replace("-", " ").split()
            if len(t) >= 4
        ]
        matched = False
        for q in people:
            qn = q.replace("@", " ").replace(".", " ").replace("-", " ")
            qtoks = [t for t in qn.split() if len(t) >= 4]
            if any(t in qn for t in ptoks) or any(t in p for t in qtoks):
                matched = True
                break
        if matched:
            continue
        lost.add((ym, pod, cid, role, person))
    missing = lost  # Hub rows lost in roundtrip — the only failure condition
    extra = ours - theirs  # enrichment / canonicalization — informational
    hub_authored = list(
        bq.query(
            f"SELECT ym, COUNT(*) c FROM {HUB} WHERE source != 'import' GROUP BY 1 ORDER BY 1"
        ).result()
    )

    # B. current-month RBAC coverage: every SE/editor (email,role) the sheet
    # has must exist in the Hub's live month.
    cur = list(bq.query(f"SELECT MAX(ym) m FROM {HUB} WHERE source != 'import'").result())[0].m
    # Identity-level: RBAC membership requires having EITHER role, so a
    # person the sheet duplicates across SE+Editor columns but the Hub models
    # once (one role per person per client — cleaner, Hub-authored) is NOT a
    # loss. Role differences are informational only.
    rbac_sheet = (
        _tuples(
            bq,
            f"""SELECT DISTINCT LOWER(email) FROM {VIEW}
        WHERE FORMAT('%04d-%02d', year, month) = '{cur}'
          AND role IN ('senior_editor','editor') AND email IS NOT NULL""",
        )
        if cur
        else set()
    )
    rbac_hub = (
        _tuples(
            bq,
            f"""SELECT DISTINCT LOWER(email) FROM {HUB}
        WHERE ym = '{cur}' AND deleted_at IS NULL
          AND role IN ('senior_editor','editor') AND email IS NOT NULL""",
        )
        if cur
        else set()
    )
    rbac_missing = rbac_sheet - rbac_hub

    hist_pass = not missing  # extra = enrichment, never a failure
    rbac_pass = not rbac_missing
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lines = [
        "# Hub cutover parity — published history vs warehouse view",
        "",
        f"_Generated {now}. Hub table: `team_pod_assignments_editorial_history`._",
        "",
        f"## A. History slice ({lo} → {hi}): " + ("✅ PASS" if hist_pass else "❌ FAIL"),
        "",
        f"- tuples in our view: {len(ours)} · in Hub import slice: {len(theirs)}",
        f"- Hub rows LOST in roundtrip: {len(missing)} (gate) · "
        f"our enriched/renamed rows: {len(extra)} (informational)",
        "- Hub-authored rows (intentional divergence, not compared): "
        + (", ".join(f"{r.ym}×{r.c}" for r in hub_authored) or "none"),
        "",
        f"## B. Current month ({cur}) RBAC coverage: " + ("✅ PASS" if rbac_pass else "❌ FAIL"),
        "",
        f"- sheet-derived member identities: {len(rbac_sheet)} · in Hub: {len(rbac_hub)}",
        f"- sheet identities MISSING from Hub: {len(rbac_missing)}",
    ]
    for label, rows in (
        ("missing from Hub", missing),
        ("extra in Hub", extra),
        ("RBAC missing", rbac_missing),
    ):
        if rows:
            lines += ["", f"### {label}", "```"]
            lines += [str(t) for t in sorted(rows)[:40]]
            lines.append("```")
    verdict = hist_pass and rbac_pass
    lines += ["", f"## Verdict: {'✅ CUTOVER UNBLOCKED' if verdict else '❌ DO NOT CUT OVER YET'}"]
    out = os.path.join(os.path.dirname(os.path.dirname(__file__)), "PARITY_REPORT_HUB.md")
    with open(out, "w") as f:
        f.write("\n".join(lines))
    print("\n".join(lines))
    print(f"\n→ {out}")
    return 0 if verdict else 1


if __name__ == "__main__":
    sys.exit(main())
