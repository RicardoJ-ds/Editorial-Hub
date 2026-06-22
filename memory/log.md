# Log — Editorial Hub

Append-only journal. **Newest entries on top. Never edit a past entry — append a follow-up.**
Format: `## [YYYY-MM-DD] <action> | <title>` where action ∈
`ingest · decision · correction · lint · note`.

> History below 2026-06-21 was carried over from the prior global memory folder
> (`~/.claude/projects/.../memory/log.md`) when the memory system moved in-repo.

---

## [2026-06-22] note | MAC standardizer APPLIED to the COPY sheet (strict revision validation now live)
Follow-up to the strict-revision change below. Ran `python -m etl.sheet_standardize --apply` against the COPY (`ARTICLE_COUNT_ID=1X_M82Vz…`) with **prod env/data** via `railway run` (prod Neon read-only for fills + prod GOOGLE_SERVICE_ACCOUNT_KEY). Result over **99 client tabs**: structure 0 (STANDARD cols already existed → re-fill only), rosters tab written (56), fills 256 column-ranges (13,644 editor + 13,632 writer std cells, 2,439 1st-rev + 206 2nd-rev dates), **validation+format 576 rules applied** (incl. the strict DATE_IS_VALID on 1st/2nd REVISION), audit tab written. 1,471 slash collab cells flag red (pending DaniQ); 60 residual unparseable legacy dates. Also FIXED a portability bug to run it: `etl/sheet_standardize.py` hardcoded `/app/etl/mappings/*.json` (container-only) → now `__file__`-relative via `_MAPPINGS_DIR` (+ `import os`), so it runs locally / via `railway run`, not just in docker. Verify in-sheet: typing text into a 1ST/2ND REVISION (STANDARD) cell is now rejected. Code change (strict + path fix) still uncommitted.

## [2026-06-22] note | MAC standardizer: 1st/2nd REVISION (STANDARD) date validation made STRICT (reject text)
Ricardo asked whether the revision STANDARD columns could hard-reject non-dates. They already had `DATE_IS_VALID` validation but `strict: False` (warn-only — deliberately, as a derived split off the untouched REVISED cell). Flipped to `strict: True` in `etl/sheet_standardize.py` (line ~617) so they gate exactly like SUBMITTED — only a real date or blank; free text / partial dates / comma-lists refused on entry. Original REVISED column stays free-form (3rd+ revisions, raw lists). ruff clean. **NOT applied to the sheet yet** — `sheet_standardize.py` is a manual run (`python -m etl.sheet_standardize --apply` against the COPY `ARTICLE_COUNT_ID=1X_M82Vz…`); needs a re-run to push the tightened validation. Caveats: reject blocks TYPED entry only (paste can bypass + flags red), doesn't retro-clean existing cells, blanks allowed, any real date format accepted on input then shown ISO. See [[analysis-normalization-proposal]].

