# How capacity utilization is calculated

_For Daniela · 2026-06-10 · from Ricardo_

This explains the new **Capacity** view in the Hub (Team KPIs → Capacity): what
each number means, the decisions behind it, and a worked example with real
numbers. It's built entirely from sheets you already own — nothing is invented.

---

## The three ingredients (and where each comes from)

| Ingredient | Plain meaning | Source (your sheet) |
|---|---|---|
| **Capacity** | How many articles an editor *can* handle in the month | **ET CP** — each editor's monthly capacity |
| **Planned** | How many articles the pod was *expected* to deliver | **Operating Model** — the projected column |
| **Delivered** | How many the pod *actually* delivered | **Operating Model** — the actual column |
| **Articles per editor** | Who wrote what | **Monthly Article Count** log |

Pod capacity = the sum of its editors' capacities. Planned and Delivered are
taken at the **pod** level from the Operating Model (your numbers), not summed
from the article log.

---

## The one key decision: articles are a *share*, not a count

The Monthly Article Count log under-counts (missing client tabs, month-boundary
differences — all covered in the data-quality report). So we deliberately **do
not** use raw article counts as someone's workload.

Instead, the article log only decides **each editor's *share*** of the pod's
work, and that share is applied to the pod's **authoritative delivered total**
from your Operating Model. In short:

> The Operating Model says how much the pod delivered. The article log says how
> to split that among the pod's editors.

This way the per-editor numbers stay anchored to your real, trusted pod totals,
even while the article log is still being cleaned up. (The only assumption: that
under-logging is roughly even across a pod's editors — reasonable, and it gets
sharper as the log and the editor-name matching improve.)

---

## The formulas (plain language)

For one editor, in one month:

- **% Allocation** = editor capacity ÷ pod capacity
  → *their share of the pod's planned capacity*
- **% Distribution** = editor's articles ÷ pod's articles
  → *their share of the pod's delivered work*
- **Planned (for the editor)** = % Allocation × pod **Planned**
- **Delivered (for the editor)** = % Distribution × pod **Delivered**
- **% Util Real** = editor Delivered ÷ editor capacity
  → *how full they were vs their maximum*
- **% Util Weighted** = editor Delivered ÷ editor Planned
  → *did they deliver above or below their planned share*

Two utilization numbers because they answer two different questions: **Real** =
"how busy was this person?", **Weighted** = "did they hit their plan?" (over
100% = delivered more than planned).

---

## Worked example — Editorial Pod 1, May 2026

Pod totals (from ET CP + Operating Model): **capacity 126**, **planned 99**,
**delivered 98**, **45 articles** logged.

| Editor | Capacity | % Alloc | Articles | % Distribution | Planned | Delivered | % Util Real | % Util Wtd |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| Jimmy Bunes | 46 | 36.5% | 20 | 44.4% | 36.1 | 43.6 | **94.7%** | **120.5%** |
| Robert Thorpe | 60 | 47.6% | 20 | 44.4% | 47.1 | 43.6 | **72.6%** | **92.4%** |
| Nina Denison | 20 | 15.9% | 5 | 11.1% | 15.7 | 10.9 | **54.4%** | **69.3%** |

Reading Jimmy's row:

- His capacity is **46** of the pod's 126 → **% Allocation = 36.5%**.
- He has **20** of the pod's 45 articles → **% Distribution = 44.4%**.
- The pod delivered **98**, so his slice = 44.4% × 98 = **43.6**.
- His plan = 36.5% × 99 = **36.1**.
- **% Util Real** = 43.6 ÷ 46 = **94.7%** → he was nearly fully used.
- **% Util Weighted** = 43.6 ÷ 36.1 = **120.5%** → he delivered ~20% more than
  his planned share (he carried a bit more than his capacity implied).

---

## Specialized clients (×1.4)

Specialized clients are heavier, so — matching your ET CP convention — they
count as **1.4 articles' worth of effort** in the pod-level *weighted*
utilization shown for reference. The per-editor split above uses the plain
(unweighted) pod totals, so a person's number isn't distorted by which clients
happened to be specialized.

---

## What's solid vs what still depends on your input

- **Solid:** the pod-level numbers (capacity, planned, delivered, utilization) —
  they come straight from ET CP + the Operating Model.
- **Improves with your decisions:** the *per-editor* split depends on matching
  log first-names to real editors. Editors we can't match yet (e.g. an
  ambiguous "Lauren" / "Sam", or a name with no match) show **0 articles** until
  confirmed — see the name-mapping tables in the data-quality report. Confirming
  those sharpens the per-person numbers.

---

## Where to see it

Hub → **Team KPIs → Capacity**:
- **At a glance** — pod-wide planned vs delivered utilization for the month.
- **By Pod** — each pod's capacity, planned, delivered, and status.
- **By Editor** — the per-editor table (the worked example above).
- **By Client** — what each client contributes to its pod (with the ×1.4).
- **Trend** — utilization month by month, by pod or by editor.

All of it follows the pod + period filters at the top of the page.
