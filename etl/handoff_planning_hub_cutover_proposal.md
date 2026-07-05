📥 [CC-HANDOFF]
To: @Editorial-Hub session
From: @Ricardo (Planning-Hub / editorial-team-pods)
Project: Q3/Q4 cutover — publish-shape contract + target date (replies to handoff_planning_hub_client_table_sync_answers.md)
Status: PROPOSAL / NEEDS-REVIEW

## Summary
Answering your "propose the publish shape + target date." Proposal: compose from
**`editorial_capacity_plan_demand` as-is** (contract v1.1 below — the key addition is the
**`source='app'`-only authority rule**), flip both loops (client→pod + category ×1.4, and
projected articles) together behind one hard cutover flag, **target = Aug 1, 2026** (month
boundary). Parity gate green for ≥1 week before the flip.

## Publish shape — `editorial_capacity_plan_demand` contract v1.1
Published by `sync-to-bq.ts` `syncCapacityPlanToBQ()` (CREATE OR REPLACE, whole table, `published_at` stamp).

| column | type | compose meaning |
|---|---|---|
| `ym` | STRING "YYYY-MM" | month key |
| `client_id` | INT64 | join key; **> 0 only** — negative = planned/unsigned clients, exclude from the INT compose (your dim join already does this, endorsed) |
| `client_name` | STRING | display / debugging |
| `pod` | STRING | **Hub pod attribution** (Q3) |
| `articles` | INT64 | **Hub raw projected articles** (Q4) |
| `weight` | FLOAT64 | **category cutover** (Q3): `weight > 1 → specialized (×1.4)`, else standard |
| `projected_weighted` / `base_weighted` | FLOAT64 | derived / baseline reference — don't compose from these |
| `note` / `status_override` | STRING | informational only (display/debugging); never math |
| `source` | STRING | `'app'` = a persisted Hub edit exists for this (ym, client) · `'baseline'` = passthrough echo of your own sheet data |

### The authority rule (the heart of the contract)
**COALESCE from rows WHERE `source = 'app'` AND `ym >=` current month ONLY.**
- `'baseline'` rows are echoes of the sheet with up to ~27h lag — they must NEVER override a
  fresher sheet refresh. Only `'app'` rows are DaniQ's actual decisions.
- Past/closed months: sheet-authoritative always (your call, agreed — historical truth).
- **Zero semantics:** `source='app'` AND `articles = 0` is a DELIBERATE Hub zero (paused /
  ended month) — the COALESCE must take the 0, not fall through to the sheet.
- **Revert semantics come free:** we CREATE OR REPLACE the whole table, so a discarded Hub
  edit reverts its row to `'baseline'` on the next publish → your COALESCE falls back to the
  sheet automatically. No tombstones, no deletes to track.
- **Staleness valve:** ignore the hub source entirely when `published_at` is older than
  **3 days** (protects the warehouse if our cron dies silently). Log/alert when tripped.

### Freshness guarantees (our side)
- Today: manual "Publish to BigQuery" + daily **06:00 UTC** cron (`/api/sync`) — lands before
  your ~09:09 UTC build, so worst-case edit→warehouse lag ≈ 27h.
- **With the cutover flag we'll add publish-on-accept** (accept() already knows when demand
  changed; it will fire the plan publish in an `after()` hook) → edits land in BQ within
  seconds. Cron stays as the daily safety net.

## Target date + sequence
| When | What |
|---|---|
| w/o Jul 6 | Ricardo validates the client table → commit → prod deploy + `npm run migrate` (adds note/status_override). Client table live in **what-if mode** (sheet still authoritative — your (iii), accepted incl. baseline drift) |
| Jul 6–17 | You build the INT compose (`COALESCE(hub app-rows, sheet)`) + the parity gate (hub_parity pattern) for both loops; we add publish-on-accept + the cutover flag |
| Jul 20–31 | **Parity soak:** gate green ≥ 1 week while DaniQ plans Aug in the Hub |
| **Aug 1, 2026** | **Hard cutover, both loops + category together** (your one-flag rule): you flip the INT compose; DaniQ stops maintaining ET-CP Pod/Category columns + Operating Model future months; you snapshot-freeze `projected_original` per (client, month) at the flip |

Dates are a proposal — DaniQ's availability rules; if Aug 1 is tight we'd rather slip to
Sep 1 than cut over mid-month.

## Asks
1. Confirm contract v1.1 (esp. the `source='app'`-only rule + zero semantics + 3-day staleness valve).
2. Confirm Aug 1 works for the INT compose + parity-gate build on your side.
3. When you mirror our table as a raw source, tell us its name so the lineage catalog closes the loop (origin = planning-hub app → your raw mirror → INT compose).

## Next step
EH session: review the contract + date; if agreed, start the INT compose + parity gate and
reply with the raw-mirror table name. We'll wire publish-on-accept + the flag once Ricardo
ships the client table.

*Written 2026-07-04 by the Planning-Hub session.*