## [2026-06-22] decision | AI Monitoring importers removed from auto-SYNC (current scope) → Import-Wizard-only
DaniQ/Ricardo: the 4 `AI Monitoring - {Data,Rewrites,Flags,Surfer Usage}` steps kept throwing "Failed to fetch" on the daily cron + SYNC button (Writer AI Monitoring scans are **paused upstream**, so the data isn't changing anyway). Removed them from `CURRENT_STEPS` in `backend/app/services/sync_manifest.py` (current=13 steps now, was 17) → they no longer run on the SYNC button, the 09:00 UTC cron, or the month-rollover `full`. They REMAIN importable on demand from the Import Wizard, because the wizard sources its sheet list from `GET /api/migrate/sheets` (`list_available_sheets` + `IMPORT_DISPATCH`), **independent of the manifest** — so no wizard change was needed for visibility; I additionally added the 4 to the wizard's `DEFAULT_UNCHECKED` so they're off-by-default (true manual selection). Verified: `steps_for_scope('current')` has no AI Monitoring + count 13; ruff/mypy clean; frontend tsc clean; no tests asserted their presence. Docs synced (CLAUDE.md Spreadsheet 3, [[reference-data-sources]] §3, [[reference-sync-architecture]] new §5). NOT yet committed/deployed — push auto-deploys Railway+Vercel; awaiting Ricardo's OK + a PATCH version bump.

## [2026-06-22] note | Consolidated data/ + .docs/ + root CP-v2 reports into memory/ (new 50-sources tier)
Merged the two top-level doc folders + 2 root reports into the wiki, so memory/ is the single knowledge store. New `50-sources/` tier (raw founding inputs): `specs/` ← data/ PRDs + build prompt + root `CAPACITY_PLANNING_V2.md` + `CP2_COVERAGE_AUDIT.md`; `seed-data/` ← data/ initial CSV exports + all_sheets_combined; `design-system/` ← `.docs/Graphite-Interal-DS.html`. The 3 LIVE detailed docs (`sheet-inventory`, `dashboard-data-flow`, `sync-architecture`) → `10-reference/`. Point-in-time reports (`access-control-handoff`, `prd-compliance-audit`, `neon-company-migration`) → `90-archive/`. `data/` + `.docs/` deleted. **Git posture preserved per-file**: sensitive client/revenue CSVs + PRD binaries + the archived reports stay gitignored (new `.gitignore` rules under memory/); the CP-v2 `.md` specs + DS html + detailed docs are tracked. **Rewrote ~14 references** (CLAUDE.md ×6, frontend README + docs ×4, the 2 moved CP-v2 docs, 6 memory files) — grep confirms zero `.docs/` left. Repointed `fetch_docs.py` `OUTPUT_DIR` → `memory/50-sources/specs/` (it regenerates the PRDs; was writing to the now-deleted `data/`). `backend/data/` (seed_data.py source) is a different folder — untouched. tracked `git mv` preserved history for the 5 tracked files. Indexes (MEMORY/index) + 50-sources README added.

## [2026-06-21] ingest | Full knowledge-capture pass — calculations/metrics/architecture distilled into the wiki (per-domain, dated)
`/goal`: read all project work (decisions, calculations, metrics, origins, results) and store it organized + dated. Method: 9 parallel deep-read agents (one per domain, reading the actual code+docs not memory), then synthesized into **16 new memory files**. New `40-metrics/` folder (chosen over mixing into 10-reference) = the canonical calculation home, one file per domain: goals/content-weighting, end-of-Q variance+tiers, capacity utilization, monthly articles, overview/TTM, warehouse-int-layer (+ the B1–B12 bug register + parity proofs). New 10-reference: warehouse-layered-model, sync-architecture, data-sources, data-quality-selfheal, cp-v2, neon-company-migration. New 30-analyses: normalization-proposal (the DaniQ standardization + name dictionaries + OM↔MAC reconciliation — a top iteration target). New 20-decisions: 2026-05-27 content-type-weighting (two-stage; LP doubling) + 2026-06-11 dual-sink-warehouse. Every file carries formulas + `file:line` + dated decision tables + open threads, cross-linked with `[[wikilinks]]`. **Doc-drift flags surfaced for follow-up:** (1) **B1** — glossary ×0.5 is documented (BUSINESS_RULES, Jun 2026) but has **no branch in `contentTypeRatio()`** → defaults to ×1; importer + ratio unshipped. (2) `backend/app/services/notion_import.py` **does not exist** — 3 docs cite it; real entry = `migration_service.import_notion_database` reading a Sheet, not the Notion API. (3) `ARTICLE_COUNT_ID` default differs between `config.py` (`1X_M82Vz…`) and CLAUDE.md (`1eRmZFn…`). (4) `views.py:156` / WAREHOUSE_DESIGN B5 comment ("stats card filters days>=0") is stale post-0.3.27. Indexes (MEMORY/index) updated. In-repo memory only (curated-docs layer per the dual-memory decision); no global mirror.

## [2026-06-21] note | Memory system moved in-repo (bi-forge bootstrap)
Ran `/bootstrap-project ~/python/bi-forge` against editorial-hub. Installed the bi-forge
in-repo memory scaffold under `memory/` and **migrated** the durable knowledge from the
global folder into the numbered structure: 2 decisions (`20-decisions/`), 2 analyses
(`30-analyses/`), 16 reference/project files (`10-reference/`), 3 strategy/plan files
(`00-strategy/`, incl. the old `now.md` preserved as `open_workstream_capacity_utilization.md`).
Feedback files (`feedback_*`) were intentionally **left in the global memory** (cross-project
working prefs, not project knowledge). Also: replaced the older split skills
(`pre-commit-checks` + `release`) with bi-forge's unified `release` (adapted to the Hub's
stack + 4 version surfaces + tag-push confirmation), and seeded `backend/CLAUDE.md`. The
`/memory` skill is already globally symlinked, so it was not copied in.

## [2026-06-19] decision | Prod dashboards cut over to BigQuery + cache (DASHBOARD_SOURCE=bq) to slash Neon egress
Plan-mode → 3 Explore + 2 Plan agents. Key finding: the BQ write path + 53/53 endpoint parity already existed (dual-sink warehouse), so this was a READ-flip + caching job, not a data migration. Built `backend/app/services/bq_cache.py`: every BQ q() result cached in-process keyed by (sql, params, publish_token); token in a new one-row `cache_version` table, bumped by `@warehouse-publish` (sync_manifest) so a SYNC shows fresh within 5s across instances; TTL 600 fallback; serve-stale on BQ error. RBAC `resolve_access` cached 30s (deep-copies for preview-safety) — the dominant Neon read after the flip. Config flags bq_cache_enabled/bq_cache_ttl_seconds/cache_token_poll_seconds/rbac_cache_ttl_seconds. Decided AGAINST moving source writes to BQ (importers read ~11 Neon tables back for self-heal; ~0 egress gain). Committed c7cb29d. Cutover = Railway env only: parity-mode redeploy (override on, cache off) → published prod → `python -m etl.warehouse.endpoint_parity` = 52/52 IDENTICAL → flipped DASHBOARD_SOURCE=bq + override off + cache on. Verified: clients/Dr Squatch/n8n-preview correct on BQ, token bumped 0→1, cache warming. Rollback = DASHBOARD_SOURCE=postgres (reads live `public`). Residual: BQ outage + cold cache = errors (no postgres-fallthrough wired). Detail: [[bq-serving-cutover]]. Open: measure Neon egress 7-day; Phase 2 = stop Neon warehouse sink.

