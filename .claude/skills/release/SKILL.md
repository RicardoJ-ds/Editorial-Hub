---
name: release
description: |
  One skill for the whole path from "save my work safely" to "ship a tagged
  release." There are no modes — the trigger word sets how far it goes:
  - /commit  → run the tiered gate (lint · format · types · semgrep · light doc
    glance) and create the commit, then STOP. No tag, no push.
  - /release → everything /commit does with the FULL gate (adds the test suite +
    a thorough doc-drift audit), then bump the version, refresh the
    changelog/docs, create an annotated tag, push the branch, and push the tag after confirmation.

  Use this skill when:
  (1) User types /commit  → gate + commit, then stop.
  (2) User types /release → gate + commit, then version bump + tag + push.
  (3) User asks to "commit", "commit changes", "ship", "cut a release",
      "tag this", "version bump and ship", "do the whole shipping workflow".
  Triggers: "commit", "commit changes", "commit this", "make a commit",
            "release", "ship", "cut release", "tag release", "release round"
---

# Commit & Release

**One skill, two depths.** You never pick a "mode" — the command you type is the choice:

- **`/commit`** — *save my work safely.* Run the tiered gate, create the commit, **stop**.
  Nothing is pushed, no tag. Use it as often as you like.
- **`/release`** — *ship it.* Everything `/commit` does (with the full gate), **then** bump
  the version, refresh the changelog, create an annotated tag, and push the branch + tag.

Every run first **surveys the window since the last tag** — the prior commits *plus* the
uncommitted work — so the commit message (and, on `/release`, the changelog) describes the
whole round. The skill only *reads* those prior commits to summarize them; it never squashes,
rebases, or rewrites history.

> **Adapted for Editorial Hub.** Stack commands are pinned in **Step 3**; the **version
> surface** is `frontend/src/lib/version.ts` (`VERSION` constant), the **default branch** is
> `main`, the **version mirrors** are listed in Step 7, and the **protected files** are in
> Important notes. Scheme is `0.PHASE.ITERATION` — a **PHASE bump** (`0.3.x → 0.4.0`) or `1.0`
> requires explicit confirmation (Step 6), and the **tag push is gated** by confirmation
> (Step 9), per the project's version-bump rule.

---

## The gate is tiered

The checks are **not** identical on both paths — the cheap, safety-critical ones run every
time; the slow / token-heavy ones are reserved for a deliberate release:

| Check | `/commit` | `/release` |
|---|---|---|
| Lint · Format · Type-check | ✅ | ✅ |
| **Security (semgrep)** | ✅ | ✅ |
| Documentation drift | light glance (changed area only) | thorough audit (all docs) |
| Slow checks (backend `pytest` · frontend `npm run build`) | — | ✅ |

**Security runs on every commit on purpose** — it's a cheap CLI step and it catches
secrets/vulns *before* they enter history (a leaked key in a pushed commit is compromised even
if a later commit removes it). The expensive doc audit and the slow full-test run are what move
to release.

---

## Step 1 — Survey the window since the last tag *(both)*

Run from the **repository root**:

```bash
git status
git diff --stat
git describe --tags --abbrev=0 2>/dev/null   # last tag (empty in a fresh repo)
git log --oneline "$(git describe --tags --abbrev=0 2>/dev/null)"..HEAD 2>/dev/null
```

The full change set since the last tag = **prior commits + uncommitted work**. This is what
the commit message describes and what the release changelog summarizes.

If there's nothing since the last tag **and** no uncommitted changes, say so and stop.

## Step 2 — Documentation check *(both — tiered)*

- **On `/commit` (light glance):** look only at the doc closest to the files you changed
  (the nearest `CLAUDE.md`/`README.md`/`AGENTS.md`) and flag an **obvious** gap — a renamed
  concept, a removed feature, a new env var. Don't read every doc; don't deep-reason. If
  nothing obvious, proceed.
- **On `/release` (thorough audit):** discover and read all docs, then apply the full
  change-type → doc-location map:

```bash
find . \( -path '*/.*' -o -path '*/node_modules' -o -path '*/.venv' -o -path '*/dist' \
        -o -path '*/build' -o -path '*/__pycache__' \) -prune -o \
       \( -name 'CLAUDE.md' -o -name 'AGENTS.md' -o -name 'README.md' \) -print | sort
```

