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
- **Pod label normalization**: `normalizePod()` appears in several files (`FilterBar.tsx`, `ContractClientProgress.tsx`, `DeliveryTrendChart.tsx`, `PipelineFunnelChart.tsx`). "Pod 1" / "1" / "pod 1" all collapse to "Pod 1". Keep the function in sync across files or extract to `src/lib/pods.ts` next time someone touches it.

## House rules

- Dark surfaces only (`bg-[#0d0d0d]` / `#161616` / `#1F1F1F`). Never use `bg-background` token for tooltips — it resolves unreliably and renders transparent.
- `DataSourceBadge` on every chart/section. The `source` prop carries a human description of the source sheet + formula.
- Emoji-free.
- No `Co-Authored-By` lines in commit messages.