## [2026-06-18] note | Dr Squatch goals fixed on prod (sheet rename "Dr. Squatch"→"Dr Squatch") + RBAC scope made case-insensitive (n8n)
Two source-name-mismatch bugs DaniQ flagged. (1) **n8n** missing for Growth Pod 3 in Preview Mode: pod_assignments.client_name='N8N' (uppercase, from the Team Pods Growth sheet) but clients.name='n8n' → RBAC scope did a case-SENSITIVE `Client.name.in_(allowed)`. Fix = lowercase both sides at the single producer (_scope_filter, clients.py) + the column on both serving paths (Postgres func.lower(Client.name); BigQuery LOWER(name) in bq_dashboard.list_clients). Verified no case-collisions. Committed 5565230, pushed main (Railway deploy). Workflow: 3-discover + 2-adversarial-verify, both APPROVE.
(2) **Dr Squatch** had no goals: Master Tracker had "Dr. Squatch" (dot), Hub client is "Dr Squatch" (no dot) → goals_vs_delivery rows keyed with the dot, matched=0 against the client. Diego removed the dot in the sheet. Re-synced goals on PROD (sync-step goals-vs-delivery, 2313 rows) → "Dr Squatch" now matches client (prod id 2). BUT the importer is upsert-only → 18 orphan "Dr. Squatch" rows lingered (would double-count into Unassigned/portfolio). DELETEd them on prod via `railway run` + app async engine, then @warehouse-publish. Verified warehouse views show only "Dr Squatch", no phantom. Live now — DaniQ needs no Sync. New memory: [[goals-rename-orphan]]. Prod client IDs differ from local (Squatch 540 local / 2 prod).
Still open: confirm n8n Railway deploy green; inactive-clients "last ended Q" behavior (cointracker etc.) — separate.