| Change Type | Where it should be documented |
|---|---|
| New backend service / module | Backend `CLAUDE.md` → services list |
| New API route / endpoint group | Backend `CLAUDE.md` → routes/endpoints |
| New database model / column | Backend `CLAUDE.md` → data models (+ a migration if needed) |
| New env var | Root `CLAUDE.md` → Environment Variables |
| New frontend component / hook | Frontend `CLAUDE.md`/`AGENTS.md` → key files |
| Changes to app startup/boot logic | Backend `CLAUDE.md` → startup sequence |
| **User-facing UX change** (new affordance, renamed concept, removed UI) | In-app help/glossary doc + the changelog |
| New major feature (route + service + UI) | All relevant docs + a dedicated README section |
| Removed functionality | Delete mentions everywhere; don't leave "(removed)" stubs |

If docs need updates, make them directly (docs are non-protected), show what changed, then
proceed. **Doc update rules:** keep entries concise, match existing style, don't add detail
derivable from code (paths, line numbers), update counts ("15 routers" → "16"), update the
doc closest to the changed code.

## Step 3 — Code checks *(both)*

Run **sequentially** for the layers that changed; stop and surface failures rather than
auto-fixing large changes.

### Python — backend (if files under `backend/` changed)

Run from `backend/` (uv-managed; ruff + mypy configured in `backend/pyproject.toml`):

```bash
cd backend
uv run ruff check .
uv run ruff format --check .
uv run mypy .
uv run pytest -q          # /release only (see tier table) — backend/tests/
```

### JS / TS — frontend (if files under `frontend/` changed)

Run from `frontend/`:

```bash
cd frontend
npm run lint        # eslint
npx tsc --noEmit    # type-check
npm run build       # /release only — the frontend has no test script; build is the gate
```

**Tiering:** lint + type-check run on **both** paths. The slow steps — backend `pytest` and a
full frontend `npm run build` — run on **`/release` only**. (The frontend defines no test
script today; if one is added, swap `npm run build` for it. On `/commit`, skip both slow steps.)

On failure:
- **Lint** → show errors; offer `--fix` (`ruff check . --fix` / `eslint . --fix`); re-run.
- **Format** → auto-fix (`ruff format .` / `prettier -w .`), show which files moved, re-run.
- **Types** → show errors; offer to fix annotations/imports; re-run.
- **Tests** → show failures; offer to fix the test or the code; re-run.

## Step 4 — Security scan (semgrep) *(both)*

Run from the **repository root** (covers all languages):

```bash
semgrep scan --error --config auto --json 2>/dev/null
```

Use a 5-minute timeout. If semgrep isn't installed, warn and skip (don't block the commit).

If findings exist:
- Parse JSON, group by severity (ERROR > WARNING > INFO).
- Show `file:line`, rule, severity, issue, and the offending code for each.
- Ask the user: **Fix all** / **Skip** (proceed anyway) / **Abort**.
- If fixing, re-scan after fixes (max 3 iterations).

> This is the toolkit's security gate, and it runs on **every commit** — not just releases.
> There is intentionally no separate "security" skill; secret/vuln scanning belongs in the
> commit path so it runs every time.

## Step 5 — Commit *(both)*

Only reach this step if the gate passes (or the user chose to skip security findings).

1. Stage the relevant files (prefer specific paths over `git add -A`).
2. Draft a concise commit message that summarizes the change, informed by the window from
   Step 1. On `/release` the subject uses the version format (Step 7): `X.Y.Z — <summary>`.
3. Show the message to the user for approval.
4. Create the commit. **Never include a `Co-Authored-By` line.**

> **If invoked as `/commit`: you are done. Report (below) and STOP — do not tag or push.**
> The steps that follow run only for `/release`.

## Step 6 — Version bump *(release only)*

Editorial Hub uses **`0.PHASE.ITERATION`** (phases: `0.1` initial Hub · `0.2` data
foundation · `0.3` UI maturity · `0.4` CP v2 → DB migration · `1.0` Hub-as-tool-of-record).
**Default is the smallest bump — ITERATION (PATCH).**

- **ITERATION / PATCH (default)** — bug fixes, small UX improvements, anything that doesn't
  change the project's focus area. No confirmation needed (e.g. `0.3.28 → 0.3.29`).
- **PHASE bump** (`0.3.x → 0.4.0`) — signals a new project focus area. **Requires explicit
  confirmation.** Never auto-roll.
- **`1.0`** — reserved for when CP v2 is wired to the database and RBAC is signed off. Never
  roll without confirmation.

State the proposed version + the reason. If it's a PHASE bump or `1.0`, **stop and wait for
confirmation** before continuing. (PATCH runs through Step 8 unattended — but the tag push in
Step 9 is always confirmed; see below.)

## Step 7 — Version surfaces + CHANGELOG *(release only)*

