---
name: vercel-editorial-hub-project
description: Vercel project coordinates for editorial-hub — team scope, project ID, production alias, and Root Directory setting
type: reference
originSessionId: f60f7a87-f460-4dc2-9097-2b715672ffe2
---
Vercel project for this repo:

- Team scope: `graphite-24fe7497` (display name: "Graphite")
- Project name: `editorial-hub`
- Project ID: `prj_PGaZcbB6mXaMvHeAUuDXARUjmQqP`
- Production alias: `editorial-hub-kappa.vercel.app`
- Root Directory: `frontend/` (set Apr 16 2026 — Git auto-deploys failed silently before this)

CLI commands:
- List recent deploys: `npx vercel ls editorial-hub --scope graphite-24fe7497`
- Inspect build logs: `npx vercel inspect <deployment-url> --scope graphite-24fe7497 --logs`
- Manual prod deploy from `frontend/`: `npx vercel --prod --yes --scope graphite-24fe7497`

The repo has linked `.vercel/` at both repo root and `frontend/` — both point to the same project.