## [2026-06-16] correction | Negative milestone day-deltas now shown on ALL time-to surfaces (Bug B5 closed)
DaniQ flagged: filtered Pod 7 → clicked Serval → 'Consulting KO → First CB Approved' TTM card showed '—' but the Per-Client Days bar showed '-2'. Root cause = an ASYMMETRIC filter. Warehouse view v_editorial_fct_milestone_transitions already documented this as 'Bug B5: stats-card filters days >= 0 at read time; timelines include them.'
A negative day-delta is a REAL data anomaly: a milestone logged BEFORE its predecessor (e.g. a CB approved 2 days before the Consulting KO date). DECISION: SHOW negatives consistently on every milestone surface — do NOT silently drop/hide them (hiding made the card read '—' / day-0). Surfacing the negative makes the anomaly visible for DaniQ to investigate.
Ran a 4-finder + adversarial-verify workflow over frontend+backend+ETL (33 candidates, 19 surfaces inventoried). Result: the VALUE-level drop existed in exactly ONE place — PeriodSnapshotSection.tsx PodTTMStatsCard ~L2058 'if (d!==null && d>=0)' → changed to 'if (d!==null)'. Every other value path (FE stat cards, bars, journeys; BE time_to_metric + /api/dashboard/*; PG+BQ warehouse views) already only null-filters. Backend /api/dashboard/clients/time-to-metrics + avg_time_to_first_article_days have NO frontend consumer (legacy). Dead helper editorial-clients/page.tsx ~L1266 daysBetween returns 'days>=0?days:null' but has no call site (latent trap if reused).
RENDER-level residual (user picked the minimal fix): the Pod Timelines journey (Overview PeriodSnapshotSection + Editorial Clients TimeToMetrics waterfall) pins a negative dot to the day-0 baseline via pct()=Math.min(Math.max((d/scale)*100,0.5),95) and dropped the reversed segment (w<=0.3). Did NOT touch the axis scale; instead: negative dots get a red ring + always-on red signed '-Nd' label, and the reversed leg renders as an 8px dashed-red marker instead of being dropped. Applied to BOTH journey surfaces so they match. tsc clean. Files: frontend/src/components/dashboard/PeriodSnapshotSection.tsx + TimeToMetrics.tsx. NOT YET COMMITTED (awaiting OK; push auto-deploys Vercel + Dani is about to share with directors).

## [2026-06-15] correction | Capacity-tab spec fixed: full-year demand DOES exist in BQ; architecture = BQ baseline + Hub Neon edits
Ricardo corrected my wrong claim. VERIFIED: editorial_raw_production.articles_projected has per-client demand through Dec 2026 (Jun 405→Dec 216, 79 clients) — full year. member_months.capacity + capacity_pod_months (supply+pod-projected) also through Dec. The ONLY thing stopping at June is the PRE-ROLLED editorial_int_client_pod_months (its pod attribution uses the month-by-month client_pod_history join which ends June). So future per-pod demand = roll up editorial_raw_production × editorial_raw_clients.editorial_pod × 1.4(specialized) yourself. Two fields use latest-known for future (client→pod from editorial_raw_clients; category from client_pod_months.category — clients table has NO category col) — both are DaniQ's editable fields anyway. ARCHITECTURE (Ricardo reminder): Planning Hub has own Neon = editable layer (capacity adj from hires/leaves/permissions + future per-client projection re-distribution + pod moves); BQ = read-only baseline; daily reconcile. Updated docs/capacity-tab-spec.md (§0b architecture, §0c editable inputs, §2 corrected, §4b). No editorial-hub warehouse change needed; offered remaining_sow_by_client view on request. 1.4=SPEC_WEIGHT constant (demand multiplier), not in model_assumptions.

## [2026-06-15] decision | Capacity-tab spec for Planning Hub + session-split strategy
Other session is building an INTERACTIVE capacity tab (drag-drop moves, hires/leaves, full-year projections, SOW coverage) for DaniQ to maintain the capacity model. Diagnosed why its future months show 0%: SUPPLY (capacity) exists through Dec (member_months.capacity, capacity_pod_months.total_capacity) but per-member projected_used + per-client demand (client_pod_months) STOP at June; only the POD-LEVEL ET CP projection (capacity_pod_months.projected_used_capacity) runs through Dec. So future = show PROJECTED util (actual is legit 0). The ×1.4 is a DEMAND multiplier (specialized clients) = constant SPEC_WEIGHT in capacity_calc, NOT in model_assumptions (which only has 70/30 mix). Wrote /Users/ricardo/python/editorial-team-pods/docs/capacity-tab-spec.md (formula, BQ contract+coverage, ramp-up from model_assumptions, move/hire/leave math, SOW/End-of-Q, validation targets). SESSION STRATEGY recommended: editorial-hub = capacity brain (formula/data/specs), editorial-team-pods = Hub builder (UI); do NOT edit the Hub repo from here (collision); handoff via docs/. Open ask if needed: remaining_sow_by_client view + per-client future demand past June.

## [2026-06-15] ingest | Model Assumptions wired to re-sync + BigQuery for editorial-planning-hub
Ricardo: import the Model Assumptions tab (capacity model spreadsheet) for the OTHER project. import_model_assumptions already existed (Import Wizard only). Added a sync_manifest PAST-scope step "model-assumptions" (Re-sync Past Months / full, NOT normal SYNC — changes a few times/year) + editorial_raw_model_assumptions in warehouse RAW_TABLES → dual-sink to BigQuery graphite_bi_sandbox (14 rows). Other project reads graphite-data.graphite_bi_sandbox.editorial_raw_model_assumptions: client categorization (standard 70/specialized 30), ramp-up % (SE M1 80/M2 100, Editor M1 0-33/M2 80/M3 100), weekly/monthly capacity (SE 3-5/20, Editor 12-15/60; +5-week bumps), ideal-capacity flags (80-85 green/85-100 yellow/<80 & >100 red), new-clients-per-pod (min1/max2). Minor gap: ramp-up ARTICLES sub-rows (16/20/20, 0-28/44-48/60) not captured, only percentages — derivable. 28 warehouse tables now.

## [2026-06-15] note | Drive reports folder cleaned for DaniQ
Reorganized the shared Drive reports folder (14kw-6YvKz…): created _archive 2026-06-15/ and moved the 8 stale/internal files there (by_month ×3 incl. DaniQ's green-marked writers record, caret_rows, pod_member_drift, unmapped_client_tabs, REPORT_FACTS, duplicate month_basis). Clean top now = 4 refreshed files: mappings_editors (42), mappings_writers (240, full names+audition), mappings_clients, OM vs logged by client. GOTCHA: the SA has NO Drive storage quota → cannot CREATE files in Ricardo's My Drive (storageQuotaExceeded). Workaround used: reuse existing Ricardo-owned files and edit their CONTENT via Sheets API (allowed). So the SUMMARY_for_DaniQ doc can't be uploaded by the SA — Ricardo must drag it in himself (etl/reports/SUMMARY_for_DaniQ.md).

## [2026-06-15] decision | Genstore + ShareGate client reconciliation; SE+Editor collab rule; collab analysis
DaniQ confirmed Genstore=GenstoreAI and ShareGate=Workleap+Sharegate → applied tab→client ArticleNameAliases (kind=client, source=daniq); both now tie out (GenstoreAI 35=35, Workleap+Sharegate 108≈105). Only Meta AI/BMG/RL remain unlogged (no tab, ~118 articles) — the lone real gap. Also wired SE+Editor collaboration rule into import_monthly_article_count (a 2-person editor cell that is one SE+one Editor credits only the Editor; ET CP roles per month + first-name fallback; 230 cells resolved). Analysis proved collab handling is CAPACITY-IMMATERIAL: pod totals follow OM (denominator=sum of credits so Σused=OM always); worst-case per-member swing from any collab choice ≈2-3 pts in one month (Pod 1 Jan-2025, 4 collabs/78). So two-editor collabs left as-is (credit both) — no DaniQ decision needed. Capacity May 2026 unchanged: P1 83 P2 88 P3 77 P5 99. Reports/summary/OM-tab refreshed. Commits d970c2d + follow-ups. DaniQ summary now asks ONLY about Meta. daniq_writer_confirmations.json drives WRITER (STANDARD) in copy.

## [2026-06-15] decision | DaniQ editor/writer validation applied + capacity reconciliation report
EDITORS: 29/29 confirmed against Rippling v_headcount (source of truth) — DaniQ left them unmarked by design (Sam=tenure dates, Lauren=Keleher lastname). WRITERS (no BQ source → DaniQ green = authority): 72 confirmed = 20 first-name→full-name upgrades (Mike=Michael Ray vs Michael=Michael Davis split; Aby→Abby Norwood; Justine→Justine Jade Smith; Daniele→Danielle MacKinlay vs Dan→Daniel Pelberg) + audition bucket + Dan month-split (audition≤2025-05 / Daniel Pelberg≥2025-06). Applied: 20 real-name upgrades → article_name_aliases(kind=writer,source=daniq, Dan windowed); daniq_writer_confirmations.json (72, incl audition) drives WRITER (STANDARD) in the proposal copy 1X_M82Vz. OM↔MAC reconciliation 2026: editorial-month basis tracks OM within 3-9% (was 60% gap pre-fixes); Jan-May OM 1595 vs MAC 1471 = 92.2% (real ~98% after Genstore=GenstoreAI + ShareGate=Workleap name-splits net out; only true gap = Meta family ~118 no-tab). Capacity util May 2026 pods: P1 83 P2 88 P3 77 P5 99; actual_used ALWAYS article-distribution fallback (by design, scaled to OM); only unmatched member = placeholder 'support from Pod 1'. Report: etl/reports/MAPPING_VALIDATION_REPORT.md. Added 🔍 OM RECONCILIATION tab to the copy (missing-article check vs OM). Open: Genstore/ShareGate alias confirm, Meta tabs, the 1,471 '/' editor collab cells (only remaining mapping gap). Commit d970c2d.

## [2026-06-12] note | Autonomous cron OBSERVED firing in prod — loop fully proven
Temporarily set SYNC_CRON_UTC_HOUR=21 to avoid waiting overnight: backend woke itself at 21:00 UTC, ran the full plan (10 audit-logged steps), dual-sink publish landed 21:12:06 — zero human action. Hour reverted to 9 (redeploy SUCCESS, env confirmed). The sheets+Hub→Neon→warehouse→BigQuery loop is now verified end to end in production, both manually triggered and self-scheduled.

## [2026-06-12] decision | DEPLOYED TO PROD — migration live end-to-end
Pushed 539d264 (Ricardo: "continue"). Railway deploy SUCCESS 120s; env verified in prod (new sheet IDs, cron ON, override OFF). One-time scope=full prod sync: Railway proxy 502s at 300s but the thread completes server-side — LESSON: manual full resyncs in prod via the UI Re-sync button (per-step), not one-shot /sync-run; daily cron unaffected (in-process). Publish landed 20:24 UTC. Verified in prod: capacity rollups live (ET CP V14 — new version appeared and was auto-ingested), Felt 2026-04 = 11 exact, all sync steps clean, Neon warehouse schema = 12 tables + 20 views + 84-client snapshot, BQ refreshed FROM PROD. RBAC fed from Hub table. Prod now self-syncs daily 09:00 UTC. Also wrote capacity-planning-brief.md for the other session (Capacity Planning tab; writers-missing = their read path, data has writers every month). NEXT: Team KPIs capacity iteration on clean base; drop_legacy --confirm when comfortable; DaniQ leftovers self-heal.

## [2026-06-12] decision | MIGRATION FINALIZED: cutover shipped, daily cron, branch MERGED to main (push pending Ricardo)
/goal executed end-to-end: (1) Hub chunk-3 table verified (2,407 rows, schema=contract); (2) hub_parity.py — pre-flip symmetric PASS 2,235=2,235 zero-diff, post-flip gate redefined as CONTAINMENT (0 Hub rows lost; enrichment like @ext writer IDs + Dan→Daniel informational), RBAC identities 13=13; (3) import_team_pods editorial → Hub-first w/ sheet fallback (144 rows); (4) import_pod_history editorial months → Hub table (2,407, growth stays sheet); (5) daily env-gated sync scheduler in main.py lifespan (SYNC_CRON_ENABLED/SYNC_CRON_UTC_HOUR, default 9 UTC); (6) validation battery ALL GREEN (function parity FULL, endpoint 52/52 — earlier "53" was a miscount, hub parity PASS, tsc, ruff/mypy); (7) MERGED --no-ff to main = 539d264. PENDING: Ricardo pushes (auto-deploys Railway+Vercel) AFTER setting Railway env (CLI token expired — needs railway login): TEAM_PODS_ID=10ydCI1mQ5…, ARTICLE_COUNT_ID=1X_M82Vz…, SYNC_CRON_ENABLED=true, DATA_SOURCE_OVERRIDE_ENABLED=false. Post-deploy: trigger /api/migrate/sync-run?scope=full once, verify golden numbers + warehouse schema in Neon. Editorial sheet tabs may retire anytime (fallback stays). Next iteration: Team KPIs capacity additions on clean base.

## [2026-06-12] note | Phase B running — other session backfilling from our view
Planning answers submitted (writers from v_editorial_fct_pod_assignments, Freelancers included, retro-edits lead-only+audit, growth stays ours). Final fingerprint they validate against: 3,682 rows / 94 people / 61 clients / 889 writer rows / 95.4% emailed. Our side now WAITS: their backfill + their BQ publish schema -> then cutover items (retire team-pods-history editorial portion, repoint RBAC to their Hub before sheet dies). Warehouse branch still unmerged (Ricardo gate).

## [2026-06-12] correction | Writer email map manually adjudicated (Ricardo caught heuristic gaps)
Ricardo flagged ashton.playsted@ obviously = Ashton not Eric — review found the co-occurrence heuristic both missed recoverable emails (ericespo23@→Esposito dropped as ambiguous) and made one WRONG auto-assign (sinandvinegar@→Aranyak via coincidental substring; actually Mindy Born by positional evidence). Fixed with a CURATED 38-entry name→email map in build_int_pod_assignments, AUTHORITATIVE over row-level emails (positional pairing was the mispair source); format guard kills comma-joined cells; auto-fallback restricted to unique ≥5-char surname match. Verified zero conflicting emails. jessjadesm@ vs Justine Smith unverified → DaniQ. LESSON: name↔email assignment needs adjudication or strict surname evidence — co-occurrence alone mispairs.

## [2026-06-12] decision | DaniQ client decisions applied (12) + Tempo lineage
DaniQ answered B3: ChatGPT→OpenAI, Engine→Hotel Engine, Landing→Hello Landing, EarnIn B2C/B2B keep split (different clients; both→SF EarnIn), Orderful I+II = same SF account (left+returned; "ok to merge into one" — HUB MERGE PENDING RICARDO, two contract rows), Workleap+Sharegate→Workleap, Meta Manus dismissed (never kicked off), FRC/Lenny/Neeva stay unlinked (she asks if FRC exists in SF — open). TEMPO: old Tempo renamed → Tempo.io (inactive), Tempo XYZ → Tempo (active) — Dani renamed SF + article tabs; we mirrored renames in our copy, re-keyed pre-2026-06 client_pod_history (idempotent in import_pod_history), windowed client rule in int_pod_assignments. 512 articles re-attributed Tempo→Tempo.io (matches OM 507); month_basis missing 153→108, exact 183→196. Honey/TempoXYZ confirmed separate new clients (empty = not delivering yet). Still pending DaniQ: Meta/Meta FoA, Mirage, "/" editor list. Commit 8579fcd.

## [2026-06-12] ingest | Backfill surface shipped: v_editorial_fct_pod_assignments — Phase B unblocked
NEW editorial_int_pod_assignments (Python-resolved at publish: fuzzy client→client_id + ClientNameAlias w/ paren-strip retry, windowed person canon, email-as-display prettified) + v_editorial_fct_pod_assignments (BQ+PG; editorial, writers excluded). Fingerprint for the other session: 2,793 rows · 18 months 2025-01→2026-06 · client_id 98.1% · email 99.5%; unresolved = Meta/Meta FoA/Mirage/TBD (DaniQ-pending; alias→next publish self-heals). Aliases added: Orderfull II→Orderful (II) (Hub has Orderful I AND II as separate clients!), Común→Comun, Captions/Mirage→Captions. Importer glued-email split fix. 27 tables + 20 views. Handoff doc §4 updated to SHIPPED w/ fingerprint. Commit 8c6975f.

## [2026-06-12] note | Cross-session handoff: editorial-team-pods Hub takes over assignment history
Ricardo's other session (editorial-team-pods, Next.js+Neon) is making its Neon the SOURCE OF TRUTH for editorial member↔pod↔client assignments (all months, editable), publishing to BQ; sheets retire for that domain. Wrote the knowledge handoff to /Users/ricardo/python/editorial-team-pods/docs/etl-handoff.md: canonical source = editorial_raw_pod_history (caveats: writers→use article log instead; pod_member dup; raw client strings), identity via email + editorial_raw_name_mappings + Sam/Lauren date windows + v_headcount, cutover = team-pods-history step stops (editorial) BUT RBAC import must repoint to Hub before sheet retires; growth stays ours unless Hub absorbs it. Offered to publish v_editorial_fct_pod_assignments (clean backfill view) on request. Future collab: docs/questions in editorial-team-pods/docs/.

## [2026-06-12] ingest | Team Pods history backfilled (37 monthly tabs) + first ET CP cross-check
TEAM_PODS_ID swapped to the original-era sheet 10ydCI1mQ5… (old temp copy 403'd; compose container must be RECREATED not restarted for .env changes). NEW pod_assignment_history table + import_pod_history() + manifest step team-pods-history (scope past) + warehouse editorial_raw_pod_history: 18,560 rows — editorial Jan 2025→Jun 2026, growth Jul 2024→May 2026 (incl. legacy "Account Team" tab name; 4 paren-2024 legend tabs skipped). Emails ~94% (chips), text fallback otherwise; Editorial WRITER/WRITER EMAIL captured as role='writer' free-text rows. DRIFT vs ET CP (overlap): clients↔pod 100% agreement (322 client-months; TP adds 92 client-months ET CP lacks — backfill candidate for early-2025 article pod attribution); members↔pod 86.5% name-level, 47/69 identical rosters — diffs = pod-move timing months + artifacts ('paused' rows, email-as-name). Committed 5528614 on the warehouse branch.

## [2026-06-11] ingest | Additive sheet standardization applied to fresh article-count copy
New ARTICLE_COUNT_ID=1X_M82Vz… (Ricardo's fresh copy; real sheet locked elsewhere). sheet_standardize.py reworked ADDITIVE per Ricardo's interrupt ("keep the original editor and writer and add the new two normalized"): STANDARD columns inserted on 95 tabs + TEMPLATE, roster dropdowns (strict editor / warning writer) from a Rosters tab, date validation + ISO display. Big find: legacy "MMM d" format hid the year on 446 real dates — undated 502→56, those articles now land in real months. Audit tab + proposal doc shipped; ingestion verified identical (15,156 rows, Felt Apr=11); warehouse + reports regenerated. Pending: DaniQ approval → rollout to real sheet; her "/" list fills 1,471 collab rows. See [[normalization-scope-2025]].

## [2026-06-11] decision | Sam/Lauren closed via headcount date-windows; normalization scope = 2025+
Date-windowed aliases added (article_name_aliases.valid_from/to + importer resolution): "Sam" ≤2026-01 → Samantha McGrail, ≥2026-02 → Samantha Marceau (Rippling tenure windows match log months exactly); bare "Lauren" → Lauren Friar (DaniQ renamed the new Lauren Keleher in-sheet). Felt fixed earlier same day (header-row detection + new origin sheet 1eRmZ…). Ricardo's scope rule recorded: pre-2025 name mismatches accepted, capacity-model coverage 2025+ is the bar; Hub badge idea backlogged. Honey/Honeybook + TempoXYZ/Tempo flagged as separate SOW rows needing Dani confirmation. See [[normalization-scope-2025]].

## [2026-06-11] decision | DUAL-SINK final architecture: app serves Postgres `warehouse` schema, BQ = mirror/backup
Ricardo audited the BQ-only repoint ("keep the mix… after you audit please implement it") and we shipped dual-sink: one ~20s publish writes the same in-memory rows to Postgres schema `warehouse` (11 tables + 19 PG-dialect views, `etl/warehouse/pg_sink.py`) AND BigQuery (25 tables + 19 views). `DASHBOARD_SOURCE=postgres` default (~13ms reads); `X-Data-Source` override gated by `DATA_SOURCE_OVERRIDE_ENABLED` (off in prod). 4-agent adversarial audit (2 critical, 14 major) fully fixed — incl. prod Dockerfile `COPY etl/`, deliveryMeta end-date fold, flush failure isolation, wizard publish 500, synthetic-step flag, id tiebreaks. Re-verified: function parity 3,612 fields + NEW 1,233 period-map check; endpoint parity 53/53 (16 new pagination/filter cases). Docs swept (WAREHOUSE_DESIGN dual-sink section, README deprecation banner, CLAUDE.md, AGENTS.md). Branch `feature/etl-warehouse-refactor`, awaiting Ricardo's validation before merge.

## [2026-06-11] note | Dashboards repointed to BigQuery — 37/37 endpoints identical (branch, unmerged)
DASHBOARD_SOURCE flag + bq_dashboard.py read layer (22 routes); endpoint parity
37/37 after 3 loop iterations (tz normalization, deterministic tiebreaks both
paths); Playwright-validated on all 3 dashboards (golden capacity numbers
identical via BQ). SYNC/Re-sync/wizard auto-publish the warehouse via manifest
steps; ./etl/refresh.sh = terminal one-liner. Commit f3ebf90. Awaiting
Ricardo's validation before merge.

## [2026-06-10] note | Warehouse refactor BUILT + FULL PARITY (branch feature/etl-warehouse-refactor)
Layered raw(16)/int(8)/views(18) warehouse replacing the 36-table mirror;
pyrules.py = verbatim ports of the frontend variance/goals math; parity proven
against the REAL frontend functions via frontend/scripts/parity-dump.ts (3,444
field comparisons identical) + API replays. WAREHOUSE_DESIGN.md carries the
schema + 12-entry bug-for-bug register. Commit aa28d0c. Playwright session
authenticated by Ricardo (visual checks unblocked).

## [2026-06-10] decision | Gantt is a LIVING planning doc; keep it updated; not a release
Ricardo: the project Gantt (Google Sheet `1rL1cTWgAROxCV1NKO-tuW5bebgk7dn2oQVrHsgRg19w`,
shared w/ the SA) is a living planning file — keep it current each session (real weeks,
bar colors, %, statuses, rows). Gantt/PM updates + small iterative dashboard tweaks are
**NOT software releases** (no version bump unless he asks). Edited it directly via the
Sheets API (months realigned to ISO weeks, phases, task bars, current-week auto-highlight
CF, scoped the done clean-up row + added pending 1.5 "origin normalization + data
validation post-DaniQ"). Data clean-up is NOT terminated — big remaining work in origin
sheets after DaniQ. See [[reference-gantt-chart]].

## [2026-06-10] note | ETL→BigQuery phase 1 BUILT + FULL PARITY proven
`etl/` package built (run/manifest/extract/transform/load/parity/build_mappings):
ingest delegates to app sync_manifest (SYNC-button code, scopes preserved);
publish lands 27 mirrored tables + 5 marts + 3 mapping tables in
`graphite_bi_sandbox.editorial_*` via JSON load jobs (no pyarrow).
`PARITY_REPORT.md` = FULL PARITY (fingerprints + member-utilization/pod-summary/
articles-monthly replayed from BQ byte-identical). capacity_calc.py extracted as
shared math (router + mart). New endpoints: client-contributions,
member-utilization-matrix. See `now.md`.

## [2026-06-10] correction | Capacity combined-cell splitter bug fixed
`_parse_member_breakdown` ignored space-separated compounds — "Maggie Gowland
(14) Anabelle Zaluski (10)" counted as ONE person with capacity 10 (wrong person,
wrong capacity). Fixed (≥2 numeric parens → secondary split), ET CP re-imported,
golden Pod-1 May numbers unchanged. Also: backend uvicorn has NO --reload —
restart after app-code edits or the API serves stale code while `exec python`
runs fresh code.

## [2026-06-10] decision | Writer aliases applied (78 renames, reversible)
Writer dictionary generated (roster = pod_assignments role='writer' ∪ historical
full names from ai_monitoring + notion; nickname prefix-matching) and the 78
high-confidence renames loaded into article_name_aliases (kind='writer',
source='etl') → importer self-heals; distinct writer names 244→208; ~70% of
writer rows full-named. Editors NOT auto-applied (Lauren/Sam ambiguity → DaniQ).
Mike=Michael Doyle (HR dates match); Kennedy Sievers=Stevens typo;
Maggie/Tiffany HR-vs-capacity mismatch = recent terminations (timing artifact).

## [2026-06-10] note | DaniQ report v2 + UI: capacity sections + metric sub-tabs
DATA_QUALITY_CAVEATS_for_DaniQ.md rewritten non-technical with decisions D1–D8 +
embedded before→after tables. Team KPIs → Capacity by Pod: + Client
Contributions (processed per-client table) + Utilization Trend (member×month
heat matrix) + SectionIndex. Monthly Articles: metric sub-tabs + KPI strip +
matrix expand-all + rate heat tint. tsc + prod build green; visual check blocked
by OAuth (Playwright profile needs one manual login).

## [2026-06-09] decision | ETL → BigQuery migration is the new north star
Move all ingestion + transforms + dashboard processing into `etl/` → land canonical
processed tables in `graphite_bi_sandbox.editorial_*`; dashboard becomes a thin BQ
reader. Wrote handoff in `editorial-hub/etl/` (README, ETL_INVENTORY, NAME_MAPPINGS,
DATA_QUALITY_CAVEATS_for_DaniQ). Canonical names confirmed via SA key (project
graphite-data): v_team_pods_editorial (editors), salesforce_int_Account (clients).
BI Hub MCP disabled for this work — use google-cloud-bigquery + sa-key.json.
See `decision_2026-06-09_etl_bq_migration.md` + `now.md` (handoff). Next session: BQ
DDL + ET CP extract→transform→load as the pattern.

## [2026-06-09] note | Capacity utilization built; memory wiki set up
Built per-editor capacity utilization reproducing Ricardo's sheet exactly (Pod 1
May: Real 54.44/72.59/94.69, Weighted 69.29/92.39/120.51). Endpoints
`/api/capacity/{pod-summary,member-utilization}`; Team KPIs → Capacity by Pod tab.
Created `now.md`, `index.md`, this log, and the analysis/decision files below.

## [2026-06-09] decision | Capacity-util model = facts/dims joins-only + fallback-as-distribution
See `decision_2026-06-09_capacity_util_model.md`. Articles are a distribution key
scaled to authoritative pod RAW actual; RAW totals drive per-member math; weighted
(×1.4) only for pod reference; `capacity_projections` kept as validation cache.

## [2026-06-09] correction | "Missing articles" is mostly a MONTH-DEFINITION mismatch
See `analysis_article_count_data_quality.md`. Earlier framing ("article log missing
~2/3") was largely wrong: article log buckets by submitted date + editorial week
(week 1 ~the 6th); OpModel/Goals bucket by delivered/~calendar month. Miter proved
73/73 ingested, 0 lost; Goals-vs-Delivery = 28 = OpModel. Real ingestion losses
(471 NULL-month, Felt 96) + source gaps (Meta, College HUNKS) are smaller, separate.

## [2026-06-09] correction | Fixed off-by-one in import_et_cp_pod_history
Pod column was picked positionally (13-month Dec→Dec) but client block is 12 cols
(Jan→Dec) → read NEXT month's pod (e.g. Pylon May stored Pod 3, true Pod 1). Now
header-derived; deleted dead `_et_cp_sheet_months`. Verified pod recompute = sheet.

## [2026-06-06] ingest | Per-month editorial pod + category shipped
`client_pod_history.category` added; articles attribute to as-of-month pod (no
fallback → "Unassigned" surfaced in Data Quality → Pod coverage). See
`project_monthly_article_count.md`.
