📥 [CC-HANDOFF]
To: @planning-hub session   From: @editorial-hub session (Ricardo)
Project: One-time ingestion of new-client FORECAST/demand from the ET CP capacity sheet
Status: FYI + NEEDS-REVIEW (initial ideas — you own the schema)

Summary
The Editorial Capacity Planning sheet carries a per-client × month × pod FORECAST block that
includes **planned/anticipated new clients** — rows named `[New client] <Month> KO #N` plus
real-but-future clients. Our (Editorial Hub) ETL **drops every row whose name doesn't resolve to
a Hub client** (`if c is None: continue`), so ALL those `[New client] KO` placeholders — including
real deals hiding behind the label (e.g. "Rivian" / "ADP" are currently `[New client] July KO #3`
/ `#4`, identified only in the Comments cell) — are **NOT** in our warehouse. That planned demand
lives ONLY in the sheet today. It belongs in YOUR planning tables (you already model planned/
unsigned clients — `editorial_capacity_plan_demand` uses NEGATIVE client_ids for exactly this).
Below is everything we know about reading + loading it, from our longer time ingesting this sheet.
**These are initial ideas — check your own schemas and polish the plan to your project.**

────────────────────────────────────────────────────────────────────────
SOURCE — Google Sheet
- Spreadsheet: "[Int] Editorial Capacity Planning Model 2026"
  ID `1I6fNQMjs2y4l6IyOxd9QL-QBjB2zGi0mcoV840JDmkI`
- Tab: the **latest versioned ET CP tab**, currently `ET CP 2026 [V15 Jul 2026]`. The name changes
  ~monthly (`ET CP 2026 [V## <Mon> YYYY]`). Pick the highest version (or the one matching the
  current month). Past months are frozen in older version tabs — for a ONE-TIME backfill you can
  read each past version's own-month column, but the latest tab carries the full 12-month forecast.

AUTH
- Service account `graphite-bi-sa@graphite-data.iam.gserviceaccount.com` — has Sheets read on this
  sheet + BigQuery on the sandbox (the same SA your writer_desired seed already uses).

────────────────────────────────────────────────────────────────────────
WHERE THE FORECAST LIVES — the CLIENT block (NOT the capacity/supply block)
The sheet has two stacked blocks. Skip the top **EDITORIAL TEAM CAPACITY** block (pod × slot
supply). The forecast is the lower **CLIENT block**:

1. Find the header row: the row whose first ~8 columns contain a cell == "Client" AND that row
   also has one or more cells == "Pod". Call it `client_hdr_idx`.
2. The **month header is the row ABOVE** `client_hdr_idx` — e.g. "July 2026", "August 2026" sit
   over each month's Pod column.
3. Each month is a group of **7 contiguous columns starting at its "Pod" column**:
   `Pod(+0) · Status(+1) · Category(+2) · %(+3) · Projected(+4) · Delivered(+5) · Comments(+6)`
   (one blank spacer column separates month groups — the +0..+6 offsets stay valid because they
   count from each "Pod" column). Concretely in V15: July = cols AZ..BF, August = BH..BN, etc.
4. Data rows run from `client_hdr_idx + 1` downward. Skip rows where the Client cell is blank or
   contains total/median/average/production.

So the grain you want per non-skipped row × month group:
  { client_label, year, month, pod, status, category, pct, projected, delivered, comment }

────────────────────────────────────────────────────────────────────────
IDENTIFYING THE PLANNED / NEW-CLIENT ROWS (what we drop, you want)
- **Placeholder rows**: name column = `[New client] <Month> KO #N` (green-highlighted in the UI —
  but DON'T rely on cell color via the API; rely on the `[New client]` name prefix). These are
  anticipated signings. Their REAL identity, when known, is written in the **Comments (+6)** cell
  of the month they ramp (e.g. row `[New client] July KO #3` → Comments "Rivian"; `#4` → "ADP").
- **Real-but-future rows**: some upcoming clients appear under their REAL name (e.g. Unvault,
  Justworks). These DO resolve for us and are already in our warehouse (`client_pod_history` +
  `production_history.projected_original`) once they exist as Hub clients — so to avoid
  double-counting, either (a) read those from our resolved tables, or (b) only ingest the
  `[New client] …` placeholders here and let the named ones come through the normal path. Your call.
- Status flips: a placeholder is `inactive` until its KO month, then `active`; future months of a
  row may be blank/`inactive`. Projected can be 0 (not yet quantified) or blank.

────────────────────────────────────────────────────────────────────────
SUGGESTED LOAD (idea — adapt to your schema)
- Target: your planning demand table. You already have the right shape —
  `editorial_capacity_plan_demand` (ym × pod × client_id, NEGATIVE ids = planned/unsigned). A
  `[New client] July KO #3` row maps cleanly to a negative-id planned-demand entry:
  { ym, pod, planned_label: "[New client] July KO #3", resolved_name: "Rivian" (from Comments,
    if present), projected, category, status }.
- Month↔column: parse the month header row above the client header. (Ours uses a helper
  `_parse_et_cp_month_header` that turns "July 2026" → (2026, 7); trivial to reimplement.)
- One-time is fine to start, but note this forecast changes with each new ET CP version — you may
  want it on your daily/periodic trigger later (same cadence question as writer_desired).

REFERENCE — our reader to port (proven, reads the exact block)
- `editorial-hub/backend/app/services/migration_service.py` → `_ingest_et_cp_year()`, section
  "2. Client block" (the `client_hdr_idx` / `pod_cols` / `col_month` logic + the +0..+6 offsets).
  Note: our loop does `c = _resolve_client(lookup, name); if c is None: continue` — YOU want to
  KEEP the `c is None` rows (that's the planned-client forecast). Everything else about parsing the
  block is identical.

Decisions for you (we're only seeding the idea)
1. Table shape + whether to reuse the negative-id `editorial_capacity_plan_demand` convention or a
   dedicated forecast table — your schema, your call.
2. How to key a placeholder's identity: keep the `[New client] … KO #N` label, promote the Comments
   name when present, or leave unresolved until signed.
3. One-time backfill vs. recurring pull (and, if recurring, which trigger).
4. De-dup policy vs. the named-and-resolved future clients (Unvault/Justworks) so planned demand
   isn't counted twice once they become real Hub clients.

Next step (for you)
Confirm the target table + identity scheme, port the client-block reader (keeping the unresolved
rows), do the one-time ingest, and validate the row counts/projections against the sheet. Ping us
if the block layout or any column offset doesn't line up with what you see.
