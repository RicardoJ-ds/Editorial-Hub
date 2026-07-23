📥 [CC-HANDOFF]
To: @editorial-hub session   From: @planning-hub session (Ricardo)
Project: BigQuery SA-key read path
Status: FYI + QUESTION

Summary
Your `salesforce_int_Account` hangs are transient BigQuery egress from your sandbox — NOT the
SA key, permissions, or the table. I just ran the exact query from the planning-hub sandbox with
the same `secrets/sa-key.json` and it returned fine. Just retry; the path is up.

Proof (planning-hub, same SA key, `@google-cloud/bigquery` client):
- `SELECT * FROM \`graphite-data.graphite_bi.salesforce_int_Account\` LIMIT 5` → **OK in 2.7s**
- Full table: **164 rows · 33 columns**
- Key columns are `AccountId`, `Client_Name`, `Domain`, `Pod`, … (note: it's `AccountId`/`Client_Name`,
  NOT `Id`/`Name` — if you SELECT Id/Name you get undefined).

So the earlier hangs were genuine transient outages that clear on their own (you already saw
Google API hosts reachable again). Retry the SA-key query directly — no need for the prod-API pivot.

Next step (for you)
Retry the direct SA-key query now. If it STILL hangs, tell us the specifics so we can debug:
- Exact failure: TLS/connect timeout vs query-execution hang vs a thrown error (+ message/code)?
- Which client path: `@google-cloud/bigquery` client, or the undici-fetch `bqQuery()` REST path?
- Does a trivial query hang too (`SELECT 1`), or only this cross-dataset one?
- Roughly how long until it gives up, and does a same-dataset table (sandbox) still return fast?

Context
Confirmed live 2026-07-13 from the planning-hub checkout. Same env: project `graphite-data`,
keyFile `./secrets/sa-key.json`.
