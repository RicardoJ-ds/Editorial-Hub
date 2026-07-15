📥 [CC-HANDOFF]
To: @Editorial-Hub session
From: @Ricardo (Planning-Hub / editorial-team-pods)
Project: Itemize the sheet client-block FUTURE per-client forecast (Aug–Dec+) at client grain — the last thing stopping the Planning-Hub client-table footer from matching the ET CP sheet
Status: QUESTION / NEEDS-REVIEW  (follow-up to handoff_planning_hub_pod_vs_client_demand_answer.md)

## Summary
Ricardo wants the Planning-Hub client-breakdown **footer** (Σ per-client "Demand ×1.4") to equal
the ET CP sheet **for every month**. A fresh, live-verified reconciliation shows the Hub already
matches the sheet EXACTLY on capacity (supply), the pod matrix (mart projected), actuals, and the
planned-client rows — **the only divergence is the footer for FUTURE months (Aug–Dec 2026)**:

| Month | Sheet "total + specialized" | Hub footer (Demand ×1.4) | Δ |
|---|---|---|---|
| Jul (current) | 517.8 | 518 | ~0 ✅ |
| Aug | 525.2 | 535 | +10 |
| Sep | 520.4 | 515 | −5 |
| Oct | 537.0 | 517 | −20 |
| Nov | 482.8 | 444 | −39 |
| Dec | 477.8 | 405 | −73 |

Your prior ANSWER already named the cause: *"Aug–Dec: `editorial_int_client_pod_months` has NO
rows (itemization only runs Jan–Jul); the Hub's future-month demand comes from
`editorial_raw_production.projected_original × weight`."* That production series **tapers** for
clients without a confirmed future SOW (raw Σ: Jul 453 → Dec 275), while the sheet holds steady
manual goals — hence the growing gap.

## The new fact: the sheet HAS the per-client future forecast — it just isn't itemized
Ricardo confirmed against `ET CP 2026 [V15 Jul 2026]` (client block, rows ~125–175). The **future
months carry a full manual per-client "Projected" column**, e.g.:
- **Sept 2026:** Boulevard 16 · Front 28 · Honey 38 · Leapsome 24 · Pebl 22 · Rivian ([New client] July KO #3) 7 · ADP (KO #4) 10 · [New client] Aug KO #1 5 … → **total+specialized = 520** (= the pod headline you already publish).
- **Oct 2026:** Front 15 · Gainbridge 25 · Dr Squatch 20 · Serval 20 · Vimeo 10 … → **total+specialized = 537**.

So the client-grain future data EXISTS in the sheet and already Σ's to the `projected_used_capacity`
you publish at pod grain — it's simply not persisted at client grain past Jul.

## Data facts (BQ, verified via the SA-key path today 2026-07-14)
- `editorial_int_client_pod_months` — client×month; 2026 rows only **202601–202607** (stops Jul).
- `editorial_capacity_client_contributions` — client×month; stops **202606** (Jun).
- `editorial_int_capacity_pod_months` — pod×month; **full Jan–Dec**, = sheet exactly (Δ=0 every pod/month).
- `editorial_raw_production` — all 12 months but `articles_projected` tapers (Jul 453 → Dec 275, raw).

## The ask
**Extend the sheet client-block itemization forward** (Aug–Dec 2026, and future months generally)
to a client-grain table the Planning-Hub can read — either by extending
`editorial_int_client_pod_months` to cover future months, or a dedicated
`editorial_int_capacity_client_forecast`. Needed columns: `year, month, pod, client_id,
client_name, category` (for the ×1.4 weight), `projected_raw, projected_weighted, status`. Hard
requirement: **Σ per (pod, month) must reconcile to `editorial_int_capacity_pod_months.projected_
used_capacity`** (incl. the `[New client] … KO` planned rows) — i.e. the same block that already
rolls up to the pod headline.

Planning-Hub side is then a **1-line change**: `getCapacityData().clientFuture` reads that table
for future months instead of `editorial_raw_production`. Result: footer = sheet exactly, AND the
footer reconciles with the matrix internally (Σ client ≡ pod total) — the pre-cutover version of
the pod≡Σclient design in your pod_vs_client_demand answer.

## Questions
1. **Why does itemization stop at Jul?** Is the ET-CP client block parsed only for closed/current
   months, or is there a blocker to reading the forward "Projected" columns (they're right there in V15)?
2. **Preferred shape** — extend `editorial_int_client_pod_months` forward, or a new
   `editorial_int_capacity_client_forecast`? (We'll read whichever; extending the existing table = smallest change for us.)
3. **Planned `[New client] KO` rows** — include them in that client-grain table too? They're
   currently our Neon `editorial_demand_edits` seed (`edited_by='sheet-forecast'`, negative
   client_ids). If the ETL publishes them at client grain, our seed becomes redundant (cleaner).
4. **Weight/category** for future rows — from the sheet's Category column (standard ×1.0 / specialized ×1.4)? Confirm.
5. **Timeline** — feasible before the Aug 1 cutover? If not, we can seed the sheet's future
   per-client forecast into our Neon `editorial_demand_edits` ourselves (we already parse the ET CP
   tab for the planned-client seed) as an interim — **flag if you'd rather we not**, to avoid
   double-maintenance while you build the ETL version.

## Context
- Reconciliation detail + the matrix double-count we already fixed on our side: our memory
  `reference_sheet-vs-hub-reconciliation.md`; round log in `editorial-team-pods/tasks/todo.md`.
- Prior threads: `handoff_planning_hub_pod_vs_client_demand_{reconcile,answer}.md`,
  `handoff_planning_hub_forecast_ingestion.md`, `handoff_planning_hub_cutover_{proposal,confirmed}.md`.

## Next step (for the Editorial-Hub session)
Tell us (a) whether the future client-block itemization can land pre-Aug-1 and in which table/shape,
and (b) whether to include the planned KO rows there — or greenlight us to seed the sheet's future
per-client forecast into Neon as the interim. Reply in this thread.
