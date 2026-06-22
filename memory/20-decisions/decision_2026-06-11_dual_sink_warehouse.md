---
name: decision-2026-06-11-dual-sink-warehouse
description: "Decision: publish the layered warehouse to BOTH Postgres `warehouse` schema (app serves this, default) AND BigQuery (mirror/backup) from the same in-memory rows in one ~20s pass — chosen over BQ-only after a 4-agent adversarial audit."
metadata:
  node_type: memory
  type: decision
  originSessionId: 3fa962ac-9be0-4852-8c63-16ff918094cb
---

# Decision — Dual-sink warehouse, 2026-06-11

Architecture detail → [[reference-warehouse-layered-model]]. Original migration decision →
[[decision-2026-06-09-etl-bq-migration]]. Serving cutover → [[bq-serving-cutover]].

## The decision
After a 4-agent adversarial audit of a **BQ-only** repoint (Ricardo: "keep the mix… after you audit please implement it"), publish the same in-memory processed rows to **BOTH** sinks in one ~20s parallel pass:
1. **Postgres schema `warehouse`** — what the app serves by default (`DASHBOARD_SOURCE=postgres`, ~10-20ms reads).
2. **BigQuery `graphite_bi_sandbox`** — always-fresh analytics mirror + backup.

The per-request `X-Data-Source` override is gated by `DATA_SOURCE_OVERRIDE_ENABLED` (off in prod).

## Why (over BQ-only)
- **Same numbers by construction** — one row set → both sinks; table-level drift is impossible; the views are dialect translations kept in lockstep, **proven by the endpoint parity harness**.
- **Postgres latency** for interactive users; **BigQuery availability** for analysts/backup.

## What it bought / required
- Layered model: 19 raw + 9 int + 20 views (was a 36-table flat mirror).
- The 4-agent audit raised 2 critical + 14 major issues, all fixed (prod Dockerfile `COPY etl/`, deliveryMeta end-date fold, flush failure isolation, wizard publish 500, synthetic-step flag, id tiebreaks).
- Parity re-verified: function parity 3,612 fields + 1,233 period-map check; endpoint parity 53/53.

## Sequel
This set up the **2026-06-19 BQ serving cutover** (`DASHBOARD_SOURCE=bq` + in-process cache, commit `c7cb29d`) to cut Neon egress — the dual-sink made that a read-flip, not a data migration. See [[bq-serving-cutover]]. Phase 2 (later): optionally stop writing the Neon `warehouse` sink to save storage.

## Reconciled fact
The dual-sink-era note said "endpoint parity 53/53"; the Jun-12 migration-finalized note flagged "53" as a miscount → validated **52/52** at the time. The 2026-06-19 endpoint_parity run (a slightly larger matrix) is **53/53**. Both are correct for their run.
