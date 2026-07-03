---
name: bq-schema-catalog
description: |
  Refresh the TWO BQ catalogs the downstream planning-hub (editorial-team-pods)
  reads to understand `graphite-data.graphite_bi_sandbox`: a SCHEMA catalog
  (structure — grain/columns/rows/freshness) and a LINEAGE catalog (origin →
  pipeline → business-math → consumers in both Hubs). Introspects the LIVE
  dataset, regenerates the machine-readable JSON + human-readable Markdown for
  both, and syncs all four files into the planning-hub repo's `docs/` folder.

  Use this skill when:
  (1) User types /bq-schema-catalog.
  (2) A table or view was ADDED, RENAMED, or REMOVED in `etl/warehouse/build.py`
      (RAW_TABLES / INT specs) or `etl/warehouse/views.py` (VIEWS list) — the
      catalogs must be regenerated so the planning-hub sees the change.
  (3) A published table gained/dropped columns, its ORIGIN/PROCESSING changed, or
      a consumer (either Hub) started/stopped reading it — regenerate + update the
      `LINEAGE` map in `gen_bq_lineage_catalog.py`.
  (4) You just want the freshest column list + row counts handed to the planning-hub.
  (5) User asks to "refresh the schema/lineage catalog", "update the BQ catalog",
      "sync the schema/lineage to the planning hub", "regenerate the table inventory".
  Triggers: "schema catalog", "lineage catalog", "bq catalog", "table inventory",
            "refresh catalog", "sync to planning hub", "regenerate schema/lineage"
---

# BQ schema + lineage catalogs

**One command keeps the planning-hub's picture of the warehouse current.** Two
generators introspect the **live** dataset `graphite-data.graphite_bi_sandbox`,
write four artifacts in `etl/`, and copy them into the sibling planning-hub repo.

**Schema catalog** (`etl/gen_bq_schema_catalog.py`) — *what's in the warehouse*:
- **`etl/bq_schema_catalog.json`** — one entry per table/view: `name`, `type`
  (TABLE|VIEW), `family` (raw/int/views), `grain`, `columns:[{name,type}]`,
  `row_count`, `synced_at` freshness.
- **`etl/bq_schema_catalog.md`** — human-readable, grouped **raw / int / views**.

**Lineage catalog** (`etl/gen_bq_lineage_catalog.py`) — *where each number comes
from*: the schema fields PLUS `origin` → `pipeline_step` → `processing`
(business-math) → `consumers.{editorial_hub,planning_hub}`. It reuses the schema
generator's live introspection and adds a curated `LINEAGE` map (edit that map
when origin/processing/consumers move). It also drift-checks
`consumers.planning_hub` against the sibling `src/lib/{bq,data}.ts` on each run.

All four are copied to `../editorial-team-pods/docs/bq_{schema,lineage}_catalog.{json,md}`
so the planning-hub always ships with a fresh, accurate picture.

> **What's the source of truth for grain?** The generator's `GRAIN` map mirrors
> `build.py` (RAW_TABLES / INT specs) + `views.py` (VIEWS). **Columns, row
> counts, and freshness are always live from BQ.** If BQ is unreachable it still
> emits a SEED catalog from that map (flagged, no live columns/counts).

---

## When to run

Run it **after** any change to the published warehouse surface:

| You did this in the Editorial Hub | Then |
|---|---|
| Added a table to `RAW_TABLES` / a new INT spec in `build.py` | Add its grain to `GRAIN` (schema gen) + a `LINEAGE` entry (lineage gen), then run |
| Added a view to `VIEWS` in `views.py` | Add `GRAIN` + `LINEAGE` entries, then run |
| Renamed a table/view | Update the `GRAIN` + `LINEAGE` keys, then run |
| Removed a table/view | Delete its `GRAIN` + `LINEAGE` entries, then run |
| Changed an object's origin / processing / a consumer started or stopped reading it | Edit its `LINEAGE` entry, then run |
| Changed columns of a published table | Just run (columns are live from BQ) |
| Nothing changed, just want fresh counts | Just run |

A brand-new object you forget to add is **not** hidden — it still appears with
grain `—` / empty lineage and its live columns. Adding the `GRAIN` + `LINEAGE`
entries gives it a proper grain, purpose, and origin→consumers map. The lineage
generator also **prints a warning** listing any object missing a `LINEAGE` entry
and any `consumers.planning_hub` drift vs the sibling read layer — so gaps surface.

---

## Steps

### 1 — (If the surface changed) update the maps

Only needed when a table/view was **added, renamed, or removed**, or its
**origin / processing / consumers** changed (not for pure column changes):

- **Schema** — edit the `GRAIN` dict in `etl/gen_bq_schema_catalog.py`:
  ```python
  "editorial_int_new_thing": {"grain": "client × month", "note": "one-line purpose"},
  ```
