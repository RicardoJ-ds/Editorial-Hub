---
name: editorial-hub-project
description: Editorial Hub BI Dashboard - centralized app replacing Google Sheets for client deliverables tracking and team KPIs at Graphite
type: project
---

Editorial Hub is a BI dashboard for Graphite's Editorial Team. Replaces multiple disconnected Google Sheets with a centralized web app.

**Why:** Manual spreadsheet overhead grows with scale; KPIs not tracked anywhere, blocking performance reviews.

**How to apply:**
- Stack: Next.js 14 + shadcn/ui (frontend/) + FastAPI + PostgreSQL (backend/) + Docker Compose
- Google Sheets import is ONE-TIME migration only — app is the primary data entry tool
- BigQuery sync to `graphite_bi_sandbox.editorial_hub_*` for analytics
- No auth for MVP
- Design system: Graphite Internal DS (dark mode, specific colors/fonts in ../50-sources/design-system/Graphite-Interal-DS.html)
- SA key: graphite-bi-sa@graphite-data.iam.gserviceaccount.com
- Data already fetched to /data/*.csv (9 sheets from master planning spreadsheet)
- 3 PRDs analyzed (Build Prompt v3, PRD Final v3, PRD Input Template)
