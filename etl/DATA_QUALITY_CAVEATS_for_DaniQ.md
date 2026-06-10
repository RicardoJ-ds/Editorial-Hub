# Editorial data — what we cleaned, what we need you to decide

_For Daniela · 2026-06-10 · from Ricardo's Editorial Hub work_

**What this is.** We are moving all the editorial spreadsheet data into one clean,
central database (BigQuery) so every dashboard reads the same numbers. Along the
way we standardized people and client names and catalogued every data problem we
found. This doc shows **what changed (before → after)** and lists **the few
decisions only the team can make**. Everything else is already handled.

**Words used below** (only the unavoidable ones):
- **Article log** = the "[Internal] Monthly Article Count" sheet (one tab per client).
- **Capacity sheet** = the "ET CP" Editorial Team Capacity Planning sheet.
- **Salesforce name** = the official client name in Salesforce, our system of record.
- **Hub** = the Editorial Hub dashboard app.

---

## 1 — Decisions we need from you 🟧

### D1. Two editors share a first name — who gets the credit?
The article log only records first names. Two cases can't be auto-resolved:

| Name in log | Articles | Candidates | Our proposal |
|---|---:|---|---|
| **Lauren** | 141 | Lauren Friar / Lauren Keleher (both active) | none — needs a rule from you (by client or pod?) |
| **Sam** | 142 | Samantha Marceau / Samantha McGrail | Marceau for articles after Feb 2026 (McGrail left 2026-01-27); earlier ones need your call |

### D2. Four 2022-era editor names match nobody
**Kristin** (212 articles), **Shalin** (140), **Kira** (109), **Shain** (1 — likely a
Shalin typo). They appear in no HR record, no pod sheet, nothing — they predate
every people source we have. If anyone remembers their full names, we'll map
them; otherwise they stay as-is, clearly labeled "unknown 2022 editor."

### D3. Garbage values in the editor column — OK to drop?
`^`, `^^`, `AND`, `83`, `no edits` appear as "editors" on 7 rows total. We plan
to drop them from editor counts (the articles still count for the client).

### D4. Client names that need a human call

| Hub name | Question | Our proposal |
|---|---|---|
| ChatGPT | Salesforce has **OpenAI** — same account? | map to OpenAI |
| Engine | Salesforce has **Hotel Engine** | map to Hotel Engine |
| Landing | Salesforce has **Hello Landing** | map to Hello Landing |
| EarnIn B2C + Earnin B2B | one Salesforce account (**EarnIn**) — keep the split in our reports? | keep split, both link to EarnIn |
| Orderful (I) + (II) | engagement phases, one account | keep split, both link to Orderful |
| Workleap + Sharegate | combined deal; ShareGate has no Salesforce account | link to Workleap |
| Tempo XYZ | Salesforce has BOTH **Tempo** and **Tempo.io** | which one? |
| Meta Manus | no Salesforce account exists | create one, or leave unlinked? |
| First Round Capital / Lenny / Neeva | never in Salesforce (Neeva defunct) | leave unlinked, marked "no Salesforce account" |

### D5. 20 article-log tabs belong to no Hub client (≈3,400 articles)
These clients were never added to the Hub's client list (SOW Overview), so their
articles are counted nowhere. Most exist in Salesforce — they're real clients,
just missing from the Hub. **Decide per client: add to the Hub, or mark
out-of-scope** (e.g. ended before tracking started).

| Tab | Articles | In Salesforce? |
|---|---:|---|
| Mirage | 759 | no |
| Curology | 370 | yes |
| Worldcoin | 333 | yes |
| Flip | 307 | close — "FlipFit" |
| EarnIn | 267 | yes — also: which Hub variant, B2C or B2B? |
| Jaanuu | 248 | yes |
| Little Passports | 159 | yes |
| Gopuff | 152 | yes — "Go Puff" |
| Bergdorf | 134 | no |
| Mailjet | 128 | no |
| Email On Acid | 112 | no |
| Mailgun | 107 | close — "Pathwire/Mailgun" |
| Shift | 87 | yes |
| Dynamite | 58 | yes |
| ESGgo | 34 | no |
| Descript | 31 | yes |
| OpenSea | 15 | yes |
| Cadre | 6 | yes |
| Athena2 | 145 | "Athena" — second engagement? |
| Credit Karma | 1 | yes |

(Another 7 tabs we already mapped with confidence — see section 3. One, Workleap,
is live in the Hub already.)

### D6. Whole clients missing from the article log
- **Meta AI / Meta BMG**: no tabs at all, yet the Operating Model claims 18 and
  15 delivered articles as "actual" — **nothing corroborates those numbers**.
