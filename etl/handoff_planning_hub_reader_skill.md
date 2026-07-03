📥 [CC-HANDOFF]
To: @Planning-Hub session (editorial-team-pods)
From: @Editorial-Hub session
Project: ETL lineage catalog — producer shipped; reader skill is yours to own
Status: DONE (producer) / NEEDS-REVIEW (reader-skill spec)

## Summary
The full ETL **lineage** catalog you asked for is built and auto-copies into your repo
alongside the schema catalog. This is the spec for the **reader skill** on your side — a
pure navigator over the generated docs (no BQ queries of its own), so a session that asks
"where does this number come from?" gets pointed at the right file + entry.

## What already ships into your repo (nothing for you to run)
On every `/bq-schema-catalog` run in the Editorial Hub, four files land in
`editorial-team-pods/docs/`:

| File | What it answers |
|---|---|
| `bq_schema_catalog.{md,json}` | *what's in the warehouse* — grain, columns, row_count, freshness |
| `bq_lineage_catalog.{md,json}` | *where each number comes from* — origin → pipeline → processing (business-math) → `consumers.{editorial_hub,planning_hub}` |

Both cover ALL 49 editorial objects (`editorial_raw_*` · `editorial_int_*` · `v_editorial_*`).
Columns/counts/freshness are live from BigQuery; lineage is a curated map on our side. The
lineage generator also **drift-checks `consumers.planning_hub` against your `src/lib/{bq,data}.ts`**
on each run — so if you start/stop reading an object, we get a warning to update the entry
(ping us, or note it in a handoff).

## Lineage JSON shape (what your reader skill parses)
```json
{
  "dataset": "graphite-data.graphite_bi_sandbox",
  "generated_at": "…",
  "objects": [
    {
      "name": "editorial_int_member_months",
      "type": "TABLE", "family": "int",
      "grain": "member × month", "columns": [{"name","type"}], "row_count": 0, "synced_at": "…",
      "origin": "editorial_raw_capacity_members + …",
      "pipeline_step": "build.py build_int_capacity_articles() → transform.build_member_utilization_mart()",
      "processing": "projected_used = capacity-share × pod projected; actual_used = article-share × pod actual; ×1.4 specialized …",
      "consumers": { "editorial_hub": "…", "planning_hub": "getCapacityData() → member×pod×month …" }
    }
  ]
}
```

## Proposed reader skill (yours to build + own)
- **name:** `etl-lineage` (or `bq-catalog`), in `editorial-team-pods/.claude/skills/`.
- **triggers:** "where does this number come from", "what feeds table X", "which sheet is
  the origin of Y", "what math is behind this metric", "lineage", "data source of".
- **behavior (navigator only — NO BigQuery calls):**
  1. Read `docs/bq_lineage_catalog.json` (machine) or `.md` (human).
  2. Look up the object by name, or search `consumers.planning_hub` for the reader function
     (e.g. `getWriterDelivered`) or `processing` for a metric.
  3. Answer with: origin → pipeline_step → processing → the consumer line, citing the object.
  4. For structure (columns/rows) fall back to `docs/bq_schema_catalog.*`.
- **must say:** these docs are **generated in editorial-hub** — do not hand-edit them here;
  to change lineage, ping the Editorial-Hub session to edit the `LINEAGE` map + re-run.

## Ask
1. Confirm the lineage **field set + JSON shape** works for you (origin / pipeline_step /
   processing / consumers.{editorial_hub,planning_hub} + the schema fields).
2. Build the reader skill on your side to the spec above (or tell us if you'd rather we
   scaffold it into your repo — happy to).
3. Point your app's read path at `docs/bq_lineage_catalog.*` for lineage questions; keep
   using `bq_schema_catalog.*` for structure.

## Artifacts
- Producer: `editorial-hub/etl/gen_bq_lineage_catalog.py` (+ `gen_bq_schema_catalog.py`); skill `bq-schema-catalog`.
- Output (already in your repo): `editorial-team-pods/docs/bq_lineage_catalog.{md,json}`.
- Companion: `etl/handoff_planning_hub_capacity_data.md`, `etl/WAREHOUSE_DESIGN.md`.

## Next step
Planning-Hub session: review (1), build the reader skill (2), wire the read path (3).

*Written 2026-07-04 by the Editorial-Hub session.*
