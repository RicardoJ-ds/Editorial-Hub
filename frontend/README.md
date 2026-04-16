# Editorial Hub — Frontend

Next.js 14 dashboard application for Graphite's Editorial Team.

## Dashboards

- **Dashboard 1** (`/editorial-clients`) — Client delivery tracking, pipeline metrics, goals vs delivery
- **Dashboard 2** (`/team-kpis`) — Team KPI performance heatmap, AI compliance, Surfer API usage

## Proposal

- **Capacity Planning v2** (`/capacity-planning`) — Overview board, roster matrix, allocation kanban (prototype, localStorage-backed)

## Auth

Google OAuth via `/api/auth/*`, session gated by `proxy.ts` + `(app)/layout.tsx`. Restricted to `@graphitehq.com` (`ALLOWED_EMAIL_DOMAIN`). JWT session cookie signed with `AUTH_SECRET`.

## Tech Stack

- Next.js 16 + React 19 + TypeScript
- Tailwind CSS v4 + shadcn/ui (Graphite dark theme)
- Recharts for data visualization
- IBM Plex Sans (body) + JetBrains Mono (data labels)

## Development

```bash
npm run dev        # Dev server on port 3000 (Docker exposes 4050)
npm run build      # Production build
```

## Environment

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_API_URL` | Backend API base URL (default: `http://localhost:8050`) |
| `GOOGLE_OAUTH_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Google OAuth client secret |
| `AUTH_REDIRECT_URI` | OAuth callback (default: `http://localhost:4050/api/auth/callback/google`) |
| `AUTH_SECRET` | 32+ byte secret for signing the session JWT (`openssl rand -base64 32`) |
| `ALLOWED_EMAIL_DOMAIN` | Workspace domain allowed to sign in (default: `graphitehq.com`) |