- **College HUNKS**: 37 articles all-time in the log vs ~29/month expected.
- **Eventbrite**: tab stops in February.
Someone on the team needs to backfill these rows (we can't invent them).

### D7. Pick ONE month definition (the biggest analytical decision)
"May" means three different things across our sheets, so per-month counts look
~⅓ lower in the article log than in the Operating Model. Worked example —
**Miter, May 2026**: article log "May" (editorial month, starts ~the 6th) = 11
articles · calendar May = 25 · Operating Model "May" = 28 · Goals-vs-Delivery =
28. None of these are wrong — they count different windows. **Decision needed:
which month basis do we standardize comparisons on?** Our proposal: keep the
editorial month for editor workload (capacity), and the Operating Model month
for client delivery — but never mix the two in one chart, and label each.

### D8. Writers we couldn't fully name
The writer column is also first-names-only. We matched most (section 3), but:
- **122 first-name-only writers** (4,262 articles, mostly 2022–2024) exist in no
  roster we have — they stay as first names, labeled "legacy writer". Top:
  Emile (413), Dana (289), Chantel (234), Gabryel (221), Mark (221), Samaara (199).
  If old rosters exist anywhere, we can finish the job.
- **Dan / Dani / Daniel / Daniela** (37 articles) — could be Daniela Quiroga,
  Daniela Rial, or Danielle MacKinlay. Who?
- Small tail of unresolved one-offs (86 articles), incl. "John T" (24),
  "crowd content" (23), "Austin DeNoce" (10).

---

## 2 — Decided & shipped this week 🟦 (FYI, no action needed)

1. **Capacity sheet "shared slot" bug fixed.** Cells like
   "Maggie Gowland (14) Anabelle Zaluski (10)" were counted as ONE person with
   capacity 10. They now split into two people (14 + 10). Per-editor capacity
   for the affected months is now correct.
2. **Capacity sheet typos mapped**: "Kennedy Sievers" → Kennedy Stevens,
   "ROBERT THORPE" → Robert Thorpe; annotations like "(temp)", "(net-new)",
   "(backfill)" are stripped before matching. Slot placeholders ("new hire",
   "support from Pod 1") are labeled as placeholders, not people.
3. **The Maggie & Tiffany "status mystery" is solved** — HR says TERMINATED,
   capacity says active. Both are right: Maggie Gowland left 2026-06-03 and
   Tiffany Anderson left 2026-05-07, so they really were active in the months
   the capacity sheet staffs them.
4. **"Mike" identified**: Michael Doyle, an editor employed Mar–May 2023 —
   exactly the months his 55 articles appear.
5. **Writer name cleanup applied**: 78 first-name variants now map to full
   names (10,281 articles, ~70% of all writer rows) — see section 3. This is
   live in the Hub's Data Quality screen and reversible.
6. **Editor typos merged**: Derriik→Derrik Chinn, Magggie/Magie/MAGGIE/maggie→
   Maggie Gowland, NIcholas→Nicholas Youngblood, etc.
7. **Everything lands in BigQuery now.** All dashboard data + these mappings
   are published to central tables (`editorial_*`), with an automated proof that
   the dashboard numbers are EXACTLY the same as today's (see
   `PARITY_REPORT.md` — every table and every chart-feeding number matched).

**Still on the engineering list** (known, not yet shipped):
- 471 articles have dates we can't read (Vimeo 186, Webflow 118, Go Puff 27,
  ~140 across other tabs — the date column says e.g. "12/17" with no year and
  the article-file column that would tell us the year is empty). Parser fix planned.
- The whole **Felt** tab (96 rows) is skipped — its header row is laid out
  differently. Fix planned.
- Jumbo articles count as 1 (should weigh ×2) and landing pages as 1 (should
  weigh ×0.5) in the article log — there's no content-type column; we'll read
  the `[jumbo]` / `(LP)` tags in titles (~91 rows have markers).
- Per-editor utilization splits each pod's verified output by article share.
  This assumes under-logging is roughly even across a pod's editors —
  reasonable, but unproven. The better the log (D5, D6), the better the split.

---

## 3 — Name mappings: before → after

### 3a. Editors (article log → HR full name) — applied
32 of 43 log names mapped, covering **94.9%** of 14,789 article rows.

| Before (log) | After (HR name) | Note |
|---|---|---|
| Alyssa | Alyssa Zacharias | |
| Bryan | Bryan Clark | |
| Chrissy | Chrissy Woods | |
| Elliot | Elliot Gardner | |
| Haley | Haley Drucker | |
| Jimmy | Jimmy Bunes | |
| Kennedy | Kennedy Stevens | |
| Lee | Lee Anderson | |
| Nina | Nina Denison | |
| Robert | Robert Thorpe | |
| Shivani | Shivani Verma | |
| Mike | Michael Doyle | editor Mar–May 2023 |
| Abby | Abby Norwood | former |
| Anabelle | Anabelle Zaluski | former |
| Chelsea | Chelsea Erhard | former |
| Derrik / Derriik | Derrik Chinn | former; typo merged |
| Eesha | Eesha Verma | former |
| Jared | Jared Maguire | former |
| Katie | Katie Shevlin | former |
| Kimberly | Kimberly Pavlovich | former |
| Maggie / MAGGIE / Magggie / Magie / maggie | Maggie Gowland | left 2026-06-03 |
| Micki | Micki Cottam | former |
| Nicholas / NIcholas | Nicholas Youngblood | former |
| Shelby | Shelby Talbot | former |
| Tiffany | Tiffany Anderson | left 2026-05-07 |
| Vince | Vincent Lee | former |
| Lauren · Sam · Kira · Kristin · Shain/Shalin | **pending — see D1/D2** | |
| ^ · ^^ · AND · 83 · no edits | **drop — see D3** | |

