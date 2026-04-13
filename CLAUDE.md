# Editorial Hub

## Project Links
- **PRD 1 (Build Prompt v3)**: https://docs.google.com/document/d/19CxD9p9EWpN54blgSI8V-Anqc5N_7Ax1/edit
- **PRD 2 (PRD Final v3)**: https://docs.google.com/document/d/1CbCpQ5VACySSmSVVk9S4eMBPlanNWCzP/edit
- **PRD 3 (Input Template — detailed)**: https://docs.google.com/document/d/1tus6wvrQIrQf-ygXQxtogv6QOocv8PMsRN8xnNp6fJQ/edit?tab=t.0
- **Data Spreadsheet**: https://docs.google.com/spreadsheets/d/1I6fNQMjs2y4l6IyOxd9QL-QBjB2zGi0mcoV840JDmkI/edit
- **Local copies of PRDs**: `data/` directory (gitignored — local reference only)

## Architecture
- **Frontend**: Next.js 14 + shadcn/ui + Tailwind v4 (`frontend/`)
- **Backend**: FastAPI + SQLAlchemy async + PostgreSQL (`backend/`)
- **Local dev**: Docker Compose (postgres:5480, backend:8050, frontend:4050)
- **Service Account**: `graphite-bi-sa@graphite-data.iam.gserviceaccount.com` on project `graphite-data`
- **BigQuery**: `graphite_bi_sandbox.editorial_hub_*` tables
- **Design System**: `.docs/Graphite-Interal-DS.html` (gitignored — local reference only)

## Setup
```bash
cp .env.example .env              # Copy and fill in real values (passwords, sheet IDs)
```
All secrets and configuration are loaded from `.env` — see `.env.example` for required variables.

## Key Commands
```bash
docker compose up -d              # Start full stack
docker compose down               # Stop all services
cd backend && python scripts/seed_data.py  # Seed DB from CSVs (port 5480)
cd frontend && npm run dev        # Frontend dev server (standalone)
cd frontend && npm run build      # Verify build
```

## Data Sources (Google Sheets)
**Full sheet inventory:** `.docs/sheet-inventory.md` (gitignored — local reference only)

### Spreadsheet 1: Editorial Capacity Planning
ID: `1I6fNQMjs2y4l6IyOxd9QL-QBjB2zGi0mcoV840JDmkI`
- "Editorial SOW overview" → clients table
- "Delivered vs Invoiced v2" → deliverables_monthly table
- "ET CP 2026 [V11 Mar 2026]" → team_members + capacity_projections
- "Model Assumptions" → model_assumptions
- "Editorial Operating Model", "Meta Calendar Month Deliveries", "Editorial Engagement Requirements", "Delivery Schedules" → reference data

### Spreadsheet 2: Master Tracker
ID: `1dtZIiTKPEkhc0qrlWdlvd-n8qAn5-lhVcPkgHNgoLAY`
- "Cumulative" → cumulative_metrics table (all-time pipeline per client)
- "[Month Year] Goals vs Delivery" (x9 sheets) → goals_vs_delivery table (weekly delivery tracking)

### Spreadsheet 3: Writer AI Monitoring
ID: `13kl0_6YuzsJ3xEzNLzDZeR-sHMaNJNw6oJGmwb-CBOU`
- "Data" → ai_monitoring_records table (1,168 AI scan results)
- "Rewrites" → ai_monitoring_records (is_rewrite=True)
- "Yellow/Red Flags_v2" → ai_monitoring_records (is_flagged=True)
- "Surfer's API usage" → surfer_api_usage table

## PRD Compliance
- **Audit:** `.docs/prd-compliance-audit.md` (gitignored — local reference only)
- Current coverage: **~98%** (excl. auth, which is deferred per PRD §9)
- **All 9 D2 KPIs now use REAL data** (0 mock remaining):
  - Revision Rate, Turnaround Time, Second Reviews → Notion DB (13,372 articles)
  - AI Compliance → Writer AI Monitoring 2.0 (1,168 records)
  - Capacity Utilization → ET CP 2026 capacity_projections
  - Internal Quality, External Quality, Mentorship, Feedback Adoption → Monthly KPI Scores sheet
- **Remaining P1 gaps:** Quarter picker on D2, auto-detect latest CP version

## Design Preferences
- Dark mode by default
- Graphite DS colors: greens (#65FFAA, #42CA80, #2EBC59), neutrals (#161616, #1F1F1F, #333333, #000000)
- Typography: IBM Plex Sans (body), JetBrains Mono (labels/data)
- shadcn/ui components customized with Graphite theme
- No auth for MVP
- App is primary data entry tool (no ongoing Google Sheets sync)
