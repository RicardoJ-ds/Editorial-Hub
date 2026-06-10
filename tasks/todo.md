# Editorial Hub — Task Tracker

> **Last reviewed:** 2026-06-10

## 🚧 In progress

### ETL→BigQuery migration + capacity UI + DaniQ report (started 2026-06-10)

Objective (Ricardo): mirror today's ingestion behavior exactly in a dedicated ETL that
lands everything in BigQuery; prove the dashboard fed from BQ would show the same
numbers; document every DQ caveat + name mapping (before/after) for DaniQ in a simple
non-technical report; add writer mappings; surface capacity-utilization processed +
final tables in the UI; redesign the revisions-family KPI section + matrix.

- [x] **Phase 0 — STEP 0 audit**: 6 parallel auditors; inventory gaps fixed in
      ETL_INVENTORY.md; capacity golden numbers verified; BQ write access proven;
      name-coverage gaps absorbed into the dictionaries
- [x] **Phase 1 — Writer mappings**: dictionary generated (roster = pod sheet ∪
      historical full names); 78 renames APPLIED via article_name_aliases
      (kind='writer', source='etl', reversible); 244→208 distinct names, ~70% rows
      full-named; ambiguous/legacy flagged for DaniQ
- [x] **Phase 2 — ETL → BigQuery**: etl/ package built (run/manifest/extract/
      transform/load/parity/build_mappings); 27 tables + 5 marts + 3 mapping tables
      in `graphite_bi_sandbox.editorial_*`; capacity math shared via
      `app/services/capacity_calc.py`; **PARITY_REPORT.md = FULL PARITY** (fingerprints
      + 4 endpoint replays byte-identical); `--scope current` ingest+publish proven
      end-to-end. BONUS fix: `_parse_member_breakdown` space-separated combined cells
- [x] **Phase 3 — Dashboard UI**: Capacity by Pod tab + SectionIndex + NEW Client
      Contributions + NEW Utilization Trend (member × month heat matrix) + new
      endpoints client-contributions / member-utilization-matrix; Monthly Articles
      metric SUB-TABS + KPI strip + matrix Expand-all + rate heat tint. tsc + prod
      build green. ⚠️ visual check pending (Playwright blocked by OAuth — needs one
      manual login in its browser profile)
- [x] **Phase 4 — DaniQ report v2**: rewritten non-technical with decisions D1–D8,
      shipped-fixes section, embedded before→after tables, numbers appendix
- [x] **Phase 5 — wrap**: memory updated; scoped commits on main (not pushed)

#### Review (2026-06-10)
ETL phase 1 (strangler): ingestion = the same sync_manifest steps as the SYNC
button (exact behavior by construction); publish mirrors all dashboard tables to
BQ with canonical-name columns ADDED (originals untouched) + computed marts.
Parity proven two ways (table fingerprints + endpoint replays). Writer mappings
live + reversible. Pending: DaniQ decisions D1–D8, phase-2 direct sheet extract,
repoint reads to BQ behind a flag, date-parse/Felt/jumbo-LP fixes.

### Data Quality — normalize tabs + keep mapped rows visible (approved 2026-06-09)

UI fixes done: Map picker → app's `AssignDropdown` (searchable/portaled, "From SOW Overview" hint);
Dismiss de-emphasized (gray text); intro clarifies Hub clients = SOW Overview rows.

