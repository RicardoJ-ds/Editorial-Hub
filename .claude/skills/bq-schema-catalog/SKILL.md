---
name: bq-schema-catalog
description: |
  Refresh the BQ schema catalog that the downstream planning-hub
  (editorial-team-pods) reads to know what lives in
  `graphite-data.graphite_bi_sandbox`. Introspects the LIVE dataset, regenerates
  the machine-readable JSON + human-readable Markdown catalog, and syncs both
  into the planning-hub repo's `docs/` folder.

  Use this skill when:
  (1) User types /bq-schema-catalog.
  (2) A table or view was ADDED, RENAMED, or REMOVED in `etl/warehouse/build.py`
      (RAW_TABLES / INT specs) or `etl/warehouse/views.py` (VIEWS list) — the
      catalog must be regenerated so the planning-hub sees the change.
  (3) A published table gained/dropped columns, or you just want the freshest
      column list + row counts handed to the planning-hub.
  (4) User asks to "refresh the schema catalog", "update the BQ catalog",
      "sync the schema to the planning hub", "regenerate the table inventory".
  Triggers: "schema catalog", "bq catalog", "table inventory", "refresh catalog",
            "sync schema to planning hub", "regenerate schema"
---

# BQ schema catalog

**One command keeps the planning-hub's picture of the warehouse current.** The
generator (`etl/gen_bq_schema_catalog.py`) introspects the **live** dataset
`graphite-data.graphite_bi_sandbox`, writes two artifacts in `etl/`, and copies
both into the sibling planning-hub repo.

- **`etl/bq_schema_catalog.json`** — machine-readable inventory: one entry per
  table/view with `name`, `type` (TABLE|VIEW), `family` (raw/int/views), `grain`,
  `columns:[{name,type}]`, `row_count`, and `synced_at` freshness.
- **`etl/bq_schema_catalog.md`** — human-readable, grouped **raw / int / views**;
  a table per family with name, grain, rows, freshness, purpose + key columns.

Both are copied to
`../editorial-team-pods/docs/bq_schema_catalog.{json,md}` so the planning-hub
always ships with a fresh, accurate catalog.

> **What's the source of truth for grain?** The generator's `GRAIN` map mirrors
> `build.py` (RAW_TABLES / INT specs) + `views.py` (VIEWS). **Columns, row
> counts, and freshness are always live from BQ.** If BQ is unreachable it still
> emits a SEED catalog from that map (flagged, no live columns/counts).

---

## When to run

Run it **after** any change to the published warehouse surface:

| You did this in the Editorial Hub | Then |
|---|---|
| Added a table to `RAW_TABLES` / a new INT spec in `build.py` | Add its grain to the `GRAIN` map in the generator, then run |
| Added a view to `VIEWS` in `views.py` | Add its grain to `GRAIN`, then run |
| Renamed a table/view | Update the `GRAIN` key, then run |
| Removed a table/view | Delete its `GRAIN` entry, then run |
| Changed columns of a published table | Just run (columns are live from BQ) |
| Nothing changed, just want fresh counts | Just run |

A brand-new object that you forget to add to `GRAIN` is **not** hidden — it still
appears in the catalog with grain `—` and its live columns. Adding the `GRAIN`
entry just gives it a proper grain + one-line purpose.

---

## Steps

### 1 — (If schema changed) update the grain map

Only needed when a table/view was **added, renamed, or removed** (not for column
changes). Edit the `GRAIN` dict in `etl/gen_bq_schema_catalog.py` — one entry:

```python
"editorial_int_new_thing": {"grain": "client × month", "note": "one-line purpose"},
```

Keep it consistent with `build.py` / `views.py`. Skip this step for pure column
changes or a plain freshness refresh.

### 2 — Run the generator

From the **repo root**, using the repo venv (this script is standalone — it needs
only BigQuery + `sa-key.json`, so it runs **without Docker**, unlike the rest of
`etl/`):

```bash
.venv/bin/python -m etl.gen_bq_schema_catalog
```

Useful flags:

```bash
.venv/bin/python -m etl.gen_bq_schema_catalog --no-sync    # regenerate locally, don't copy to planning-hub
.venv/bin/python -m etl.gen_bq_schema_catalog --no-counts  # skip row counts / freshness (faster)
```

It prints a summary: `N tables · N views · N columns`, the two `etl/` paths, and
the two synced planning-hub paths. If it prints **`(SEED — BQ unreachable)`**,
BigQuery couldn't be reached — check the SA key / network and re-run before
trusting the artifacts (a seed catalog has no live columns or counts).

### 3 — Review the diff

The generator overwrites the artifacts in place; inspect what moved before you
trust the sync:

```bash
git -C /Users/ricardo/python/editorial-hub diff -- etl/bq_schema_catalog.md etl/bq_schema_catalog.json
git -C /Users/ricardo/python/editorial-team-pods status --short docs/
```

Sanity-check:
- The `N tables · N views · N columns` counts moved the way you expect.
- Any new/renamed object shows the right grain (not `—` if you added it to `GRAIN`).
- Freshness (`synced_at`) is recent — if it's stale, run a warehouse publish first
  (`./etl/refresh.sh`) so the catalog reflects the latest data.

### 4 — Confirm the sync landed in the planning-hub

Step 2 already copies both files into
`/Users/ricardo/python/editorial-team-pods/docs/`. Verify:

```bash
ls -l /Users/ricardo/python/editorial-team-pods/docs/bq_schema_catalog.*
```

If you ran with `--no-sync`, copy them manually:

```bash
cp /Users/ricardo/python/editorial-hub/etl/bq_schema_catalog.json \
   /Users/ricardo/python/editorial-hub/etl/bq_schema_catalog.md \
   /Users/ricardo/python/editorial-team-pods/docs/
```

Commit the catalog in **each** repo through its own normal flow (in the Editorial
Hub, that's the `release` skill / `/commit`). This skill only regenerates + syncs;
it does not commit.

---

## Notes

- **Filter:** the catalog covers `editorial_raw_*`, `editorial_int_*`, and
  `v_editorial_*`. Legacy phase-1 copies (`editorial_clients`, `editorial_articles`,
  etc.) are intentionally excluded.
- **Cost:** `COUNT(*)` on a native table is metadata-only (0 bytes billed);
  column types come from one `INFORMATION_SCHEMA.COLUMNS` query. The whole run is
  cheap.
- **Config:** project/dataset default to `graphite-data` / `graphite_bi_sandbox`
  (matching `backend/app/config.py`); override with `BQ_PROJECT` / `BQ_DATASET`.
  The planning-hub docs path defaults to the sibling checkout; override with
  `PLANNING_HUB_DOCS`.
- **Do NOT hand-edit the artifacts** — they carry a "do not hand-edit" banner and
  are overwritten on every run. Change the code / grain map instead.
- **Companion docs:** `etl/handoff_planning_hub_capacity_data.md` (consumer guide
  with SQL recipes) and `etl/WAREHOUSE_DESIGN.md` (design + bug register).
```
