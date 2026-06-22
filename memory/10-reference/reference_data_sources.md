---
name: reference-data-sources
description: "The 5 source spreadsheets (IDs, tabs→tables, ingest status) + the Notion DB. Includes two doc-drift flags: notion_import.py does NOT exist (real entry = migration_service.import_notion_database), and the ARTICLE_COUNT_ID default differs between config.py and CLAUDE.md."
metadata:
  node_type: memory
  type: reference
  originSessionId: 3fa962ac-9be0-4852-8c63-16ff918094cb
---

# Data Sources & Ingestion Reality

SA: `graphite-bi-sa@graphite-data.iam.gserviceaccount.com`. How they sync → [[reference-sync-architecture]].
Per-tab detail: `frontend/docs/SHEETS_DOCUMENTATION.md`, `sheet-inventory.md`. CLAUDE.md has the
canonical version of this table; this file adds **ingest-mechanics nuance + doc-drift flags**.

## 1. Editorial Capacity Planning — `1I6fNQMjs2y4l6IyOxd9QL-QBjB2zGi0mcoV840JDmkI`
| Tab | → Table | Status |
|---|---|---|
| Editorial SOW overview | `clients` | live (current) |
| Delivered vs Invoiced v2 | `deliverables_monthly` | live (current); self-heals removed/blanked months; 36-month cap removed (Webflow) |
| ET CP 2026 [V## …] | `team_members` + `capacity_projections` + `editorial_member_capacity` | live (`@et-cp` dynamic); past versions via ET CP Pod History (past) |
| Editorial Operating Model | `production_history` (+ `projected_original`) | live (current) |
| Model Assumptions | `model_assumptions` | **past only**; also mirrored to BQ for editorial-planning-hub |
| Delivery Schedules / Engagement Requirements / Meta Calendar | `delivery_templates` / `engagement_rules` / `deliverables_monthly` (subset) | one-time seed |

## 2. Master Tracker — `1dtZIiTKPEkhc0qrlWdlvd-n8qAn5-lhVcPkgHNgoLAY`
| Tab | → Table | Status |
|---|---|---|
| Cumulative | `cumulative_metrics` | live (current) |
| [Month Year] Goals vs Delivery (×9) | `goals_vs_delivery` | current month in `current` (default mode); **all months** in `past` (mode=all). uq (month_year, week, client, content_type) |
| `<YYYY> Week Distribution` | `editorial_weeks` | **past only** — drives "As of" badge + rollover due-check |

## 3. Writer AI Monitoring — `13kl0_6YuzsJ3xEzNLzDZeR-sHMaNJNw6oJGmwb-CBOU`
`ai_monitoring_records` + `surfer_api_usage`. ⏸ **Manual-only (Import Wizard) since 2026-06-22** — the 4 `AI Monitoring - *` importers were removed from `CURRENT_STEPS` (`sync_manifest.py`), so the SYNC button + daily cron + month-rollover skip them (scans paused upstream → recurring "Failed to fetch" noise). Still importable on demand at `/data-management/import` (off-by-default; `DEFAULT_UNCHECKED`). Re-add to `CURRENT_STEPS` to restore auto-SYNC. See [[reference-sync-architecture]].

## 4. Team Pods — `TEAM_PODS_ID` = `10ydCI1mQ5_T6nnMJt9eNHZ32_8NJBkOceiAW6FprjxA`
Chip-based: emails from people-chip metadata via `spreadsheets.get(includeGridData=true)`. Current-month RBAC (`import_growth_pods`) + full import (`import_team_pods`, past) + history (`import_pod_history` → `pod_assignment_history`, past). **CUTOVER 2026-06-12:** editorial assignments now **Hub-first** from BQ `team_pod_assignments_editorial_history` (sheet fallback); growth stays sheet-parsed. Gate `python -m etl.warehouse.hub_parity`. Powers RBAC auto-population (Editorial/Growth Team groups) + per-pod client filter. See [[team-pods-sheet-temporary]].

## 5. Monthly Article Count — `ARTICLE_COUNT_ID`
~100 client tabs (incl. hidden), ~15K rows → `article_records` (+ `article_revisions`). Full rebuild per sync; chunked batchGet 25/call; dynamic header-row detection. Metric definitions → [[metrics-monthly-articles]].
- ⚠️ **DOC DRIFT:** `config.py:42` default = `1X_M82VzstJCulkl6l62jaubn2yI0ODBTz33iZ4XqZWU`; root CLAUDE.md documents the default as `1eRmZFn…`. The **env var (`.env`) is authoritative in prod** — flag this when reconciling. `1X_M82Vz…` is also the copy the additive normalization ran on ([[analysis-normalization-proposal]]).

## 6. Notion Database — ⚠️ doc path is STALE
- All docs cite `backend/app/services/notion_import.py` — **that file does NOT exist.** Real ingestion = `import_notion_database()` in `migration_service.py:4344` (manifest step `Notion Database`, current scope).
- It reads a **dedicated Google Sheet** (`NOTION_DATABASE_ID`, ~23K rows × ~38 cols), **not** the live Notion API. Paginated read (PAGE_SIZE=5000) + **bulk upsert** `INSERT … ON CONFLICT (case_id) DO UPDATE` (BULK_BATCH=500). This is the fix in commit `612c854` (Apr 16) — replaced per-row SELECT/INSERT that overran Railway's proxy timeout.
- → `notion_articles`. Feeds 3 KPIs via `notion_kpi_service.py`: **Revision Rate** (`compute_revision_rate`), **Turnaround Time** (CB→Article delivered days), **Second Reviews** (sr_editor set). `refresh_notion_kpis()` writes `kpi_scores` (run by `@refresh-kpis`). Separately `_apply_notion_published()` joins publish status onto `article_records` ([[metrics-monthly-articles]] §3).

## 7. Two doc-drift flags to remember
1. **`notion_import.py` doesn't exist** — entry point is `migration_service.import_notion_database` reading a Sheet (not the Notion API).
2. **`ARTICLE_COUNT_ID` default mismatch** between `config.py` and CLAUDE.md — env wins.
