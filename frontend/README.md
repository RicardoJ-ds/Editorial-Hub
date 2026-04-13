# Editorial Hub — Frontend

Next.js 14 dashboard application for Graphite's Editorial Team.

## Dashboards

- **Dashboard 1** (`/editorial-clients`) — Client delivery tracking, pipeline metrics, goals vs delivery
- **Dashboard 2** (`/team-kpis`) — Team KPI performance heatmap, AI compliance, Surfer API usage

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
