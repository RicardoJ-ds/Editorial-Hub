---
name: team-pods-sheet-temporary
description: Team Pods source spreadsheet ID — currently a temporary copy, must be swapped for the original later
type: reference
originSessionId: 64b08894-7fc6-4aca-8b18-05b3f98176b9
---
**Current ID (temporary):** `1N6q1ZYC4W9BYusewdwqwprUu9zSmbQp99mC3f2y3_HI`

URL: https://docs.google.com/spreadsheets/d/1N6q1ZYC4W9BYusewdwqwprUu9zSmbQp99mC3f2y3_HI/edit

Tabs:
- `Editorial Team [May 2026]` — Pod # / Pod Members (names with `(SE)` / `(E)` role tags) / Client / Senior Editor / Editor / Writer
- `Growth Team [May 2026]` — mirrors the BigQuery `growth_pods_assignments` table

**Why temporary:** this is a copy made by the user (Ricardo) for development. The team's real source-of-truth sheet has a different ID. Before shipping to production, swap to the real ID. Look for "[Int] Team Pods" (no "Copy of") at https://docs.google.com/spreadsheets/d/1kKp4PU6S8eMgayXWpju2FIIZ-cu4EZhjTaUHNsjWS7s/edit (the source the copy was made from — confirm with user before relying on it).

**Auth:** read with the existing `graphite-bi-sa@graphite-data.iam.gserviceaccount.com` service-account credentials (`sa-key.json`), same as every other Sheets importer.

**Where to plug it in (when implementing):** add `TEAM_PODS_ID` to `backend/app/config.py` so swapping the ID is a one-line env change. Don't hard-code the ID in the importer.
