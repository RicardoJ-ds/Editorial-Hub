# 20 · Decisions — one file per decision

A decision audit trail. Each decision is its own file, **never edited after writing**.

Naming: `decision_YYYY-MM-DD_<short-name>.md`. When a decision is superseded, write a NEW
file and mark the old one `> ⚠️ STALE as of YYYY-MM-DD — superseded by [[decision_...]]` at
the top. This keeps the reasoning history intact.

Template:
```markdown
---
name: decision_YYYY-MM-DD_<short-name>
description: <one-line outcome>
type: decision
---

# Decision: <title>  (YYYY-MM-DD)

**Context** — what forced a choice.
**Options considered** — the real alternatives.
**Decision** — what we chose.
**Why** — the deciding factors.
**Consequences** — what this commits us to; what to revisit and when.
```
