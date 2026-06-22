---
name: ai-impact-analysis
description: "The \"AI Impact / Time Saving & Cost\" deliverable quantifying Editorial toolset savings for Ethan & Rafa — workbook, numbers, sources, access blocker"
metadata: 
  node_type: memory
  type: project
  originSessionId: 615365e5-c0c5-40d8-bacf-dfc56631f55e
---

One-time task (Jun 2026): boss (via Simón/Paolo) asked the team to quantify time/cost savings delivered to other teams. Ricardo owns the **Editorial** side. Simón's "Time Saving & Cost" **group DM** (`C09QLRMEDH9`, with Paolo `U03B02PKRLZ` + Simón `U07FXBS1SE5`) logs entries (Legal Automation, Performance Review Platform, Vercel cost agent, PowerBI/Looker replacement). Paolo's bare "AI Impact" sheet = `1ajbCjhEl3ETL60TX47mI1lPE4WiF07XutgRsdL6X_Vk` (cols: Project · Time before/after (mins) · Costs Saved). Format call: **per-event** (Paolo). Ricardo's decision: **build our own, more complete workbook** and hand to Paolo.

**Deliverable built locally:** `/Users/ricardo/python/ai-impact-analysis/Editorial_AI_BI_Impact.xlsx` (formula-driven; Assumptions tab is single source). Rebuild: `.venv/bin/python build_workbook.py`. Tabs: Summary · Detail (per-event & per-year) · Agent Deep Dive · Strategic & Qualitative · Assumptions.

**Headline (conservative, live tools):** AI Editorial Agent 90min→~21.5min/article (Chrissy Woods `U04C8FD1RH9` DM: "1.5 hours as an average") × **~321 articles/mo** → ~4,400 editor hrs/yr (~2.4 FTE), ~$132k/yr @ $30/hr; agent compute ~$20–50/mo → ~220× ongoing ROI. Hub ~204 hrs/yr (DaniQ `U035XBY94F4`), Team Pods ~84 hrs/yr. Predictive (montecarlo/Predictive Analysis) = prototype, projected only. Total realized ~4,686 hrs/yr / ~$142k/yr.

**Key source decision (Ricardo's steer):** volume = **Editorial Operating Model actual delivered** (`production_history`, trailing-12 = 3,858 → ~321/mo; matches DaniQ Apr 339/May 364), NOT the raw article log (~300, undercounts — see [[analysis-article-count-data-quality]]); revisions/editor detail from the **revised Monthly Article Count**. Per-pod via `production_history × clients.editorial_pod`.

**Confirm cells (yellow):** editor after-time/article (20m), editor $/hr ($30), ops $/hr ($35), DaniQ Hub 20→3 h/mo + Pods 8→1 h/mo (self-estimates), rollout % (100 = full potential vs SE-pilot today).

**DELIVERED (2026-06-17):** written into Ricardo's Google Sheet **"Improvements Record"** = `1yKpmlDgrucZKRuwm0UOm23P28b6DjT5PgOI-P60bmtI` (folder `1ANLXT-i8v9S1LJLJqE4Wso-NO8BY-4im` = My Drive ▸ Editorial ▸ Improvements Record). Ricardo had seeded it with a guide row (cols Team/Task/Frequency/Time before/after/saved + "improve it, add windows: per event/week/person/year, for whom, impact"); superseded per his instruction. 4 tabs: Improvements Record (his cols + windows + KPI strip + who-benefits + caveats) · Agent Deep Dive · Strategic & Qualitative · Assumptions. Formula-driven (SA wrote via Sheets API, USER_ENTERED). Verified live: Agent 4,398 hrs/yr / $131,931; total 4,686 hrs / $142,011; FTE 2.4; ROI 220×.

**Access:** Google Drive MCP now authenticated (acts as Ricardo). SA `graphite-bi-sa@...` CAN read/write the sheet (folder shared) but CANNOT create Drive files (no storage quota — `files.create` 403). Local build also at `/Users/ricardo/python/ai-impact-analysis/` (build_gsheet.py = the live writer; build_workbook.py = xlsx fallback). Rebuild/re-push: `.venv/bin/python build_gsheet.py`.
