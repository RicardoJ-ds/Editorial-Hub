---
name: railway-editorial-hub-backend
description: Railway service coordinates, backend URL, prod DB, GitHub auto-deploy wiring, and the manual-deploy fallback for editorial-hub-api
type: reference
originSessionId: 23c3ccc6-47f6-4ded-b81d-8c6cce94c86b
---
Railway service for the editorial-hub backend:

- Project: `editorial-hub-api` (`213348e5-990b-4762-98c1-a49d6ee91677`)
- Service: `editorial-hub-api` (`2a9bbf6a-b4c5-4628-88eb-49b516b46943`)
- Environment: `production`
- Public URL: `https://editorial-hub-api-production.up.railway.app`
- Dockerfile: `backend/Dockerfile` (build context must be `backend/`)
- Root config: `/railway.toml` has `dockerfilePath = "backend/Dockerfile"` and `watchPatterns = ["backend/**"]`

Prod database (Neon Postgres):
- Host: `ep-lingering-boat-an8s9uj1-pooler.c-6.us-east-1.aws.neon.tech`
- Database: `neondb`
- `DATABASE_URL` is injected into the Railway service; pull via `railway variables --kv | grep DATABASE_URL`

**Deploy path: GitHub auto-deploy is primary.** As of 2026-04-23 the service is wired to `RicardoJ-ds/Editorial-Hub` on branch `main` (Settings → Source), with Root Directory blank and "Wait for CI" off. Every push to `main` triggers a Railway build — no CLI step needed. Two duplicate Railway projects (`jubilant-bravery` for editorial-hub, `soothing-recreation` for graphite-brain) were deleted the same day; they had been shadow-building every push and masking which deploy was actually serving prod.

CLI commands:
- Status: `railway status --json | jq '.environments.edges[0].node.serviceInstances.edges[0].node.latestDeployment | {id,status,createdAt}'`
- Build logs: `railway logs -b -n 200 <deployment-id>`
- Runtime logs: `railway logs -d -n 200 <deployment-id>`

**Manual deploy fallback** (use only if GitHub auto-deploy stalls or for an uncommitted hotfix):
```sh
cd /Users/ricardo/python/editorial-hub
railway up --detach --service editorial-hub-api
```
The Dockerfile (`backend/Dockerfile`) references paths from the project root:
```dockerfile
COPY backend/requirements.txt .
COPY backend/ .
```
So the build context must be the project root — plain `railway up` from the repo root is correct. Do **NOT** pass `--path-as-root backend`: it strips the `backend/` directory from the upload and the `COPY backend/...` lines fail with `"/backend": not found`. Same reason Railway's Root Directory must stay blank (`/`), not `/backend`.

History: earlier memory said to use `--path-as-root backend`. That worked before commit `e94b46d` (Apr 20 2026) which flipped the Dockerfile to project-root paths. Deploys with the old flag now fail at build step `[4/8] COPY backend/requirements.txt .`.

**Why auto-deploy can silently stop**: GitHub push → Railway webhook → watchPatterns filter. If any step breaks (webhook unauthorized, integration reset), pushes still succeed but Railway stays on the last image. Symptom: prod endpoint 404 while the committed route exists in main. Check `latestDeployment.createdAt` — if it lags HEAD by hours, re-run the manual deploy above.