Approved plan (selective — keep each tab's essential columns):
- **Missing from Hub** — keep-visible: Status (Open/Mapped→X/Dismissed/Resolved) + All/To-do/Resolved
  filter; backend returns resolved rows tagged; add Reopen (undo). [B already done]
- **Pod assignment issues** — keep mapped rows visible w/ status (today vanish after SYNC).
- **Pod history** — ADD "How to fix" per status; KEEP month timeline + all cols.
- **Pod coverage** — ADD "Where it hits" (+ how-to-fix).
- **End-date mismatch** — ADD "How to fix".
- **Delivered drift** — ADD "Problem" + "Where it hits" (cols only; keep the 4 source counts + Span).
  (Earlier "don't touch" was about layout, not context columns.)
- Article mappings (already a running log ✓) + Modeling notes (static) — leave.

#### Review (done 2026-06-09)
- **Backend** (`admin.py`): `MissingClientItem` + `PodImportIssueItem` now carry
  `status` (open/mapped/dismissed/resolved) + `mapped_to`; `/discrepancies` returns
  ALL rows tagged (no more hide-on-resolve). Added `POST .../{id}/reopen` (undo) for
  both feeds. **Root-cause bug fixed:** `create_pod_name_override` +
  `delete_pod_name_override` only `flush()`-ed — `get_db()` never commits, so every
  pod-name override silently rolled back (pod mapping never persisted). Both now
  `commit()`. Verified lifecycle via API: open→dismissed→open, open→mapped→open,
  pod override→mapped→reopen; DB left clean (0 residue).
- **Frontend** (`data-quality/page.tsx`):
  - Map picker → styled searchable `AssignDropdown` (generalized w/ `onConfirm`);
    Dismiss de-emphasized; intro clarifies Hub clients = SOW Overview rows.
  - `MapStatusBadge` shared by both mapping tabs. Missing from Hub + Pod issues now
    keep resolved rows visible with All / To-do / Resolved chips + per-row Undo.
  - Context columns: End-date (How to fix) · Delivered drift (Problem + Where it hits,
    via `driftDiagnosis`) · Pod history (How to fix per bucket, month timeline kept) ·
    Pod coverage (How to fix; where-it-hits invariant → intro).
  - `tsc --noEmit` clean · `npm run build` clean.

---

### Data Quality — refactor Delivered Drift (Operating Model) tab + surface missing clients

Source: Ricardo (2026-06-08). Both A (UX/clarity) + B (surface "client in sheet but
not in the Hub"). Must show WHERE to fix (spreadsheet + tab) for every source/issue.

**Key finding:** `IncompleteClient` table already captures Operating-Model + ET-CP
not-found clients (with `first_seen_tab`/`last_seen_tab` + `resolved_at` self-heal) —
but NO endpoint surfaces it (the old `/incomplete-clients` route was removed). Delivered
vs Invoiced + Meta Deliveries don't even record it yet.

- [x] **Backend:** shared `_record_incomplete_client()` helper; wired into `import_delivered_invoiced`
      + `import_meta_deliveries` (Operating Model refactored to use it; ET CP already records); added
      `missing_clients` to `/api/admin/discrepancies` (unresolved + query-time normalized self-heal, no
      GET writes); added `POST /api/admin/missing-clients/{id}/dismiss` (sets `resolved_at`, returns JSON).
- [x] **Frontend (A):** `DeliveredDriftTab` refactor — collapsible "How to read this" with the 4 sources
      defined in plain language + origin (spreadsheet + tab + ExternalLink), summary strip,
      Major/Minor severity grouping via group-header rows.
- [x] **Frontend (B):** `MissingClientsSection` — name + source tab + "add to Editorial SOW overview"
      link + Dismiss button; leads the tab.
- [x] Live-verified: discrepancies returns missing_clients=36 + delivered_drift=38; dismiss route
      registered (404 on bad id). tsc + build clean. 0.3.24 + changelog + CLAUDE.md.

**Review:** Reused the orphaned `incomplete_clients` table (was written but never surfaced since the
`/incomplete-clients` route was removed) rather than a new table. Every source/issue now shows WHERE
to fix it (spreadsheet + tab).
**Layout v3 (Ricardo feedback, final):** I'd wrongly touched the Delivered drift table — **reverted it
to original (untouched)**. "Missing from Hub" is now its **own dedicated tab** (red ⚠ + count). Columns:
Name · Problem · How to fix (`suggestFix` heuristic) · Where it hits (dashboard section) · Source
(tab · spreadsheet, linked) · Action.

**Map action (Ricardo, "only if some are mappable" — they are):** added **Map to existing Hub client**
alongside Dismiss. Data confirmed mappable cases (`WL/SG support (Feb)`→Workleap+Sharegate, `Rox (support)`→Rox,
`Meta FoA`→a Meta client). Backend: new `client_name_aliases` table (`ClientNameAlias`) + `_add_user_client_aliases()`
folded into `_build_client_name_lookup(clients, session)` (Operating Model + ET CP) and the manual lookups
(Delivered + Meta); `POST /api/admin/missing-clients/{id}/map` writes the alias + resolves the stub. Frontend:
per-row client `<select>` → map. Live-verified the resolver consults the alias (with-session resolves, without=None).
tsc + build clean. Git commit/tags still pending.

---

### Sync encapsulation + month-rollover auto-resync (single source of truth)

Source: Ricardo (2026-06-08). Goal: ONE canonical definition of "what gets
synced", tagged current/past, that every trigger (manual SYNC, Re-sync Past
Months, month-rollover, future cron, agent) consumes. Add an importer once →
it flows everywhere. Found 4 drift-prone copies today (IMPORT_DISPATCH, frontend
IMPORTABLE_EXACT, backend _resync_step_registry + frontend RESYNC_STEPS w/ a
"keep in sync" comment, plus divergent sync_all). `import_all()` writes the
audit-log "synced" row → keep all sheet imports flowing through it.

- [x] **Phase 1 — backend manifest:** `sync_manifest.py` (ManifestStep + CURRENT/PAST
      lists + resolve_plan/run_step/monthly_resync_due); extracted `refresh_computed_kpis()`;
      endpoints `GET /sync-plan`, `POST /sync-step`, `POST /sync-run`, `GET /monthly-resync-status`;
      `goals-historical-resync` + `/resync/{step}` now delegate to the manifest. Live-verified:
      sync-plan current=14/past=5/full=19, monthly-resync-status → due:true (June, last goals May 25),
      sync-step @refresh-kpis ran (29 mo / 971 scores).
- [x] **Phase 2 — frontend derives:** SyncAllModal + HistoricalResyncTab read `/sync-plan`
      and run `/sync-step`; deleted IMPORTABLE_EXACT + RESYNC_STEPS (+ the "keep in sync" comment).
- [x] **Phase 3 — rollover:** SyncAllModal checks `/monthly-resync-status`; first sync of a new
      editorial month → scope=full (= SYNC + Re-sync Past), with a "new month detected" banner.
- [x] `tsc` clean · `npm run build` clean · live backend smoke tests pass · 0.3.23 + changelog + CLAUDE.md docs

**Review:** Single source of truth = `sync_manifest.py`; add a `ManifestStep` once → flows
to SYNC / Re-sync / rollover / `/sync-run` (cron) / UIs. Orphan note: legacy `sync_all` endpoint
left in place (unused by frontend) — `/sync-run?scope=full` is the canonical "do everything".

**Tested live (2026-06-08):** Ricardo clicked SYNC → "New month detected" banner appeared →
ran scope=full (19/19 steps, 37,539 rows). Confirmed in DB it FIXED stale May: Leapsome W4
21→30/30, Fivetran W4 16→20/14, `[May 2026]` goals `synced_at` now today. Fixed a React
key collision in `SyncResultDetail` (full scope lists Goals twice → key `${r.sheet}-${i}`).

**Docs:** new `.docs/sync-architecture.md` (manifest + scopes + endpoints + rollover +
add-an-importer runbook); CLAUDE.md "Sheet sync" + cross-link; CHANGELOG 0.3.23.
Git commit/tags still pending.

---

### Overview plain-language pass (0.3.22)

Source: Ricardo (2026-06-08) — make the Overview readable for non-editorial
users. Confirmed via 3 questions: chip = big number + plain sub-line; milestone
numbers in the legend only; spell out shorthand (keep SOW as acronym + tooltip).

**Done:**
- [x] Pod Snapshot headers: "Current Quarter", "% of SOW", "% Published", Goals
      = "Content Briefs + Articles vs monthly goal"; subtitles + tooltips de-jargoned
- [x] Bar labels spelled out (delivered/invoiced; SOW kept) in QTile + ClientQCell + popover
- [x] End-of-Q chip redesign: big signed number + plain sub-line via new
      `varianceSubline()` ("5 fewer than invoiced" / "matches invoiced" / "15 more…");
      applied to `QInfoBlock` (grid) + `QSummaryBars` (drill-down popover)
- [x] Milestones: stripped `N→M` from TTM stat cards, contributor tooltip,
      journey tooltip (focal + legs), and `TimeToTrendChart` dropdown — numbers now
      live ONLY in the Pod Timelines legend. `milestonePairPrefix` kept for legacy D1.
- [x] Section subtitles (Pod Snapshot / Time to Milestones / Production History) rewritten plain
- [x] version 0.3.22 + CHANGELOG; stale milestone-numbering notes fixed in CLAUDE.md + AGENTS.md
- [x] `npx tsc --noEmit` + `npm run build` clean

**Follow-up tweaks (2026-06-08, round 2):**
- [x] Goals subtitle reverted "Content Briefs" → "CBs" (kept full term in tooltip)
- [x] Current Quarter subtitle → "Delivered against Invoiced"
- [x] End-of-Q chip now has a hover tooltip (via `TooltipBody`): short — delivered − invoiced,
      projected to quarter's end, "As of {month}" from the week distribution (`useEditorialAsOf`)
- [x] Dates forced to `en-US` everywhere they were browser-locale (`undefined`): milestone
      tooltip (`fmtTipDate`), drill-down contract dates, comment timestamps, "Synced" badge,
      admin Data Quality timestamps — fixes Spanish "9 ene 2026" → "9 Jan 2026"
- [x] tsc + build clean; changelog folded into 0.3.22

**Open:** in-browser visual QA (chip wrap / tooltip) blocked by Google OAuth —
needs Ricardo to refresh & confirm. Git commit + tags still pending.
Proposed-but-not-done: extend the same chip + labels to Editorial Clients
(`ClientDeliveryCards`) for one vocabulary app-wide (awaiting Ricardo's OK).

---

### Symmetric end-of-Q variance tiers (Overview + Editorial Clients)

Source: stakeholder request (2026-06-05, fwd by Ricardo). Make the variance
color/label rule **symmetric & magnitude-based** — being far AHEAD is as much a
signal as far behind.

**Rule (confirmed):**
- `v = 0` → 🟢 **On track** (green is reserved for exactly 0)
- `1 ≤ |v| ≤ 5` → 🟡 **Within limit** (either direction)
- `v > +5` → 🔴 **Ahead** · `v < −5` → 🔴 **Behind**
- 1st contract Q → 🔵 **1st Q** (excepted — never red)

**Decisions locked:**
- Triage cards (Most Behind / Pod Attention) → rework to a **"Needs Attention"**
  lens flagging `|v| > 5` in EITHER direction (was under-delivery only).
- Green = exactly 0 (per the legend literally).

**Key finding:** the symmetric rule ALREADY exists in `ClientDeliveryCards`'
`varianceColor`/`varianceBg` (monthly Variance column). Everywhere else still
uses the old asymmetric `v ≥ 0 → green`. Consolidate on one shared helper.

**Tasks:**
- [x] `shared-helpers.tsx` — added canonical `varianceTier(v, isNew)` +
      `varianceTierColor()` + `varianceTierBg()` + `isOffTarget()` +
      `VARIANCE_WITHIN_LIMIT` (rounds before classifying so color matches the
      displayed integer)
- [x] Overview: routed `ClientDetailPopover` (removed `tierFor` + monthly
      table colors), `PeriodSnapshotSection` (QTile / ClientQCell / chip),
      `DeliveryOverviewCards` (`signedVariance*`, labels, tooltip) through it
- [x] Editorial Clients: routed `ClientDeliveryCards` (`computeClientTier` now
      returns `VarianceTier`, `QuarterRow`, `EndOfQVarianceChip`,
      `varianceColor/Bg`, tooltips) through it
- [x] Triage rework: "Most Behind" → **Needs Attention**; `MostBehindCard` +
      `PodAttentionCard` + `DeliveryMixCard` select/sort by magnitude (`|v| > 5`
      both directions), copy reframed to "off target", per-row "Ahead"/"Behind"
      via `varianceTier`
- [x] Tier copy updated in `help.ts`; CHANGELOG 0.3.21 entry; `version.ts` +
      root `CLAUDE.md` bumped; stale tier notes in `frontend/AGENTS.md` rewritten
- [x] `npx tsc --noEmit` clean · `npm run build` clean · truth-table trace
      confirms Fivetran (0→green, +2→amber) & Front (+15→red Ahead)

**Review:** Single source of truth now in `varianceTier()`. ~7 copy-pasted
asymmetric tier blocks across 5 components collapsed to one import. NOT done:
git tag `v0.3.21` + push (awaiting confirmation per version-bump rule). Visual
QA in-browser blocked by Google OAuth (stack is up but Playwright has no
session) — verified via build + pure-function truth table instead.

**Follow-up (post-screenshot review):** User reported monthly Variance cells
showing red font on a muddy yellow/brown background. Root cause: the cell's
*translucent* red tint (`${color}1f` / `rgba(…,0.10)`) blended with the green
current-Q row highlight (`bg-[#42CA80]/8`) behind it → brown. Fix: `varianceTierBg`
now returns an OPAQUE color composited over the dark base (`compositeHex`), so
the cell is a clean swatch regardless of row highlight. Applied to all 4 table
cells (Overview popover per-period + total; Editorial Clients popover per-period
+ grand-total via `varianceBg` delegation). A background Explore sweep audited
all 12 variance-coloring sites: 100% canonical, no old inline rules, no other
mismatches (`ContractClientProgress` Δ is "articles in flight", a different
metric — correctly out of scope). tsc + build clean.

---

### Overview redesign — Part 1 (Period Snapshot section)

### Overview redesign — Part 1 (Period Snapshot section)

Source: Director of Business Operations feedback (2026-05-21). Build top-of-page
"how's the period going, per pod, at a glance" view, period-scoped, with inline
pod expand. Keep existing 5 sections below for side-by-side comparison; hide
`time-to-metrics` from the SectionIndex.

**Decisions locked:**
- Period control: Section-local toggle (1m / 3m / 6m / Custom). Custom reads
  FilterBar's date range. Defaults to last completed editorial month.
- Pod metric: Hybrid — period goals-vs-delivery (CBs + Articles vs goal across
  selected months) + projected end-of-Q variance chip.
- Detail UX: Inline expand below pod row; one pod open per card.
- Coexistence: Add new section at top; drop `time-to-metrics` from the rail.

**Tasks:**
- [ ] Scaffold new section + wire shell into `overview/page.tsx`
- [ ] Period toggle + reference badge
- [ ] Pod Delivery Progress card (left) — fetch goals data + per-pod aggregate
- [ ] Pod Time-to-Metrics card (right) — per-pod averages + per-client expand
- [ ] Type-check + browser verify

---

> **Earlier reviewed:** 2026-04-28
> **Related docs:**
> - [`/CAPACITY_PLANNING_V2.md`](../CAPACITY_PLANNING_V2.md) — CP v2 schema + phase status
> - [`/.docs/dashboard-data-flow.md`](../.docs/dashboard-data-flow.md) — migration plan
> - [`/.docs/prd-compliance-audit.md`](../.docs/prd-compliance-audit.md) — PRD coverage
> - [`/CLAUDE.md`](../CLAUDE.md) — project overview

---

## ✅ Completed

### Foundation
- [x] Phase 0: Scaffolding (Next.js + FastAPI + PostgreSQL + Docker Compose)
- [x] Phase 1: Seed DB from CSVs (77 clients, 394 deliverables, 12 team, 65 capacity, 528 KPIs)
- [x] Phase 1: Data Management CRUD UI (Clients, Deliverables, Capacity, KPI Entry)
- [x] Phase 2: Dashboard 1 — Editorial Clients (Contract & Timeline + Deliverables vs SOW)
- [x] Phase 3: Dashboard 2 — Team KPIs (KPI Performance + Capacity Projections + AI Compliance)
- [x] Phase 4: BigQuery sync service + Home page + Admin endpoints
- [x] UI/UX: Graphite DS, logo, dark theme, sidebar/header
- [x] Chart library: donut, area, bar, heatmap, sparklines, pacing badges
- [x] Google Sheets Import Wizard — 5-step flow over Sheets API
- [x] Operating Model, Delivery Schedules, Engagement Requirements, Meta Deliveries sheets integrated
- [x] Handoff documentation
- [x] CLAUDE.md + PRD compliance audit

### Auth (Apr 9)
- [x] Google OAuth shipped (`e1ae4bf`) — domain-restricted to `@graphitehq.com`, JWT cookie via `AUTH_SECRET`. **Role-based access still deferred.**

### Dashboard refinements (Apr 14–18)
- [x] Contract & Timeline table: 17 → 9 columns + source sheet link (`dc278ae`, `6667d67`, `3a9aa13`)
- [x] Client Delivery Detail table removed — duplicated by cards above (`4e3e14a`)
- [x] Deliverables vs SOW: per-client cards above the detail section (`51413cb`, `e2dbb16`)
- [x] Pod-grouped layout with pod aggregate sitting directly above per-client cards (`8f42a75`, `58ead94`, `e631c0d`)
- [x] Pod Matrix moved from Contract to Deliverables tab; pod labels normalized end-to-end (`50e3028`, `91e4235`, `969c998`)
- [x] DeliveryTrendChart refactored to heatmap; formula flipped to Delivered ÷ Invoiced with Month/Quarter toggle (`34867f4`, `3a07fa2`)
- [x] Pipeline by Pod redesigned as compact approval-rate grid (`df158a0`)
- [x] Cumulative Pipeline + Weekly Breakdown Matrix surface every CB / AD column (`6796be3`)
- [x] Client Engagement Timeline: % Delivered view + totals sidebar (`9dc6996`)
- [x] Time-to Metrics: MoM trend + 8-option metric selector + outlier y-cap (`f57960c`, `9090b1f`, `044b4dc`)
- [x] FilterBar: month-range slider default current ±6, month-granular only (`beb3b76`, `9e5587d`)
- [x] Tooltip explicit dark surfaces, Diff tooltip rewritten (`7aa4771`, `708575d`, `14ce0bc`)
- [x] New backend endpoint `GET /api/dashboard/client-production` (`bb5af44`)

### Capacity Planning v2 prototype (Apr 9–18) — all frontend/`localStorage`
- [x] Phase 1 — Unified month context (`ac9834c`)
- [x] Phase 2 — Copy-forward + validation + close-month (`e103c0c`)
- [x] Phase 3 — Leave + Overrides editors (`32bca76`)
- [x] Phase 4 — Weekly actuals grid (`edd52d7`)
- [x] Phase 5 — Admin CRUD for 5 dim tables (`e076ad6`)
- [x] Phase 6 + 7 — Migration validator, diff view, global search, quarter rollup (`23d1020`)
- [x] Phase 8 — All dashboard-feeding tables editable in Maintain (`c675fbd`)
- [x] Schema page: fullscreen toggle + click-to-highlight table + its joins (`5f5bb42`)
- [x] Left-rail nav, sticky chrome (`54153af`, `83dcc69`, `1fd7b75`, `bb1c5e1`)

### Infra
- [x] Notion import: paginate + bulk upsert (`612c854`)
- [x] Railway Dockerfile COPY paths fixed (`6ce65ff`, `99fb796`)

### Dashboard 1 UX overhaul (Apr 19–26)
- [x] Scope-aware overview cards on all three Tab 2 sections — `DeliveryOverviewCards`, `CumulativePipelineCards`, `GoalsOverviewCards` (single client / pod / portfolio modes)
- [x] Removed legacy `PipelineFunnelChart` (its job is done by per-pod cards inside `CumulativePipelineCards`)
- [x] Per-client + per-pod pacing chips (Behind / On-Pace / Ahead) — SOW-weighted
- [x] Pacing-aware lifetime % colors via shared `pacingColor()` (no more "new client looks bad" bias)
- [x] Pipeline stage palette retuned to strictly Graphite DS swatches: P3 → P2 → P1 + WN1 (Topics → CBs → Articles → Published)
- [x] Sticky h2 section headers (`top-[160px]`) + `SectionIndex` left-side anchor nav with scroll-spy + click-to-jump (xl+)
- [x] Per-client gauges in pod subsections — always-visible grid (no dropdown), reuses `ClientMiniGauge`
- [x] Content-type weighting (article ×1, jumbo ×2, LP ×0.5) applied via 3-step aggregation (max-of-week per CMC → weighted client/month → pod totals) — changes published totals vs. before
- [x] "As of" labels derived from latest data row (Operating Model / scopedRows), not calendar-now
- [x] `FilterBar`: zero-match fallback to "All Time" when filters yield no clients
- [x] `TimeToMetrics` tooltip now shows From/To dates alongside Δ days
- [x] AI Compliance tab on D2: 3 `SectionIndex` subsections (AI Flagged / Rewrites / Surfer API)
- [x] `GoalsMonthTable`: sticky h3 column headers, sticky client cells, per-client expand to per-content-type sub-rows
- [x] Auto-fit date range on filter changes (`FilterBar`)
- [x] Data-quality warning banner on Monthly Goals — flags pre-Aug/Sep 2025 sparseness
- [x] Tooltip standardization — every metric tooltip now uses `TooltipBody` (uppercase mono title + 2–3 bullets) with tight triggers
- [x] `framer-motion` (12.38.0) added for layout animations on scope-aware swaps
- [x] AI Compliance tab on D2 wired to the same `SectionIndex` + sticky h3 pattern

### Header / sidebar / admin overhaul (Apr 27)
- [x] Funnel Health card dropped from portfolio Cumulative Pipeline (redundant with Bottleneck Stage); 4-card / 5-card grid auto-tracks card count
- [x] Tooltip text on the 4 portfolio cards rewritten in plain English (no `pp` / `trails` / `÷` jargon in user copy)
- [x] Header bar hidden on D1 + D2; `SyncControls` extracted (`src/components/layout/SyncControls.tsx`) and rendered inline with title + filters in a single row
- [x] Last-sync badge ("Synced Apr 23, 4:18 PM") next to SYNC button — reads `GET /api/migrate/status`, anchored to UTC, rendered via `toLocaleString()` for browser-locale + timezone
- [x] Page-load clock removed from D1 + D2 (the badge is the only freshness signal now)
- [x] Sticky offsets recalibrated for the no-header case (`top-[120px]`, `scroll-mt-[140px]`, `SectionIndex topOffset = 140`); filter band `min-h-[120px]` so it butts up against the h2 with no transparent gap
- [x] Sidebar simplified — `Clients / Deliverables / Capacity / KPI Scores` hidden from nav; `Capacity Planning v2` renamed to **Capacity Maintenance** and moved under Data; `Proposal` group removed; new **Admin** section
- [x] **`/admin/access`** UI mockup — 12 mock users × 8 sections matrix, 5 PRD §7-aligned groups, 6 mock audit entries. Zero auth wiring (real RBAC is a separate ticket)
- [x] Fixed `key="none"` collisions on three sibling dialogs in `/capacity-planning` (and the lone one in `/allocation` for consistency)
- [x] CP v2 alignment audit applied to `CAPACITY_PLANNING_V2.md`: pointer to `_erd.ts` as authoritative; "Dashboard-1 alignment audit (2026-04-27)" section with gap closures + 3 nice-to-have SQL view candidates
- [x] Prototype `_store.tsx` `DeliveryMonthlyRow` synced with `_erd.ts` (`variance`, `cumulativeDelivered`, `cumulativeInvoiced`)

### Team KPIs sync + filter parity (Apr 28)
- [x] **Bug fix**: 4 computed KPIs (Revision Rate, Turnaround Time, Second Reviews, Capacity Utilization) now refresh on every SYNC. New `POST /api/migrate/refresh-kpis` endpoint computes for every month with source data (cap 36 months); `SyncAllModal` calls it as a synthetic step after the per-sheet loop
- [x] `GET /api/kpis/` accepts `year_from / month_from / year_to / month_to`; `limit` cap raised to 10,000
- [x] `TeamKpiFilterBar` rebuilt — `FilterCombobox` typeahead replaces duplicate Search-members + Member-dropdown; same combobox style on the Client filter
- [x] Date period switched from Month + Year dropdowns to D1's `DateRangeFilter` (calendar + month-range slider + presets)
- [x] Heatmap now aggregates across the date range — mean of non-null scores + latest non-null target per `(member × kpi_type)`
- [x] Per-column tooltips on the heatmap surface source / formula / target / direction / **caveats** (paused upstream for AI Compliance, fallback heuristic for Second Reviews, pod-level replication for Capacity Utilization, status-name dependency for Revision Rate)

---

## 🚧 Pending — P1

### CP v2 — backend + cutover (this is the big one)

Ship the UI's promise. Everything below is a no-UI-change swap: `localStorage`
→ DB. See `.docs/dashboard-data-flow.md` for the sequence.

**Phase A — Schema foundation**
- [ ] Alembic migration: all `cp2_dim_*` + `cp2_dim_month` + `cp2_dim_week`. Seed `cp2_dim_month` (2022-01 → 2028-12) and `cp2_dim_week`.
- [ ] Alembic migration: all `cp2_fact_*` tables
- [ ] Alembic migration: SQL views `cp2_v_member_effective_capacity`, `cp2_v_pod_monthly`, `cp2_v_pod_monthly_actuals`
- [ ] `backend/scripts/cp2_backfill.py` — one function per legacy → cp2 mapping, idempotent

**Phase B — Editable tables move first** (already app-managed, no UX regressions)
- [ ] Backfill `cp2_dim_{client,team_member,pod,engagement_tier}` from existing tables
- [ ] Backfill `cp2_fact_delivery_monthly` from `deliverables_monthly` + `production_history` (union on `client_id × month`)
- [ ] Backfill `cp2_fact_{pod_membership,client_allocation}` from `team_members.pod` + `clients.editorial_pod`
- [ ] Backfill `cp2_fact_kpi_score` from `kpi_scores` (1:1 + nullable `client_id`)
- [ ] New routers `/api/cp2/{dims,facts,views}/*`
- [ ] Rewire `_store.tsx` from `localStorage` to `apiGet` / `apiPost`

**Phase C — Dashboard cutover** (A/B against legacy endpoints for one sprint)
- [ ] `/api/dashboard/client-production` → read from `cp2_fact_production_history` + `cp2_fact_delivery_monthly`
- [ ] `/api/deliverables/` → `cp2_fact_delivery_monthly`
- [ ] `/api/capacity/` → `cp2_v_pod_monthly`
- [ ] `/api/kpis/` → `cp2_fact_kpi_score`
- [ ] Diff responses in prod for 1 sprint; flip the reader

**Phase D — Move the read-only sources**
- [ ] Build Maintain UI for `cp2_fact_pipeline_snapshot` (monthly pipeline). Backfill from `cumulative_metrics`
- [ ] Build Maintain UI for `cp2_fact_actuals_weekly`. Backfill from `goals_vs_delivery`
- [ ] Retire Master Tracker ingestion

**Phase E — Long tail**
- [ ] `cp2_fact_article` backfill from `notion_articles` (writer/editor string → FK)
- [ ] `cp2_fact_{ai_scan,surfer_api_usage}` — rename + add FKs
- [ ] Drop legacy tables from `models.py` + `seed_data.py`

**Decisions blocking Phase A** (see `.docs/dashboard-data-flow.md` §6)
- [ ] Confirm month/week key format (`YYYY-MM` / `YYYY-Www`)
- [ ] Keep `production_history` separate or merge into `delivery_monthly.is_actual`?
- [ ] Notion string → FK: fuzzy matcher, or store `raw_writer_name` + null FK?
- [ ] External sheet edits after cutover: hard-stop or audit-only ingest for 1 quarter?

### Small P1 items (unrelated to CP v2)
- [ ] Quarter picker on D2 (PRD §5 D2 Filters) — ~2h
- [ ] Auto-detect latest CP version (PRD §5 D2 Data Sources) — ~3h
- [ ] Revision Rate accuracy — needs daily snapshot infra
- [ ] Article browser (PRD §11 nice-to-have) — ~4h; data already in DB
- [ ] Deploy to Railway with the Notion pagination fix and verify rows_imported > 20,000

---

## ⏳ Pending — P2 (external deps)

- [ ] External feedback form for External Quality scoring
- [ ] SE mentorship form (Mentorship KPI)
- [ ] Auth: role-based permissions (Editor sees own / SE sees pod+clients / CP+Leadership sees all)
- [ ] Audit logs for dashboard access/usage
- [ ] Notifications for broken links or metric changes

---

## 🧊 Deferred / icebox

- Editable `team_members` CRUD (currently hardcoded in `seed_data.py`)
- `engagement_rules`, `delivery_templates`, `model_assumptions` CRUD (rarely change)
- Daily article-status snapshots (for accurate Revision Rate)

---

## How to work with this file

Mark items `[x]` the moment they land in `main`. When a task spans multiple
commits, list them inline (e.g. `(e103c0c, 32bca76)`). Re-review every other
Friday; archive completed sections older than a month into a `tasks/archive/`
folder when they crowd the top.
