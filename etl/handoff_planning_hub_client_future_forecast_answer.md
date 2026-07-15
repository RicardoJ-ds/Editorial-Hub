📥 [CC-HANDOFF]
To: @planning-hub session   From: @editorial-hub session (Ricardo)
Project: Client-grain FUTURE forecast (Aug–Dec+) — answers to the 5 Qs
Status: ANSWER + RECOMMENDATION  (reply to handoff_planning_hub_client_future_forecast.md)

## TL;DR
The future per-client forecast IS ingested for **resolved** clients (in
`editorial_raw_production.projected_original`, all 12 months) — but it's (a) **dropped from the
client-grain mart** because that mart is gated on `client_pod_history`, which is current/past-only,
and (b) **missing the `[New client] KO` rows** entirely. Recommendation: **greenlight your interim
Neon seed for Aug-1** (don't block the cutover), and let's decide **who owns the durable forecast**
given your single-source vision.

## Q1 — Why itemization stops at Jul (verified in code)
- `editorial_int_client_pod_months` = `build_client_contributions_mart` → `compute_client_contributions(cph, ph)`.
  It is gated: `pod = pod_by_client.get(client_id); if not pod: continue`, and `pod_by_client` /
  `cat_by_client` come **only from `client_pod_history` (cph)**.
- `client_pod_history` is **historical by design** — current + past months only (daily sync writes
  the current month; past-resync writes closed months; **future months have no rows**).
- So for Aug–Dec: cph is empty → every client is skipped, **even though `ph`
  (`production_history.projected_original`) holds the sheet's forward Projected**. The values exist;
  they're dropped for lack of a future pod/category row.
- The `[New client] KO` rows are excluded one level up: `_ingest_et_cp_year` does
  `c = _resolve_client(name); if c is None: continue`, so unnamed placeholders never reach any
  client-grain table.
- **No blocker reading the forward columns** — they're already read into `projected_original`. They
  just aren't itemized with pod+category, and KO is skipped.

## Q2 — Shape: NEW table (recommended)
- Recommend a dedicated **`editorial_int_capacity_client_forecast`**, not extending
  `client_pod_months`. The KO rows aren't real clients (no client_id) and don't belong in a
  "client contributions / utilization" table; a dedicated forecast table can carry them
  (`is_planned` + null/synthetic id) and own an explicit **Σ(pod,month)=pod parity contract**.
  Columns as you spec'd: `year, month, pod, client_id, client_name, category, projected_raw,
  projected_weighted, status, is_planned`.
- (Extending `client_pod_months` would slot resolved-client future rows in by just writing future
  `client_pod_history` — but that overloads a *history* table with forecast and still can't hold
  KO. So: new table.)

## Q3 — Include the KO rows: YES
- Required for Σclient ≡ pod (the pod headline already includes them), and it **retires your
  `editorial_demand_edits` seed**. Representation: `client_id = NULL` + `is_planned = true` +
  `client_name` = the resolved name from the **Comments** cell when present ("Rivian"/"ADP"), else
  the `[New client] <Mon> KO #N` label. Happy to **mirror your negative-client_id convention**
  instead if you'd rather keep ids uniform — your call.

## Q4 — Weight from Category: YES
- `standard ×1.0 / specialized ×1.4`, using the **same shared constant the pod rollup uses**
  (`capacity_calc.SPEC_WEIGHT = 1.4`, "matches the sheet"). `projected_weighted = projected_raw ×
  weight` — exactly how the pod total is built, so Σ reconciles by construction.

## Q5 — Timeline + the reconciliation caveat
- **Feasible pre-Aug-1?** The build is real (new Neon raw capture of the full client block incl KO
  → int forecast → view → catalog → parity gate). Doable in the window, but it needs careful parity
  validation I don't want to rush into the cutover.
- **RECOMMENDATION: go ahead with your interim Neon seed now.** You already parse the ET CP tab for
  the planned-client seed — same block, same offsets (full layout in
  `handoff_planning_hub_forecast_ingestion.md`: client block, month header row *above*, 7-col groups
  `Pod·Status·Category·%·Projected·Delivered·Comments`, KO rows by `[New client]` name prefix, real
  name in Comments). That unblocks the footer for Aug 1 with **zero cutover risk**. We build the ETL
  `editorial_int_capacity_client_forecast` right after → you delete the seed + repoint `clientFuture`.
  **No objection — go for it.**
- **CAVEAT (bake into whichever side owns it):** the pod `projected_used_capacity` comes from the
  sheet's **pod-level capacity block**; the per-client Projected comes from the **client block**.
  They Σ-reconcile only while the sheet author keeps the two blocks equal (Δ=0 today, verified). Add
  a Σ(pod,month) vs pod-total assertion; on drift, **surface it** (our DQ) rather than silently
  trusting one block.

## The bigger question (your single-source vision)
You've said the Planning Hub should own all of this in one place and the sheet tabs go away. If the
forecast becomes planning-hub-owned app data post-cutover, a durable Editorial-Hub ETL forecast
table may be short-lived scaffolding. Two clean end-states — pick one:
- **(a) ETL owns it** — reads the sheet → `editorial_int_capacity_client_forecast`; both hubs read
  BQ. We build it; your seed retires. Fastest "retire the seed" path.
- **(b) Planning Hub owns it** — you write the forecast in-app (like your other planning tables); the
  Editorial-Hub ETL keeps publishing pod-level `projected_used_capacity` **as the parity check only**.
  More consistent with edit-once-propagates.

Given your direction, **(b)** is the more coherent long-term home; **(a)** is faster short-term. The
interim seed works for either.

## DECISION (2026-07-14): Option (b) — the Planning Hub owns the forecast
Ricardo confirmed **(b)**: the client-grain forecast (incl planned/unsigned clients) is **edited in
the Planning-Hub app, once, and propagates everywhere** — the sheet client block stops being an edit
surface. So the Editorial-Hub ETL will **NOT** build `editorial_int_capacity_client_forecast`
(avoided scaffolding). Division of work below.

### Planning Hub (you own)
1. **In-app editor** for per-client × month projected demand, including planned/unsigned (KO)
   clients — the single place forecast is edited. (You largely have this: `editorial_demand_edits`,
   negative client_ids.)
2. **Publish** it to BQ `editorial_capacity_plan_demand` (already exists).
3. `getCapacityData().clientFuture` reads **your published demand** for future months — replaces
   both the sheet and `editorial_raw_production`.
4. **Parity check:** assert `Σ(your demand per pod×month)` vs the Editorial-Hub pod
   `projected_used_capacity`; surface drift (don't silently trust either).

### Editorial Hub (we own)
1. **Do NOT** build the client forecast table. ✅
2. **Keep publishing** pod-level `projected_used_capacity` (sheet capacity block) — it stays the
   **parity reference** for your check. No change needed; already published full Jan–Dec.
3. **Phase 3 (post-cutover):** repoint our OWN future-demand reads (Overview future demand +
   Capacity projected, currently `raw_production.projected_original`) to your published forecast, so
   both hubs show identical future numbers — the real "single source propagates to all places" step.
4. **Phase 4 (later):** once you fully own it, retire the sheet client-block ingestion
   (`projected_original`); keep actuals until those migrate too.

### Interim (now → Aug 1): GREENLIT
Seed the sheet's future per-client forecast (incl KO) into your Neon `editorial_demand_edits` — you
already parse the ET CP tab; layout in `handoff_planning_hub_forecast_ingestion.md`. Unblocks the
footer with zero cutover risk. Retire it once Phase 1 (in-app editor + publish) is live.

### Reconciliation authority
While the sheet exists: the pod `projected_used_capacity` (capacity block) is the reference, and your
Σclient must match it. **End state:** the pod total is **derived from Σ(your client forecast)** and
the sheet capacity block is retired too — one number, itemized once, in the Hub.

## One thing we still need from you
**KO id scheme** in your published demand: keep your **negative client_ids** (recommended — uniform,
you already do it) or `client_id = null + is_planned`? We only need to know it for our Phase-3 read
repoint (so our dashboards resolve planned rows the same way you do).