Update **all version surfaces in the same commit** so they never drift (Editorial Hub's four):

1. **`frontend/src/lib/version.ts`** — the `VERSION` constant. **Single source of truth.**
2. **Root `CLAUDE.md`** — the "Current version: `X.Y.Z`" line near the top.
3. **`CHANGELOG.md`** — add a new top section `## X.Y.Z — <date>`. Plain-language, grouped by
   feature area (not by file), covering the **whole window since the last tag** (Step 1).
4. **Sidebar version chip** — reads `version.ts` automatically; **no edit needed** (just
   confirm it still imports from there).

Use the exact version format from your source-of-truth surface (never invent `v0.5` /
`version 0.3.5`). Then make the release commit (Step 5 format: `X.Y.Z — <summary>`, body =
3–6 highest-impact changes, one per dash-prefixed line, **no `Co-Authored-By`**).

## Step 8 — Annotated tag *(release only)*

```bash
git tag -a vX.Y.Z -m "<same subject as the commit>"
```

Always **annotated**, never lightweight.

## Step 9 — Push branch + tag *(release only)*

```bash
git push origin main          # default branch — Railway (backend) + Vercel (frontend) redeploy from this
# then, only after explicit confirmation:
git push origin vX.Y.Z        # push the annotated tag
```

Push the **branch** to `main` directly — that's the routine deploy trigger (Railway rebuilds
the backend, Vercel the frontend). **Then stop and confirm before pushing the tag** —
Editorial Hub's version-bump rule requires explicit OK on `git push origin vX.Y.Z`. **Never
`--force`** — tags are immutable once pushed; never `--no-verify`.

## Step 10 — Stakeholder changelog block *(release only, optional)*

If the team keeps a human-facing changelog (Notion / Slack / a wiki), emit a scannable block
the user can paste. Audience = non-engineers; they want **what visually changed and how to
verify it** in under 30 seconds.

Format rules (keep them strict — this is what makes it scannable):
- Heading: `## X.Y.Z — <Month Day>`.
- Group by where in the app the change appears (highest-traffic area first), as sub-headings.
- **One line per bullet:** `- **<UX label>** — <what visually changed>. *Verify:* <2–5 word click path>.`
  - **UX label** = the user-visible affordance, never a code/component name.
  - **What changed** = the outcome in plain English, never the implementation.
  - **Verify** = a concrete click path the reader can run.
- One bullet = one change (never combine with "and"). No file paths, function/schema/library
  names, hashes, or stack jargon. Bold + italic only — no code blocks or tables.

Skip this step entirely if the project has no stakeholder changelog.

## Results summary

Rows beyond the commit show `n/a (commit-only)` when invoked as `/commit`.

| Surface | Result |
|---|---|
| Documentation | Up to date / Updated (N files) / Light glance (commit) |
| Lint / Format / Types | Passed / Fixed |
| Tests | Passed (N) / n/a (commit-only) |
| Security (semgrep) | Passed / N findings / Skipped |
| Commit | Created (`<hash>`) |
| Version bumped | `X.Y.Z` (PATCH/MINOR/MAJOR) / n/a (commit-only) |
| `CHANGELOG.md` | New `X.Y.Z — <date>` section / n/a |
| Tag | `vX.Y.Z` created + pushed / n/a |
| Push | Branch + tag pushed to `origin` / n/a (commit-only) |
| Stakeholder block | Emitted / n/a |

## Important notes

- **`/commit` never pushes** (commit-only); **`/release` pushes the branch + tag
  automatically** (after the Step 6 bump confirmation, if any).
- **Never include a `Co-Authored-By` line** in any commit or tag.
- Never `--force` push a branch or a tag. Tags are immutable once pushed. Never `--no-verify`.
- Never amend an already-pushed commit. If a post-push fix is needed, create a follow-up
  commit and a `vX.Y.(Z+1)` patch tag.
- If the user declines a MINOR/MAJOR bump, fall back to PATCH.
- Run language tools from the package root, semgrep from the repo root. Use the project's
  environment (`.venv` / `uv` / the right Node version), not system tooling.
- **Do NOT modify protected files** (deploy/infra + generated): `docker-compose.yml`,
  `backend/Dockerfile`, `railway.toml`, `backend/uv.lock`, `frontend/package-lock.json`, and
  any `.env*`. Touch these only on explicit request. Note: `backend/Dockerfile` builds from
  the **repo root** context (`COPY backend/...`) — never run `railway up --path-as-root backend`.
- Watch for dev-server caches after a version bump (some bundlers cache the old version string
  and show a hydration mismatch) — restart the dev server if so. Prod builds are unaffected.