### 3b. Writers (article log → full name) — applied, top 25 by volume
78 renames applied (10,281 articles). Full list lives in the Hub's Data
Quality → Article mappings screen and in `mappings/writer_aliases.json`.

| Before | After | Articles |
|---|---|---:|
| Eric | Eric Esposito | 1,346 |
| Kimberly | Kimberly Kruge | 1,245 |
| Chelsea | Chelsea Oliver | 864 |
| Aranyak | Aranyak Nanda | 751 |
| Camille | Camille Tovee | 691 |
| Kevin | Kevin Vaughn | 664 |
| Ashton | Ashton Playsted | 472 |
| Abby | Abby Norwood | 370 |
| Rob | Rob Harper | 363 |
| Adaeze | Adaeze Nwakaeze | 245 |
| Rich | Rich Dezso | 241 |
| Rocco | Rocco Pendola | 211 |
| Jimmy | Jimmy Bunes | 198 |
| Sarah | Sarah Foley | 164 |
| Danielle | Danielle MacKinlay | 152 |
| Meredith | Meredith Kane | 146 |
| Sam | Samantha McGrail | 145 |
| Robert | Robert Thorpe | 135 |
| Jack | Jack Limebear | 123 |
| Pat | Patrick Sather | 122 |
| Telisa | Telisa Faye | 110 |
| Jacob | Jacob McPhail | 109 |
| Sara | Sarah Foley | 109 |
| Alex | Alex Shoemaker | 108 |
| Kev | Kevin Vaughn | 98 |

(Note: the writer "Kimberly" is Kimberly **Kruge** — a different person from the
editor Kimberly **Pavlovich**.)

### 3c. Clients (Hub name → Salesforce name)
71 of 84 Hub clients link to Salesforce automatically. 13 of those differ only
in spelling — now standardized:

| Hub name (before) | Salesforce name (after) |
|---|---|
| BetterUp | Betterup |
| Dr Squatch | Dr. Squatch |
| Fishbowl | Fishbowl Inventory |
| GenstoreAI | Genstore |
| Glossgenius | GlossGenius |
| Grindr | Grindr LLC |
| Honeybook | HoneyBook |
| IronVest | Ironvest |
| **Meta BMG** | **Meta for Business** (auto-match had wrongly said "Meta AI") |
| **Meta RL** | **Meta Reality Labs** (same wrong auto-match, corrected) |
| Photoroom | PhotoRoom |
| TaskRabbit | TaskRabbit Inc |
| ThredUp | Thred Up |

The remaining 13 need your call — see D4.

### 3d. Article-log tabs we mapped to existing Hub clients — proposed
| Tab (before) | Hub client (after) | Why |
|---|---|---|
| Men's Warehouse | Men's Wearhouse | tab is misspelled |
| Neiman | Neiman Marcus | shorthand |
| Orderful | Orderful (I) | phase-1 tab |
| Orderful 2 | Orderful (II) | phase-2 tab |
| ShareGate | Workleap + Sharegate | combined engagement |
| Genstore | GenstoreAI | same client |
| FRC | First Round Capital | acronym |
| Workleap | Workleap + Sharegate | ✅ already applied in the Hub |

---

## 4 — Numbers appendix (so every figure reconciles)

- **471** articles with unreadable dates → invisible in monthly views
  (Vimeo 186, Webflow 118, Go Puff 27, ~140 spread across other tabs).
- **96** Felt rows skipped (header layout).
- **~91** rows carry `^` markers (mostly Webflow 36, CoinTracker 30) — some mark
  linked articles/jumbos, some are blank separators; negligible for counts.
- **May 2026 total**: Operating Model 364 vs article log 130 — the gap is mostly
  the month-definition difference (D7) plus the missing tabs/rows (D5, D6),
  NOT lost data.
- Mapping coverage after this week: **editors 94.9%** of article rows mapped to
  a real person · **writers 70%** full-named + 29% legacy first-name-only ·
  **clients 71/84** Salesforce-linked.

---

## 5 — Where to review / change any of this

- **Hub → Admin → Data Quality → Article mappings**: every editor/writer/client
  mapping is visible there; you can add or fix one in two clicks, and the next
  sync applies it everywhere automatically.
- The same lists live in BigQuery (`editorial_map_editors`, `editorial_map_writers`,
  `editorial_map_clients`) for any analysis.
- Engineering reference (how the pipeline works, full inventory):
  `etl/README.md`, `etl/ETL_INVENTORY.md`, `etl/NAME_MAPPINGS.md`,
  `etl/PARITY_REPORT.md`.
