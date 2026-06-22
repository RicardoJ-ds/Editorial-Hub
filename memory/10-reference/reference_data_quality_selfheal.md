---
name: reference-data-quality-selfheal
description: "Current state of /admin/data-quality: the tabs, the write-from-UI → consumed-by-lookup → resolves-next-sync self-heal mechanics (ClientNameAlias / PodNameOverride / article_name_aliases), keep-visible status + Undo, and the get_db()-must-commit gotcha."
metadata:
  node_type: memory
  type: reference
  originSessionId: 3fa962ac-9be0-4852-8c63-16ff918094cb
---

# Data Quality Self-Heal — current state

`/admin/data-quality`. The shipped implementation of [[pod-history-and-dq-selfheal]] (that's the
plan; this is what's live). Sourced from `GET /api/admin/discrepancies` + `GET /api/admin/pod-history`
(`backend/app/routers/admin.py:199`, `:752`).

## Tabs (scoped by a `TAB_LENSES` View selector: All / Delivery & Contracts / Team KPIs / Platform)
- **End-date drift** — SOW `clients.end_date` vs Operating Model last actual/projected month; filters ±`min_end_date_diff_months` (default 2). + How-to-fix.
- **Delivered drift** — 4-source compare (Ops Model, Delivered vs Invoiced, Cumulative `articles_sent`, SOW `articles_delivered`), span-coloured, summed through editorial "as of". + Problem / Where-it-hits.
- **Missing from Hub** (0.3.24, own tab) — clients in a source sheet with no Hub record (data dropped). From `missing_clients` ← `incomplete_clients` populated by `_record_incomplete_client()` (`migration_service.py:153`) in Delivered/Invoiced, Operating Model, Meta importers + ET CP history.
- **Pod assignment issues** (0.3.10) — unmatched Growth-pod names → map via `AssignDropdown`.
- **Pod coverage** — article-months with `editorial_pod IS NULL`; names both sources (MAC + ET CP) + how-to-fix.
- **Pod History** (merged 0.3.21 from Pod Drift + Missing SOW + Not-in-SOW-Overview) — chips RESOLVED / POD DRIFT / INCOMPLETE SOW / NOT IN SOW OVERVIEW; per-row `missing_fields`.
- **Article mappings** — MAC normalization: unresolved client tabs + editor variants; posts `article_name_aliases` via `POST /api/articles/aliases`, reads `/api/articles/unmapped`. See [[analysis-normalization-proposal]].
- **Modeling Limitations** (own tab since 0.3.21).

## Self-heal mechanics: write-from-UI → consumed-by-lookup → resolves-next-sync
| Alias table | Written by | Consumed by | Effect |
|---|---|---|---|
| **`ClientNameAlias`** (`client_name_aliases`) | Missing-from-Hub "Map to client" (`POST .../missing-clients/{id}/map`, `admin.py:507`) | `_add_user_client_aliases()` → `_build_client_name_lookup()` (`migration_service.py:4600,4614`) used by OM / Delivered / Meta / ET CP importers | name resolves next sync, stops being flagged |
| **`PodNameOverride`** (`pod_name_overrides`) | Pod-assignment-issues (`POST .../pod-name-overrides`, `admin.py:647`) | `import_growth_pods()` — DB overrides checked **before** static `_GROWTH_POD_NAME_OVERRIDES` then fuzzy substring | matched names clear their `PodImportIssue.resolved_at` |
| **`ArticleNameAlias`** (`article_name_aliases`) | `POST /api/articles/aliases` | article importer (`:6095`); kind `client` re-routes tab→client (+pod), `editor` merges variants; supports **date window** (`valid_from`/`valid_to`) | self-heals next import |

**Keep-visible status + Undo** (0.3.24): `discrepancies` returns ALL rows tagged `status` (open / mapped→client / dismissed / resolved) + `mapped_to`, so resolved rows stay logged. UI = All / To-do / Resolved chips. Per-row Undo: `POST .../missing-clients/{id}/reopen` (`admin.py:546`, deletes the `ClientNameAlias` + clears `resolved_at`); `POST .../pod-import-issues/{id}/reopen` (`:572`). Dismiss (`.../dismiss`, `:482`) sets `resolved_at` for noise.

## ⚠️ The `get_db()`-must-commit gotcha
`get_db()` **never auto-commits** — every mutation endpoint must `await db.commit()`; a bare `flush()` rolls back at request end. This **silently dropped every `PodNameOverride`** (a flush-only bug). Now `create/delete_pod_name_override` commit explicitly (`admin.py:683,705`, warning at `:681`). **Any new DQ mutation endpoint must commit.** See [[get-db-no-commit-gotcha]].

## Persistence tables (`models.py`)
`PodImportIssue` (`:730`, uq raw_name+pod_kind, resolved_at) · `PodNameOverride` (`:755`, FK clients) · `ClientPodHistory` (`:777`, one authoritative pod per client/month from ET CP + `category` standard/specialized) · `IncompleteClient` (`:818`) · `ArticleNameAlias` (`:945`, windowed) · `ClientNameAlias` (`:974`) · `ArticleUnmappedName` (`:992`). Backfilling editorial pod from history = a past-resync step (`backfill_editorial_pod_from_history()`).

## Dated milestones
| Date | Ver | What |
|---|---|---|
| May 14 | 0.3.10 | DQ Pod assignment issues tab + `pod_import_issues` + Growth-pod fuzzy self-heal (first self-heal surface) |
| Jun 8 | 0.3.21 | Pod History merged tab; Modeling Limitations own tab; Backfill-editorial-pod resync step |
| Jun 8 | 0.3.24 | Missing-from-Hub tab; keep-visible status + Undo; pod-override commit bug fixed |
