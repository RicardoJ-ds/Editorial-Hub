<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

Next.js 16 + React 19 in this repo. APIs and conventions may differ from your
training data. Before writing new framework code, skim the relevant guide in
`node_modules/next/dist/docs/`. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Project quick-reference

- **Routes + folder structure**: `README.md`
- **Auth flow**: `src/lib/auth.ts`, `src/lib/session.ts`, `proxy.ts`
- **API client**: `src/lib/api.ts` (`apiGet`/`apiPost` against `NEXT_PUBLIC_API_URL`)
- **Shared types**: `src/lib/types.ts` — mirror of `backend/app/schemas.py`. When you add or rename a field in either place, update both.
- **Store pattern (CP v2)**: `src/app/(app)/capacity-planning/_store.tsx` is a React context backed by `localStorage`. Every CP v2 page reads + writes through this store. When the backend ships `/api/cp2/*` endpoints, swap `localStorage` calls for `apiGet`/`apiPost`; UI stays the same.
- **Filter bar**: `src/components/dashboard/FilterBar.tsx` fans out filtered client list + date range via `onFilterChange` + `onDateRangeChange`. Dashboards that want time-aware charts must consume both.
- **Pod label normalization**: `normalizePod()` appears in several files (`FilterBar.tsx`, `ContractClientProgress.tsx`, `DeliveryTrendChart.tsx`, `CumulativePipelineCards.tsx`). "Pod 1" / "1" / "pod 1" all collapse to "Pod 1". Keep the function in sync across files or extract to `src/lib/pods.ts` next time someone touches it.
- **Pod display formatter**: `displayPod(pod, "editorial" | "growth")` in `src/components/dashboard/shared-helpers.tsx`. Returns `"Editorial Pod 1"` / `"Growth Pod 1"` / `"Unassigned"`. Keys passed around the code (`"Pod 1"` etc.) are never shown verbatim in user-facing copy — always wrap in `displayPod()` when rendering. `podBadge()` already does this internally.
- **Sync UX**: Header `SYNC` button → `SyncAllModal` (`src/components/data-management/SyncAllModal.tsx`) → per-sheet fan-out to `/api/migrate/import` → final render is `SyncResultDetail` (same component the Import Wizard uses on completion). One `window.dispatchEvent(new Event("data-synced"))` fires at the end; dashboards listen for this to refetch.
- **Section-header style**: Every top-level section on Dashboard 1 uses the same h2 pattern — `font-mono text-base font-bold uppercase tracking-[0.2em] text-white` + `h-px flex-1 bg-[#2a2a2a]` horizontal rule on the right. Card h3s use `text-sm font-semibold` (`#C4BCAA`). When adding a new section, mirror this to keep the visual hierarchy intact.
- **Sticky section headers + anchor nav**: each top-level `<section>` on D1/D2 carries `id="…"` + `scroll-mt-[180px]`, and the h2 wrapper is `sticky top-[160px] z-10 bg-black pb-2 pt-1`. Each tab also renders `SectionIndex` (`src/components/dashboard/SectionIndex.tsx`) — a sticky left-side rail with scroll-spy + click-to-jump. Critical: the page's scroller is the `overflow-auto` `<div>` from `app/(app)/layout.tsx`, not `window`. `SectionIndex` walks up the DOM and listens to every scrollable ancestor — keep it that way.
- **Scope-aware overview cards**: the top of each Deliverables-vs-SOW section renders one of three card sets depending on filter scope — single client / single pod / portfolio. Implementations: `DeliveryOverviewCards`, `CumulativePipelineCards`, `GoalsOverviewCards`. Portfolio mode drops cumulative sums (sums across pods aren't actionable) and shows triage signals (most-behind, closing-soon, pod with most attention). `framer-motion`'s `AnimatePresence` handles the layout swap when scope changes.
- **Pipeline stage palette**: `PIPELINE_STAGE_COLORS` in `src/components/dashboard/shared-helpers.tsx` — Topics #2E8C59 → CBs #42CA80 → Articles #65FFAA → Published #DDCFAC. Strictly Graphite DS swatches (P3 → P2 → P1 + WN1). Don't reintroduce S1/S2/S8 (blue/purple/cyan) on pipeline bars — flagged off-brand.
- **Pacing-aware coloring**: percentages that mean "% of contract progress" (e.g. lifetime delivered) use `pacingColor(actualPct, elapsedPct)` from `shared-helpers.tsx` — green inside ±10pp of expected, yellow at -25pp, red beyond. New clients (<8 % elapsed) always read green. Don't fall back to raw 75 / 50 thresholds for these metrics.
- **Content-type weighting**: goals aggregations multiply CBs / articles by `contentTypeRatio()` (article ×1, jumbo ×2, LP ×0.5). The content-type table is authoritative; the sheet's `ratios` column is fallback only because direction (`1:2` vs `2:1`) was inconsistent. Apply weighting consistently across `GoalsVsDeliverySection`, `aggregateGoalsByPod`, and `GoalsMonthTable` via 3-step aggregation (max-of-week per CMC → weighted client/month → pod totals) or totals diverge. Note this changed published numbers vs. pre-Apr 26 — a client with 17 article + 2 jumbo rows now reads 21, not 19.
- **"As of" labels** read from latest data, not `now`. `ContractTimelineTab` uses the most recent Operating Model month with actuals; `GoalsVsDeliverySection` uses the latest `scopedRows.month_year + week_number`. Don't reintroduce `Date.now()` for these labels — mid-month sessions printed wrong dates before.
- **`FilterBar` zero-match fallback**: when non-date filters yield no clients, the date range resets to "All Time" so the user isn't stuck with an empty window. Mirror this if you add new filter dimensions.
- **Tooltip body**: import `TooltipBody` from `shared-helpers.tsx` for every metric tooltip — uppercase mono title + 2–3 short bullets. Trigger should be tight (no large hit-area padding). `DataSourceBadge` is the only intentional exception (source metadata, not metric explanation).

## House rules

- Dark surfaces only (`bg-[#0d0d0d]` / `#161616` / `#1F1F1F`). Never use `bg-background` token for tooltips — it resolves unreliably and renders transparent.
- `DataSourceBadge` on every chart/section. The `source` prop carries a human description of the source sheet + formula.
- Emoji-free.
- No `Co-Authored-By` lines in commit messages.
