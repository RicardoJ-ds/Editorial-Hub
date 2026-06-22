---
name: bq-serving-cutover
description: "Prod dashboards now serve from BigQuery + an in-process cache (DASHBOARD_SOURCE=bq); Neon thinned to writes/RBAC. Rollback, residual risk, how it was verified."
metadata: 
  node_type: memory
  type: reference
  originSessionId: 23c6899d-f043-4d1c-9662-68a72342385a
---

**As of 2026-06-19, prod dashboards serve from BigQuery, not Neon.** Commit
`c7cb29d` added the read-cache; the cutover itself was **Railway env-vars only**
(no further code change). Goal: cut Neon egress (the free-tier cap was hit once).

**Prod Railway vars now:** `DASHBOARD_SOURCE=bq`, `DATA_SOURCE_OVERRIDE_ENABLED=false`,
`BQ_CACHE_ENABLED=true`. (Defaults in `config.py` stay `postgres`/off — prod overrides via env.)

**How it works** (`backend/app/services/bq_cache.py`):
- Every BQ `q()` result is cached in-process, keyed by `(sql, params, publish_token)`.
- The token lives in the one-row **`cache_version`** table (created+seeded by `main._run_data_migrations`); the **`@warehouse-publish` step bumps it** (`sync_manifest._warehouse_publish_run` → `bq_cache.bump_token`), so a SYNC shows fresh numbers within `cache_token_poll_seconds` (5s) on every instance. `bq_cache_ttl_seconds` (600) is the fallback; serves last-good on a BQ error.
- The per-request **RBAC resolve is cached 30s** (`access.resolve_access_cached`, `rbac_cache_ttl_seconds`) — it's the dominant Neon read now; returns deep copies so preview-as can't corrupt cached profiles. Revocations propagate within 30s (+ the frontend tab-focus refetch).
- Neon is now write-only + one source-read per publish (the build). RBAC/comments/usage/DQ/mutations stay on Neon. **Source writes were deliberately NOT moved to BQ** (the importers read ~11 Neon tables back for self-heal; zero egress benefit) — see [[goals-rename-orphan]] for the read-back set.

**Rollback (complete, 1 var):** Railway `DASHBOARD_SOURCE=postgres` → redeploy/restart. The postgres path reads the live `public` tables directly (NOT the Neon `warehouse` schema — nothing reads that at request time), so it can't be stale. Setting a var triggers a Railway redeploy (~80s); `DASHBOARD_SOURCE` is read at process start.

**Residual risk:** a BQ outage with a COLD cache returns errors (the postgres-fallthrough was NOT wired — would've meant 24 router edits). Warm-cache BQ blips are covered by serve-stale. If BQ is down, the answer is the 1-var rollback.

**Verified at cutover:** `etl.warehouse.endpoint_parity` (postgres vs bq, override on, cache off) = **52/52 IDENTICAL**; clients/Dr Squatch/n8n-preview correct on BQ; token bumped 0→1 by a publish; 8 cache unit tests (`backend/tests/test_bq_cache.py`).

**Open follow-ups:** (1) measure the Neon egress drop (Neon console, 7-day before/after). (2) Phase 2 (optional, later): stop writing the Neon `warehouse` schema sink to save storage — re-grep `FROM warehouse` first; rollback stays via `public`. (3) Consideration: one shared BQ dataset `graphite_bi_sandbox` for local+prod → a local `@warehouse-publish` clobbers prod BQ (now that prod READS it, this matters more — don't publish locally). Plan: `~/.claude/plans/jiggly-snuggling-kahn.md`.
