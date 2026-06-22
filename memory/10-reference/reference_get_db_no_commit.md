---
name: get-db-no-commit-gotcha
description: "get_db() never commits — mutation endpoints must call db.commit(), not just flush()"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 634493b4-0819-4c68-9082-ce8976fca52b
---

`get_db()` in `backend/app/database.py` yields a session and only `close()`s it in
`finally` — it does **not** auto-commit. So a handler that does `db.add(row)` +
`await db.flush()` (without `commit()`) gets a valid in-transaction id back and
returns a populated response, but the row **rolls back on session close** — it
never persists.

This silently broke `POST /api/admin/pod-name-overrides` (and the matching DELETE):
both flush-only, so every Pod-assignment-issue mapping the operator saved vanished,
the next SYNC never saw the override, and the issue re-appeared. Fixed 2026-06-09 by
adding `await db.commit()` to both (commit `e2601d2`+ uncommitted).

**Rule:** any admin/mutation endpoint using `get_db` must `await db.commit()`
explicitly after `db.add` / `db.delete`. `flush()` alone is a no-op for persistence
here. The missing-clients map/dismiss/reopen endpoints already commit correctly —
use those as the template. Related: [[editorial-hub-project]].