- **Lineage** — edit the `LINEAGE` dict in `etl/gen_bq_lineage_catalog.py`:
  ```python
  "editorial_int_new_thing": {
      "origin": "editorial_raw_foo + editorial_raw_bar",
      "pipeline_step": "build.py build_int_new_thing()",
      "processing": "what math it applies, in plain language",
      "eh": "which Editorial-Hub page/endpoint reads it (or 'internal')",
      "ph": "which editorial-team-pods getX() reads it (or '' if none)",
  },
  ```

Keep both consistent with `build.py` / `views.py`. Skip for pure column changes.

### 2 — Run BOTH generators

From the **repo root**, using the repo venv (standalone — only BigQuery +
`sa-key.json`, so it runs **without Docker**, unlike the rest of `etl/`):

```bash
.venv/bin/python -m etl.gen_bq_schema_catalog
.venv/bin/python -m etl.gen_bq_lineage_catalog
```

Same flags on both: `--no-sync` (regenerate locally, don't copy) · `--no-counts`
(skip row counts / freshness). Each prints a summary + its `etl/` and synced
planning-hub paths. The **lineage** run also prints any missing-`LINEAGE` objects
and any `consumers.planning_hub` drift — act on those. If either prints
**`(SEED — BQ unreachable)`**, BigQuery couldn't be reached — fix the SA key /
network and re-run before trusting the artifacts.

### 3 — Review the diff

The generators overwrite the artifacts in place; inspect what moved before you
trust the sync:

```bash
git -C /Users/ricardo/python/editorial-hub diff -- etl/bq_schema_catalog.* etl/bq_lineage_catalog.*
git -C /Users/ricardo/python/editorial-team-pods status --short docs/
```

Sanity-check:
- The `N tables · N views` counts moved the way you expect.
- Any new/renamed object shows the right grain + a filled-in lineage row.
- Freshness (`synced_at`) is recent — if it's stale, run a warehouse publish first
  (`./etl/refresh.sh`) so the catalogs reflect the latest data.

### 4 — Confirm the sync landed in the planning-hub

Step 2 already copies all four files into
`/Users/ricardo/python/editorial-team-pods/docs/`. Verify:

```bash
ls -l /Users/ricardo/python/editorial-team-pods/docs/bq_{schema,lineage}_catalog.*
```

If you ran with `--no-sync`, copy them manually:

```bash
cp /Users/ricardo/python/editorial-hub/etl/bq_schema_catalog.{json,md} \
   /Users/ricardo/python/editorial-hub/etl/bq_lineage_catalog.{json,md} \
   /Users/ricardo/python/editorial-team-pods/docs/
```

Commit the catalogs in **each** repo through its own normal flow (in the Editorial
Hub, that's the `release` skill / `/commit`). This skill only regenerates + syncs;
it does not commit.

---

## Notes

- **Filter:** both catalogs cover `editorial_raw_*`, `editorial_int_*`, and
  `v_editorial_*`. Legacy phase-1 copies (`editorial_clients`, `editorial_articles`,
  etc.) are intentionally excluded.
- **Lineage reuses schema introspection:** `gen_bq_lineage_catalog.py` imports
  `introspect` / `_get_bq` from the schema generator, so the two catalogs never
  disagree on structure. Run the schema gen too (or just run both, per Step 2).
- **`consumers.planning_hub` drift check:** the lineage gen scans the sibling
  `editorial-team-pods/src/lib/{bq,data}.ts` and warns when the curated `LINEAGE`
  map disagrees with what the Hub actually reads. If the sibling checkout is
  absent, the check is skipped (never fails the run).
- **Cost:** `COUNT(*)` on a native table is metadata-only (0 bytes billed);
  column types come from one `INFORMATION_SCHEMA.COLUMNS` query. Cheap.
- **Config:** project/dataset default to `graphite-data` / `graphite_bi_sandbox`
  (matching `backend/app/config.py`); override with `BQ_PROJECT` / `BQ_DATASET`.
  The planning-hub docs path defaults to the sibling checkout; override with
  `PLANNING_HUB_DOCS`.
- **Do NOT hand-edit the artifacts** — they carry a "do not hand-edit" banner and
  are overwritten on every run. Change the code / `GRAIN` / `LINEAGE` maps instead.
- **Reader side:** the planning-hub has (or will have) a companion *reader* skill
  that navigates these docs — see `etl/handoff_planning_hub_reader_skill.md` for
  the spec handed to that session.
- **Companion docs:** `etl/handoff_planning_hub_capacity_data.md` (consumer guide
  with SQL recipes) and `etl/WAREHOUSE_DESIGN.md` (design + bug register).
```
