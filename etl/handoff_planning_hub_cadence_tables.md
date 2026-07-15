📥 [CC-HANDOFF]
To: @planning-hub session   From: @editorial-hub session (Ricardo)
Project: Cadence / model-assumption tables for new-client mapping
Status: FYI — ready to use

Three BQ tables (`graphite-data.graphite_bi_sandbox`) let you map a NEW client to a cadence +
capacity model — e.g. a dropdown that picks the delivery model and seeds the client's monthly plan.

## 1. `editorial_raw_delivery_templates` — THE CADENCES  (the dropdown source)
Per SOW size (**240 / 220 / 180 / 120 / 125**), the 12-month article distribution. Columns:
`sow_size`, `month_number` (M1–M12), `delivery_target` (articles that month),
`delivery_cumulative` (running total, quarterly checkpoints), `invoicing_target` /
`invoicing_cumulative`. **Default / normal = 180.** Example (180, front-loaded ramp):
M1 0 · M2 5 · M3 10 · M4 15 · M5 25 · M6 26 · M7–9 20 · M10–12 13  →  Σ 180.

**New-client dropdown → seed the plan:**
```sql
SELECT month_number, delivery_target
FROM `graphite_bi_sandbox.editorial_raw_delivery_templates`
WHERE sow_size = @picked_model         -- 240 | 220 | 180 | 120 | 125
ORDER BY month_number
```
`delivery_target` per month = the projected article cadence to write into your {projected, actual}
store when a new/KO client is added (anchor M1 to the client's editorial-KO month).

## 2. `editorial_raw_model_assumptions` — THE PARAMETERS
14 rows (`category` · `key` · `value` · `description`):
- **CLIENT_CATEGORIZATION** — standard 70% / specialized 30%  (specialized = the ×1.4 weight).
- **RAMP_UP_PERIODS** — Sr Editor `M1=80%, M2=100%`; Editor `M1=0–33%, M2=80%, M3+=100%`.
- **WEEKLY_MONTHLY_CAPACITY** — Sr Editor 20/mo, Editor 60/mo (higher on 5-week months).
- **IDEAL_CAPACITY** — 80–85% green · 85–100% yellow · <80% / >100% red.
- **NEW_CLIENTS_PER_POD** — min 1, max 2 (special cases / backfills).
Use these for onboarding ramp-up + "can this pod take another new client?" checks.

## 3. `editorial_writer_desired` — writers' self-reported desired article total (your Writers basis)
`writer_canonical, ym, desired, days, clients, ooo, weekly_breakdown, current_assignments`.

## Built + freshness (confirmed 2026-07-15)
- **delivery_templates** (60 rows) + **model_assumptions** (14 rows): built + in BQ, synced today.
  The **sheet→Neon import runs on the PAST / month-rollover scope** (they change rarely) — NOT the
  daily current cron — but the **Neon→BQ publish runs daily**, so the BQ tables are always present +
  refreshed daily. If someone edits the *Delivery Schedules* / *Model Assumptions* sheet and you need
  it immediately, run **Re-sync Past Months** (else it lands on the next month rollover).
- **editorial_writer_desired** (280 rows, ym 202509–202607): fully **daily** (current-scope
  `@writer-desired` step); published today. Never stale.

All three work as expected on the current triggers — nothing else needed from us.

## How this fits the Option-(b) store
When you add a new (or planned/KO) client to your per-client×month {projected, actual} store, pick the
SOW model in the dropdown → read table #1 for the cadence → apply categorization/ramp from table #2.
That's the new-client seed without touching the sheet — the single-source flow.
