---
name: Pod History + Data Quality Self-Heal Plan
description: Implementation plan for ET CP pod history ingestion, incomplete-client tracking, and Data Quality self-heal UI
type: project
originSessionId: 64b08894-7fc6-4aca-8b18-05b3f98176b9
---
## Feature 1 — Data Quality: Self-Heal UI for Pod Assignment Issues

**Goal:** Let users resolve unmatched BQ→DB client name mappings from the UI without a code deploy.

### Backend
- New DB table `pod_name_overrides` (id, raw_name, pod_kind, canonical_client_id, created_by, created_at)
  - `raw_name`: the BQ name (e.g. "Meta Reality Labs")
  - `pod_kind`: "growth" | "editorial"
  - `canonical_client_id`: FK → clients.id
- New API endpoints:
  - `GET /api/admin/pod-name-overrides` — list all active overrides
  - `POST /api/admin/pod-name-overrides` — create/update a mapping `{ raw_name, pod_kind, client_id }`
  - `DELETE /api/admin/pod-name-overrides/{id}` — remove a mapping
- `import_growth_pods()` in migration_service.py: before checking `_GROWTH_POD_NAME_OVERRIDES` (static dict), first check `pod_name_overrides` table. DB overrides take precedence over code dict.
- When a mapping resolves successfully → mark `pod_import_issues` row as resolved.

### Frontend (Data Quality → Pod Assignment Issues tab)
- Each row gets an "Assign" button (or inline dropdown)
- Dropdown lists all clients from `/api/clients/` (typeahead search)
- On confirm → POST to `/api/admin/pod-name-overrides`
- Row updates to show "Mapped → [Client Name]" with a green chip
- On next SYNC the row self-resolves and disappears
- Show a "Pending SYNC" state after saving so user knows to re-sync

---

## Feature 2 — ET CP Pod History Ingestion

**Goal:** Build `client_pod_history` from all historical ET CP version tabs, one confirmed data point per tab.

### Key constraint (from user)
Each ET CP version tab "ET CP 2026 [VN Month Year]" has full-year columns, but ONLY the tab's own month column (and earlier) are confirmed historical assignments. Columns AFTER that month are projections. Strategy: for each tab, read only the column matching the tab's month as the authoritative pod assignment for that month.

### New DB table: `client_pod_history`
```
id, client_id (FK clients.id nullable — stubs allowed), 
client_name_raw (varchar), year (int), month (int),
editorial_pod (varchar nullable), source_tab (varchar),
created_at, updated_at
UNIQUE (client_id, year, month) when client_id is not null
UNIQUE (client_name_raw, year, month) as fallback
```

### New DB table: `incomplete_clients`
Clients found in ET CP tabs but NOT in SOW Overview (no clients table entry).
```
id, name_raw (varchar unique), first_seen_tab (varchar), last_seen_tab (varchar),
first_seen_year (int), first_seen_month (int),
last_seen_year (int), last_seen_month (int),
known_pods (varchar) — comma-separated pod labels seen across tabs,
resolved_at (datetime nullable) — set when client is found in SOW overview on a later sync
```

### New importer: `import_et_cp_pod_history(session)`
1. List all sheet tabs in the Editorial Capacity Planning spreadsheet
2. Filter to tabs matching `r"ET CP \d{4} \[V\d+ (Jan|Feb|...) \d{4}\]"`
3. For each tab, extract month/year from the tab name
4. Read the tab's "Client" column (col A or C based on layout) and "Pod" column for that month
5. Each month in ET CP has a "Pod" dropdown column — read only the column for the tab's own month
6. For each client row:
   a. Try to match to `clients` table (exact + fuzzy same as growth pods importer)
   b. If matched → upsert `client_pod_history` row
   c. If not matched → upsert `incomplete_clients` row + still write `client_pod_history` with client_id=null, client_name_raw=raw_name
7. When a client is in `incomplete_clients` AND gets matched on a later run → set `resolved_at`, create proper `client_pod_history` rows with real client_id

### Dashboard fallback (non-breaking)
- `GET /api/clients/` endpoint: optionally include `last_known_editorial_pod` derived from `client_pod_history` for clients where `editorial_pod` is null
- FilterBar: when filtering by editorial pod, include clients where `editorial_pod = X` OR `last_known_editorial_pod = X` (only for null-pod clients, not as override)
- This solves DaniQ's "Athena not appearing in Growth Pod 1" — inactive clients with null current pod fall back to last known

---

## Feature 3 — Data Quality: Incomplete Clients Tab

**Tab label:** "Missing SOW data"
**Shows:** Every row in `incomplete_clients` where `resolved_at` is null
**Columns:** Client name (raw) | Pods seen | First seen (month/year) | Last seen (month/year) | Missing fields chip
**Purpose:** DaniQ can use this list to backfill the SOW Overview sheet. When she does and SYNC runs, the client moves from `incomplete_clients` to `clients` and the row disappears.

---

## Implementation order
1. Feature 1 (Self-heal UI) — backend + frontend, no new ingestion needed
2. Feature 2 (Pod history ingestion) — backend only, new importer + tables + startup create_all
3. Feature 3 (Incomplete clients DQ tab) — frontend addition, data comes from Feature 2

## ET CP sheet reading notes
- Spreadsheet ID: from SPREADSHEET_ID env var (Editorial Capacity Planning)  
- Tab pattern: "ET CP 2026 [V13 May 2026]" → month=May, year=2026
- The "Pod" column for a given month is likely a dropdown alongside the "Client" column
- Need to read the actual month column headers to locate the right column index per tab
- Use `spreadsheets.get(includeGridData=true)` for chip/dropdown data, or `.values().get()` for plain values
