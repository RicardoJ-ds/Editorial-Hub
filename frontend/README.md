# Editorial Hub — Frontend

Next.js 16.2 dashboard application for Graphite's Editorial Team.

## Production

- **Vercel**: `editorial-hub-kappa.vercel.app`
- **Backend API**: `editorial-hub-api-production.up.railway.app` (Railway)
- **Auto-deploy**: GitHub `main` → Vercel (1–2 min propagation)

## Dashboards & Routes

| Path | What it is |
|---|---|
| `/` | Home — dashboard picker |
| `/editorial-clients` | **D1**: Contract & Timeline + Deliverables vs SOW tabs |
| `/team-kpis` | **D2**: KPI heatmap + Capacity Projections + AI Compliance tabs |
| `/capacity-planning` | **CP v2 prototype** (proposal; localStorage-backed) |
| `/capacity-planning/{roster,allocation,leave,overrides,weekly,quarter,gantt,schema,tables,glossary,migration,admin/*,pipeline,delivery,articles,kpi-scores,ai-scans,surfer}` | CP v2 sub-routes (see `CAPACITY_PLANNING_V2.md` for status per route) |
| `/data-management/import` | Import Wizard + Re-sync past months (sidebar entry) |
| `/data-management/{clients,deliverables,capacity,kpi-entry}` | Legacy CRUD pages — still routable but hidden from the sidebar; will be replaced by CP v2 maintain screens |
| `/admin/access` | **Access Control** UI mockup — users × views permission matrix, groups (PRD §7-aligned), audit log. Mock data only |
| `/(auth)/login` | Google OAuth handshake |

## Auth

Google OAuth via `/api/auth/*`, session gated by `proxy.ts` + `(app)/layout.tsx`.
Restricted to `ALLOWED_EMAIL_DOMAIN` (default `graphitehq.com`). Session is a
JWT cookie signed with `AUTH_SECRET`. See `src/lib/auth.ts` and `src/lib/session.ts`.

## Tech Stack

- **Next.js 16.2** + React 19 + TypeScript (App Router, route groups)
- Tailwind CSS v4 + shadcn/ui (Graphite dark theme)
- Recharts for data visualization (+ custom SVG overlays for clipped-value markers)
- `framer-motion` for layout transitions on scope-aware overview cards
- `@xyflow/react` + dagre for the CP v2 schema ERD
- `@base-ui/react` Tooltip primitive
- IBM Plex Sans (body) + JetBrains Mono (data labels)

## Folder Structure

```
src/
├── app/
│   ├── (app)/                    # authenticated shell + sidebar
│   │   ├── editorial-clients/    # D1
│   │   ├── team-kpis/            # D2
│   │   ├── capacity-planning/    # CP v2 prototype (all phases)
│   │   └── data-management/      # admin CRUD
│   ├── (auth)/
│   │   └── login/
│   └── api/auth/{login,callback,logout,me}/
├── components/
│   ├── charts/                   # Recharts wrappers (Delivery, Production, etc.)
│   ├── dashboard/                # FilterBar, SummaryCard, pod matrix, etc.
│   └── ui/                       # shadcn primitives
└── lib/
    ├── api.ts                    # apiGet + base URL
    ├── auth.ts + session.ts      # OAuth + JWT
    └── types.ts                  # shared response shapes
```

## Development

```bash
npm run dev        # Dev on port 3000 (Docker exposes 4050)
npm run build      # Production build
npx tsc --noEmit   # Type-check
```

Requires backend on `http://localhost:8050` (use `docker compose up -d`).

## Environment

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_API_URL` | Backend base URL (default `http://localhost:8050`) |
| `GOOGLE_OAUTH_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Google OAuth client secret |
| `AUTH_REDIRECT_URI` | OAuth callback (default `http://localhost:4050/api/auth/callback/google`) |
| `AUTH_SECRET` | 32+ byte secret for signing session JWT (`openssl rand -base64 32`) |
| `ALLOWED_EMAIL_DOMAIN` | Workspace domain (default `graphitehq.com`) |

## Related Docs

- [`CAPACITY_PLANNING_V2.md`](../CAPACITY_PLANNING_V2.md) — CP v2 schema proposal
- [`CP2_COVERAGE_AUDIT.md`](../CP2_COVERAGE_AUDIT.md) — column-level coverage
- [`.docs/dashboard-data-flow.md`](../.docs/dashboard-data-flow.md) — dashboard → source mapping + migration plan
- [`docs/SHEETS_DOCUMENTATION.md`](docs/SHEETS_DOCUMENTATION.md) — per-sheet column reference
