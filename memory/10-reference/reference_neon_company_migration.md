---
name: reference-neon-company-migration
description: "Runbook (NOT yet executed) to move editorial-hub's Postgres off Ricardo's personal Vercel/Neon onto Graphite company Neon via pg_dump/restore + Railway DATABASE_URL repoint. Pooled-vs-direct gotcha; one-var rollback."
metadata:
  node_type: memory
  type: reference
  originSessionId: 3fa962ac-9be0-4852-8c63-16ff918094cb
---

# Neon Company Migration (runbook — not yet executed)

Move editorial-hub's Postgres off **Ricardo's personal** Vercel/Neon onto the **Graphite company**
Neon. Doc: `../90-archive/neon-company-migration.md`. **Status: planning runbook only** — the file is
untracked in git, has no CHANGELOG entry, and has not been run.

## Why dump-and-restore (not a Vercel transfer)
The integration-level transfer is **blocked** — Graphite already has a Neon marketplace install and Vercel won't allow two. So: logical `pg_dump` → `pg_restore` + a Railway `DATABASE_URL` repoint.

## Confirmed facts
PG **16.14** · schemas `public` (36 tables = source data + write surface) + `warehouse` (12 tables, **regenerable** by a sync) · only default `plpgsql` extension · **~81 MB** (dump/restore is seconds).

## Steps (0–8)
0. Rollback anchor — copy current Railway `DATABASE_URL`.
1. (Ricardo) create company Neon DB (PG16, same region as Railway; grab Direct + Pooled strings).
2. Quiesce writes — `SYNC_CRON_ENABLED=false` + Ops holds RBAC/comment edits (~10-min window).
3. `pg_dump` via **direct** source URL (`--format=custom --no-owner --no-privileges --no-acl`).
4. `pg_restore` via **direct** target URL (`--schema=public --schema=warehouse`).
5. Verify row counts match (`pg_stat_user_tables` diff).
6. Cutover — Railway `DATABASE_URL` → company **pooled** URL.
7. Verify prod (`/docs`, `/api/clients/`, `/api/access/me`, `/api/migrate/status` = 200).
8. Resume cron + one manual SYNC; after ~1 day delete the personal Neon project (only data-loss action).

## Gotchas
- **Pooled vs direct:** repoint the app to the **same endpoint type** it uses today (likely pooled). asyncpg + Neon's transaction pooler + prepared statements clash if switched blindly; use **direct only for dump/restore**.
- `warehouse` schema is regenerable, but copying it makes dashboards work instantly at cutover.
- **Division of labor:** Ricardo does all Vercel/Neon/Railway dashboard actions; shell does the data copy + verify.
- **Scope:** two DBs under the personal integration — **editorial-hub** (this runbook) + **editorial-team-pods** (the Planning Hub, migrate separately from its own repo).

## Relationship to the egress work
The doc's "Phase 2" (egress reduction — the warehouse publish re-reads all source tables from Neon every run) **already largely shipped** as commit `c7cb29d` (BQ serving cache + RBAC cache), **ahead of** this migration. See [[bq-serving-cutover]].
