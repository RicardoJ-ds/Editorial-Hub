# Google Sheets Data Source Inventory

Complete mapping of all Google Sheets used (and not used) by the Editorial Hub application.

---

## Spreadsheet 1: Editorial Capacity Planning

**ID:** `1I6fNQMjs2y4l6IyOxd9QL-QBjB2zGi0mcoV840JDmkI`

| Sheet | Used? | DB Table(s) | Records | Notes |
|---|---|---|---|---|
| Editorial SOW overview | YES | `clients` | 77 | Contract/SOW data — status, dates, cadence, articles, milestones |
| Delivered vs Invoiced v2 | YES | `deliverables_monthly` | 394 | Monthly delivery/invoicing tracker per client |
| ET CP 2026 [V11 Mar 2026] | YES | `team_members`, `capacity_projections` | 12 + 65 | Capacity plan — pod assignments and monthly projections |
| Model Assumptions | YES | `model_assumptions` | 14 | Planning parameters — categorization, ramp-up, capacity targets |
| Editorial Operating Model | YES | `production_history` | 3,816 | Historical production per client (Oct 2022 — Feb 2027) |
| Delivery Schedules | YES | `delivery_templates` | 60 | SOW delivery templates by size (240, 220, 180, 120, 125) |
| Editorial Engagement Requirements | YES | `engagement_rules` | 10 | The 10 Commandments for editorial engagement |
| Meta Calendar Month Deliveries | YES | `deliverables_monthly` | 36 | Meta client (BMG, Manus, RL, AI) monthly actuals |

---

## Spreadsheet 2: Master Tracker

**ID:** `1dtZIiTKPEkhc0qrlWdlvd-n8qAn5-lhVcPkgHNgoLAY`

| Sheet | Used? | DB Table | Records | Notes |
|---|---|---|---|---|
| Cumulative | YES | `cumulative_metrics` | 42 | All-time pipeline metrics per client — topics, CBs, articles, published |
| [Month Year] Goals vs Delivery (x9) | YES | `goals_vs_delivery` | 389 | Weekly CB/article delivery tracking per month (Aug 2025 — Apr 2026) |
| v2 Editorial SOW & Engagement info | NO | — | — | Overlaps with Spreadsheet 1 "Editorial SOW overview" (v2 has newer clients but same structure) |
| v2 Article delivery schedule | NO | — | — | Overlaps with Spreadsheet 1 "Editorial Operating Model" |
| Delivered vs Invoiced | NO | — | — | Overlaps with Spreadsheet 1 "Delivered vs Invoiced v2" |
| Editorial Engagement Requirements | NO | — | — | Same as Spreadsheet 1 |
| Notion Database | NOT YET | — | 13,232 | Article workflow tracking from Notion export — could feed Turnaround Time + Revision Rate KPIs in future |
| Monthly Cumulative 2025 | NO | — | — | Month-by-month breakdown (Cumulative sheet is sufficient for all-time view) |
| Automated Cumulative | NO | — | — | Older automated version of Cumulative |
| Client Comparison | NO | — | — | Old vs New client tracking metadata |
| Pivot / Metrics 2025 / New Pivot | NO | — | — | Summary/analytics sheets built from other data |
| Monthly sheets (Jan 2024 — May 2025) | NO | — | — | Historical raw monthly data (covered by Goals vs Delivery) |
| 2025/2026 Week Distribution | NO | — | — | Week numbering reference |
| Cover | NO | — | — | Title page |
| New Automated Formulas | NO | — | — | Formula helper sheet |
| Product Report Pivot Table | NO | — | — | Pivot table |
| Cumulative 2025 | NO | — | — | 2025-only cumulative (full Cumulative is better) |
| [Month] Deliverables database | NO | — | — | Monthly deliverables database |

**Decision notes:**
- The v2 SOW and v2 Article delivery sheets have newer data but the same structure as Spreadsheet 1. We keep Spreadsheet 1 as the primary source to avoid duplicating imports. If the team wants to switch, we can point the import function at the Master Tracker version.
- The Notion Database (13K+ rows) is the richest potential data source for Article Turnaround Time and Revision Rate KPIs. It tracks workflow statuses, assignments, dates, and editors. Integration is deferred for a future sprint.

---

## Spreadsheet 3: Writer AI Monitoring

**ID:** `13kl0_6YuzsJ3xEzNLzDZeR-sHMaNJNw6oJGmwb-CBOU`

| Sheet | Used? | DB Table | Records | Notes |
|---|---|---|---|---|
| Data | YES | `ai_monitoring_records` | 1,168 | Condensed from Pod 1-5: AI scan results per article |
| Rewrites | YES | `ai_monitoring_records` (is_rewrite=True) | 11 | Rewritten articles (flagged and reprocessed) |
| Yellow/Red Flags_v2 | YES | `ai_monitoring_records` (is_flagged=True) | 169 | Articles with PARTIAL PASS or REVIEW/REWRITE |
| Surfer's API usage | YES | `surfer_api_usage` | 25 | Monthly Surfer AI detector API call tracking per pod |
| Condition | NO (reference) | — | — | Threshold definitions: v1 > 50% = REVIEW/REWRITE, v2 > 80% = REVIEW/REWRITE, v2 > 30% = PARTIAL PASS |
| Dashboard | NO | — | — | Empty sheet, just contains chart title |
| Pod 1 | NO | — | 212 | Individual pod data (Data sheet is the condensed version) |
| Pod 2 | NO | — | 638 | Individual pod data |
| Pod 3 | NO | — | 640 | Individual pod data |
| Pod 4 | NO | — | 639 | Individual pod data |
| Pod 5 | NO | — | 640 | Individual pod data |
| All_Pods | NO | — | — | Combined pod data (Data sheet is equivalent) |
| test_data | NO | — | — | Test data |
| Pivots 1/16 | NO | — | — | Pivot table |
| [Outdated] Surfer's API usage | NO | — | — | Outdated version |

**AI Detection Thresholds** (from Condition sheet):
- `surfer-ai-detector-v1 > 50%` → REVIEW/REWRITE
- `surfer-ai-detector-v2 > 80%` → REVIEW/REWRITE
- `surfer-ai-detector-v2 > 30%` → PARTIAL PASS
- Below thresholds → FULL PASS

**Key Statistics** (as of March 2026):
- Total articles scanned: 1,168
- Full Pass: 997 (85.4%)
- Partial Pass: 152 (13.0%)
- Review/Rewrite: 17 (1.5%)
- Pass rate (action): 1,130 Pass / 16 Send back

---

## Summary

| Source | Sheets Used | Sheets Skipped | Total Records |
|---|---|---|---|
| Editorial Capacity Planning | 8 | 0 | 4,467 |
| Master Tracker | 2 (10 sheet tabs) | 16+ | 431 |
| Writer AI Monitoring | 4 | 12 | 1,373 |
| **Total** | **14** | **28+** | **6,271** |
