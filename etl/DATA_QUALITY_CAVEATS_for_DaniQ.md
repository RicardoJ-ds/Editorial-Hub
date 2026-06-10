# Editorial data clean-up — your sign-offs

_For Daniela · 2026-06-10 · from Ricardo_

We moved all the editorial spreadsheets into one clean central database and
standardized people + client names. **The data is sound** — for every closed
month, the article log already matches the Operating Model exactly (proof in
§C). What's left is a short list of confirmations only you can give, because you
built the source sheets.

**How to use this doc:** Section A = the decisions, each with the **exact place
to look**. Section B = the mapping tables to approve (open the CSV, tick or
fix). Section C = why recent-month counts look low. Section D = already fixed.

**Everything to review is an openable file in `etl/reports/`** (drop into Google
Sheets):
`mappings_editors.csv` · `mappings_writers.csv` · `mappings_clients.csv` ·
`unmapped_client_tabs.csv` · `month_basis_by_client.csv` · `caret_rows.csv`.
The same lists are also live in the Hub → **Admin → Data Quality → Article
mappings** (fix one there and the next sync applies it everywhere).

---

## A. Decisions — at a glance

| # | What we need you to confirm | Where to look | Our proposal |
|---|---|---|---|
| **1** | **"Lauren"** = Lauren Friar or Lauren Keleher? (141 articles, both active) | Monthly Article Count → **EDITOR** column. Tell us a rule (e.g. by client or pod). | a split rule from you |
| **2** | **"Sam"** before Feb 2026 = Marceau or McGrail? | EDITOR column. McGrail left **2026-01-27**, so after that it's Marceau. | Marceau after Feb 2026; you confirm earlier |
| **3** | **4 unknown 2022 editors**: Kristin (212), Shalin (140), Kira (109), Shain (1) | EDITOR column in tabs **Gopuff, Mailjet, Descript** (Kristin) · **Practice, Linktree, Dynamite** (Shalin) · **Practice, Email On Acid** (Kira). Not in HR. | name them, or leave as "legacy 2022 editor" |
| **4** | **Caret rows** (`^`, `^^`, `^^^`) — what do they mean? | COPY column in tabs **Fishbowl** (rows ~226–244) & **Otter** (rows ~111–125). See `caret_rows.csv`. **Detail below.** | confirm meaning → §A-detail |
| **5** | **13 client → Salesforce** name calls (ChatGPT→OpenAI? Tempo XYZ? splits) | `mappings_clients.csv` + the Salesforce account list. | per-row proposal in the CSV |
| **6** | **20 ex-client tabs not in the Hub** — add or leave out? | `unmapped_client_tabs.csv` (we added each one's **years**). **Detail below.** | most ended 2021–23 → out of scope; add the active ones |
| **7** | **Pick ONE "month" definition** for cross-sheet comparison | §C below + `month_basis_by_client.csv`. | editorial month for editor workload, Operating Model month for client delivery — never mixed in one chart |
| **8** | **Approve writer names** (78 auto-mapped) + help name 122 legacy first-names | `mappings_writers.csv` → WRITER column. **Detail in §B.** | approve the 78; you/team fill the legacy |

### A-detail · #4 Caret rows (`^` / `^^` / `^^^`)
In the **COPY column**, the first part of each entry is normally a document
number (224, 225, 227…). On a few rows it's a caret instead. Looking at the
actual rows (open `caret_rows.csv`), each caret row already has its **own
distinct title and word count** — e.g. Fishbowl row 227 "warehouse logistics",
row 228 "lead time" — so they are **separate real articles, not duplicates**.
The caret seems to mean *"same source document as the row above"* (linked
sub-articles), and several already carry an `(LP)` tag in the title.

**So "copy the row above into the caret row" would overwrite real, different
articles — we don't recommend that.** Our read: the carets are a *linking*
marker, not a "count twice" marker; the rows are already counted once each
(correct). The separate question — *should jumbos count ×2 and landing pages
×0.5?* — we'll handle from the `[jumbo]` / `(LP)` tags in the title, which is
reliable. **Please confirm what `^`/`^^`/`^^^` mean in your sheet** so we lock
the rule; it's only ~16 rows, so impact is tiny either way.

### A-detail · #6 Ex-client tabs (with years)
These 20 tabs have articles in the log but no Hub client, so their work is
counted nowhere. We added each one's **article date span** and its **Salesforce
contract years** — and the pattern is clear: **most are old engagements that
ended in 2021–2023, before the current SOW Overview**, so leaving them out is
reasonable. A few are recent and worth adding.

| Tab | Articles | Article span | Salesforce contract | Likely call |
|---|---:|---|---|---|
| Mirage | 759 | 2023-10 → 2025-12 | not in Salesforce | **recent & large — review** |
| Curology | 370 | 2022-01 → 2023-02 | 2022–2023 | out of scope (ended) |
| Worldcoin | 333 | 2022-07 → 2023-02 | 2022–2023 | out of scope (ended) |
| Flip | 307 | 2022-06 → 2022-12 | FlipFit 2022 | out of scope (ended) |
| EarnIn | 267 | 2023-07 → 2025-04 | 2023–2025 | map to EarnIn (see #5) |
| Jaanuu | 248 | 2021-12 → 2022-09 | 2021 | out of scope (ended) |
| Little Passports | 159 | 2022-02 → 2023-03 | 2022–2023 | out of scope (ended) |
| Gopuff | 152 | 2022-03 → 2022-08 | — | out of scope (ended) |
| Bergdorf | 134 | 2022-… | not in Salesforce | out of scope (ended) |
| Mailjet / Email On Acid / ESGgo | 128 / 112 / 34 | 2022–23 | not in Salesforce | out of scope (ended) |
| Mailgun | 107 | 2022 | Pathwire/Mailgun 2022–23 | out of scope (ended) |
| Shift / Dynamite / OpenSea / Cadre | 87 / 58 / 15 / 6 | 2021–23 | ended 2021–23 | out of scope (ended) |
| Descript | 31 | 2021–24 | 2021–2024 | out of scope (ended) |
| **Credit Karma** | 1 | recent | **active through 2026** | **add to Hub** |
| Athena2 | 145 | — | "Athena" 2024–25 | second Athena engagement? |

Full list with every column in `unmapped_client_tabs.csv`. (Plus 7 tabs we
already mapped with confidence — see §B clients.)

---

## B. Mapping tables to approve

Each is a CSV you can open and tick/correct. Status meanings: **confirmed** =
applied · **proposed** = our best guess, needs your OK · **ambiguous /
unresolved** = needs your call.

### B1 · Editors — `mappings_editors.csv`
First names in the log → full HR names. **32 of 43 done, covering 95% of all
14,807 article rows.** Open question rows are #1–3 above. Columns include
**where_to_validate** (the exact tabs each name appears in).

### B2 · Writers — `mappings_writers.csv`
The writer column is also first-names-only. **78 names auto-mapped to full
names** (covering **10,470 of 14,776 writer rows ≈ 71%**); distinct writer names
dropped 244 → 208. Please skim and approve. Two things need you:
- **The "Dan" cluster** (≈37 rows): Dan / Dani / Daniel / Daniela →
  Daniela Quiroga, Daniela Rial, or Danielle MacKinlay? (tabs: Better,
  EarnIn B2B, Engine, Ellis, Moss…)
- **122 legacy first-name-only writers** (4,306 rows, mostly 2022–24) match no
  current roster — kept as first names. Top: Emile (413, tabs Notion/Email On
  Acid/Mailgun), Dana (289), Chantel (234), Gabryel (221), Mark (221). If old
  rosters exist, we can finish these.

### B3 · Clients — `mappings_clients.csv`
**71 of 84 Hub clients link to Salesforce automatically** (13 were just spelling
fixes — incl. the corrected `Meta BMG → Meta for Business`,
`Meta RL → Meta Reality Labs`). The **13 needing your call** (#5):

| Hub name | Question | Proposal |
|---|---|---|
| ChatGPT | Salesforce has **OpenAI** | map to OpenAI |
| Engine | Salesforce has **Hotel Engine** | map to Hotel Engine |
| Landing | Salesforce has **Hello Landing** | map to Hello Landing |
| EarnIn B2C + Earnin B2B | one account (EarnIn) — keep split in reports? | keep split, both → EarnIn |
| Orderful (I) + (II) | phases, one account | keep split, both → Orderful |
| Workleap + Sharegate | combined; ShareGate has no Salesforce account | → Workleap |
| Tempo XYZ | Salesforce has BOTH Tempo and Tempo.io | which one? |
| Meta Manus | no Salesforce account | create one, or leave unlinked? |
| First Round Capital / Lenny / Neeva | never in Salesforce (Neeva defunct) | leave unlinked |

Article-tabs we already mapped (proposed, in `mappings_clients.csv`):
Men's Warehouse→Men's Wearhouse, Neiman→Neiman Marcus, Orderful→Orderful (I),
Orderful 2→Orderful (II), ShareGate→Workleap + Sharegate, Genstore→GenstoreAI,
FRC→First Round Capital.

---

## C. Why recent-month counts look low (decision #7)

Short version: **nothing is missing for closed months.** "May" just means three
different windows across our sheets:
- **Article log** buckets by the *editorial* month (weeks starting ~the 6th).
- **Operating Model / Goals** bucket by the *delivered / calendar* month.

**The proof** — for the 72 client-months that closed in 2026 (Jan–Apr), the
editorial-month log **equals** the Operating Model actual **exactly in 50 of
them**, and none are empty. The apparent gap is entirely in the **current
month** (May: 0 exact — the sheet just isn't filled in yet) plus a few clients
genuinely not logged (§D).

**Worked example — Miter (your go-to):**

| Month | Operating Model | Log (editorial month) | Log (calendar month) |
|---|---:|---:|---:|
| Jan | 5 | **5** | 4 |
| Feb | 15 | **15** | 11 |
| Mar | 15 | **15** | 20 |
| Apr | 25 | **25** | 11 |
| May (open) | 28 | 11 | 25 |

Editorial-month and Operating Model agree perfectly for the closed months; only
the in-progress May differs (and there the *calendar* count, 25, is already near
28). **Whole-portfolio 2026:**

| Month | Operating Model | Log (editorial) | Log (calendar) |
|---|---:|---:|---:|
| Jan | 274 | 201 | 147 |
| Feb | 294 | 224 | 213 |
| Mar | 324 | 252 | 317 |
| Apr | 339 | 259 | 185 |
| May (open) | 364 | 123 | 197 |

The full per-client × per-month breakdown — with all three counts and a verdict
(`exact_match` / `close` / `month_boundary` / `missing_from_log`) — is in
**`month_basis_by_client.csv`**.

**Decision:** which basis do we standardize on? Our proposal: editorial month
for editor workload (capacity), Operating Model month for client delivery, and
never blend the two in one chart.

---

## D. Already fixed (FYI, no action)

- **Capacity "shared slot" bug**: cells like "Maggie Gowland (14) Anabelle
  Zaluski (10)" were counted as one person — now split into two. Per-editor
  capacity is correct.
- **Maggie & Tiffany "active vs terminated" mystery** solved — both left
  recently (2026-06-03 / 2026-05-07), so they really were active in the staffed
  months. **"Mike" = Michael Doyle** (editor Mar–May 2023).
- **Names standardized**: editor + writer typos merged (Derriik→Derrik,
  Magggie→Maggie, NIcholas→Nicholas…); 78 writer renames live.
- **All data now in BigQuery** with an automated proof it matches today's
  dashboards exactly (`PARITY_REPORT.md`).

**Genuinely missing (needs the team to backfill rows):**
- **Meta AI / Meta BMG / Meta RL** — the Operating Model claims 78 / 20 / 33
  "actual" articles but there are **no article-log tabs at all**, so nothing
  corroborates those numbers.
- **Eventbrite** — logged Jan & Feb (matches exactly: 4=4, 5=5), then stops; the
  Operating Model shows more after.

**Still on engineering's list:**
- 471 articles have unreadable dates (Vimeo 186, Webflow 118, Go Puff 27, ~140
  others — the date is e.g. "12/17" with no year and the doc column is empty).
- The whole **Felt** tab (96 rows) is skipped — its header is laid out
  differently.
- Jumbo (×2) / landing-page (×0.5) weighting — we'll read the `[jumbo]` / `(LP)`
  title tags (see #4).

---

### Where to do the actual editing
Hub → **Admin → Data Quality → Article mappings** has every editor / writer /
client mapping; fix one there and the next sync applies it everywhere. Or mark
up the CSVs and send them back — we'll load them.
