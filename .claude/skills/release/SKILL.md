---
name: release
description: |
  Cut a new release: bump version, refresh the changelog + docs, run the full
  CI pipeline, commit, tag, push the branch, and emit a Notion-ready changelog
  block. Wraps the existing `pre-commit-checks` skill with the version-bump
  procedure + the Notion changelog formatting rule.

  Use this skill when:
  (1) User types /release
  (2) User asks to "ship", "cut a release", "release this round", "do the
      whole shipping workflow", "update version + commit + push"
  Triggers: "release", "ship", "cut release", "release round",
            "version bump and ship", "shipping workflow"

  Stops short of pushing the tag without explicit confirmation — see
  `feedback_version_bump.md` rule #5.
---

# Release Workflow

End-to-end shipping workflow for the Editorial Hub. Wraps version bump +
documentation update + pre-commit pipeline + commit + tag + push +
Notion changelog block.

## Step 0 — Sanity check

Run from the repository root:

```bash
git status
git log --oneline -5
cat frontend/src/lib/version.ts | grep VERSION
```

If the working tree is clean (nothing to commit), inform the user and
stop — nothing to release.

## Step 1 — Determine the version bump

Read the rules from
`~/.claude/projects/-Users-ricardo-python-editorial-hub/memory/feedback_version_bump.md`
if present. **Default is PATCH** (e.g. `0.3.5 → 0.3.6`).

Bump rules:

- **PATCH (default)** — bug fixes, small UX improvements, anything that
  doesn't change the project's focus area. No confirmation needed.
- **PHASE bump** (`0.3.x → 0.4.0`) — only when the project enters a new
  focus area (CP v2 → DB migration, RBAC sign-off, etc.).
  **REQUIRES EXPLICIT USER CONFIRMATION.** Never auto-roll.
- **`1.0`** — reserved for "Hub becomes the team's primary tool of record"
  (CP v2 wired to DB + RBAC signed off). Never roll without confirmation.

Phase reference (don't change without user approval):
- `0.1.x` — Initial Hub
- `0.2.x` — Data foundation (CP v2 prototype, BigQuery growth pods, Notion KPIs)
- `0.3.x` — UI maturity (current)
- `0.4.x` — CP v2 → DB migration (next)
- `1.0` — Primary tool of record

State the proposed version + the reason. If PHASE/1.0 bump, **stop and
wait for confirmation** before continuing.

## Step 2 — Update the version surfaces

Update **all of these in the same commit**:

1. `frontend/src/lib/version.ts` — the `VERSION` constant.
2. `CLAUDE.md` (root) — the "Current version" line at the top.
3. `CHANGELOG.md` — add a new top section under `## X.Y.Z — <date>`.
   **Plain-language** for stakeholders, mirroring existing entries.
   Group by feature area, not by file.
4. **`frontend/src/content/changelog.ts`** — auto-generated mirror of
   `CHANGELOG.md` that the in-app Help/Changelog modal renders. After
   editing `CHANGELOG.md`, regenerate from the repo root:
   ```bash
   node -e "const fs=require('fs');const c=fs.readFileSync('CHANGELOG.md','utf8');fs.writeFileSync('frontend/src/content/changelog.ts','// AUTO-GENERATED from CHANGELOG.md by the /release skill. Do not edit by hand.\n// Source of truth: /CHANGELOG.md at the repo root.\nexport const CHANGELOG_MARKDOWN = '+JSON.stringify(c)+';\n');"
   ```
   The file's header comment says "DO NOT EDIT" so reviewers know the
   canonical version lives at the repo root.
5. Sidebar version chip reads from `version.ts` automatically — no edit.

Generating the changelog body:
- Run `git log --oneline <previous-tag>..HEAD` and
  `git diff --stat <previous-tag>..HEAD` to see what shipped.
- For uncommitted local work in this round, also include the local diff.
- Group by user-facing area (Access Control, Pod axis, Overview, Sync,
  etc.). Keep technical jargon out — write for Editorial Ops + stakeholders.

## Step 3 — Update other documentation

Discover all CLAUDE.md / AGENTS.md / README.md files dynamically:

```bash
find . \( -path '*/.*' -o -path '*/node_modules' -o -path '*/.venv' \
        -o -path '*/dist' -o -path '*/__pycache__' \) -prune -o \
       \( -name 'CLAUDE.md' -o -name 'AGENTS.md' -o -name 'README.md' \) \
       -print | sort
```

Common doc-update triggers — explicitly check the diff for each:

| Change Type | Where it should be documented |
|---|---|
| New backend service file | `backend/CLAUDE.md` → Services list |
| New backend API router | `backend/CLAUDE.md` → router count |
| New database model / column | `backend/CLAUDE.md` → Key Database Models + idempotent startup migration if needed |
| New env var | `CLAUDE.md` (root) → Environment Variables |
| New frontend component or hook | `frontend/AGENTS.md` (note the convention: this project uses `AGENTS.md` not `CLAUDE.md` for the frontend) |
| New feature flag / view slug | `backend/app/services/access.py` `_VIEWS` catalog + `Sidebar.tsx` `requiredViews` + `CLAUDE.md` route table |
| Renamed component or hook | Update every reference in CLAUDE.md / AGENTS.md (grep for the old name) |
| Removed functionality | Delete mentions; don't leave "(removed)" stubs |

Keep edits concise — match existing style. If a doc isn't relevant to
this round's changes, leave it alone.

## Step 4 — Run the CI pipeline

Run these gates sequentially. Don't auto-fix lint without showing the user.

1. **Lint**: `cd backend && uv run ruff check .`
2. **Format**: `cd backend && uv run ruff format --check .` — auto-fix
   if it would reformat anything, and show the user which files were
   touched.
3. **Types (backend)**: `cd backend && uv run mypy .`
4. **Types (frontend)**: `cd frontend && npx tsc --noEmit`
5. **Tests**: `cd backend && uv run pytest -q`
6. **Security**: `semgrep scan --error --config auto --json --quiet`
   from repo root, 5-minute timeout, 0 findings expected. Skip with a
   warning if semgrep isn't installed.

Stop and surface any failures — don't proceed to commit.

## Step 5 — Commit

Stage all relevant files (prefer specific paths over `git add -A` when
it's a small set; full `git add -A` is OK when the round genuinely
touched many files). Commit subject MUST match this format:

```
X.Y.Z — <short summary of the round>
```

(e.g. `0.3.6 — Group capabilities card + scoped pod toggle + Notion-style Overview comments`)

The body lists the 3–6 highest-impact changes, one per line, dash-prefixed.

**Do NOT include `Co-Authored-By` lines** — see `feedback_no_coauthor.md`.

The commit subject MUST start with the version in the same format as
`version.ts`. Never invent shorthand like `v0.5` or `version 0.3.5`.

## Step 6 — Annotated tag (LOCAL ONLY)

```bash
git tag -a vX.Y.Z -m "<same subject as the commit>"
```

Always annotated. Never lightweight. **Don't push the tag yet.**

## Step 7 — Push branch (no confirmation), wait for tag confirmation

```bash
git push origin main          # branch first — Vercel + Railway redeploy from this
# WAIT for explicit "yes" / "go" / "push the tag" from the user before:
git push origin vX.Y.Z        # tag push — gated on user confirmation
```

Per `feedback_version_bump.md` rule #5, **the tag push always waits for
explicit confirmation** from the user. Pushing the branch is fine on its
own; the tag is the deliberate "this is the canonical release marker"
step.

## Step 8 — Emit the Notion changelog block

This is the deliverable the user pastes into the team's Notion
changelog page. **Format is precise — don't deviate.**

### Format rules (locked-in conventions)

The user's preferred Notion format is:

- **Heading**: `## X.Y.Z — <Month Day>` (level-2 markdown so it nests
  cleanly under the master "Changelog" page).
- **Section sub-headings**: `#### <Page or area>` describing where in
  the app the user will see the change.
- **Bullets**: every bullet must lead with a bolded route/path label,
  then `:` then the plain-language summary. Format:
  `- **<Page> · <Tab/Subsection> · <Detail>:** <one short sentence>.`
- **Non-technical audience**: write for the Editorial Ops team and
  stakeholders. No file paths, no function names, no commit hashes. Use
  outcomes ("comments stay where you left them when you reload") not
  implementation details ("now persisted in Postgres").
- **Keep it short**: one or two lines per bullet. Cover everything that
  shipped, but the goal is scannable, not exhaustive.
- **Order**: from highest-traffic area to lowest. Dashboards first
  (Overview → Editorial Clients → Team KPIs), then admin features, then
  under-the-hood fixes at the bottom.

### Template

```markdown
## X.Y.Z — May 11

#### Admin → Access Control

- **Tab: Groups · Capability card:** Each expanded group row now lists what the group can see, whether they can toggle Editorial / Growth, and their client scope.
- **Tab: Groups · Reference table:** "How groups work" collapsible at the top maps all six seeded groups in one view.

#### Top Bar

- **Editorial / Growth toggle:** Now only appears on the dashboards (Overview, Editorial Clients, Team KPIs). Hidden everywhere else where it had no effect.

#### Overview

- **Comments · Per-section icons:** The right-side rail is replaced with a small chat-bubble icon next to each section title. Click → comments open in a popover anchored below the icon. No layout shift, no full-screen overlay.
- **Comments · Empty-state icon:** Empty sections show a "+ chat bubble" glyph and fade in on hover; sections with threads show a plain bubble + open / resolved count.
- **Comments · Client picker:** The composer's client dropdown is now a typeahead search box matching the dashboards' "Search clients..." filter.
- **Comments · Timestamps:** Read like Notion: `now`, `42m`, `2h`, `10:42 AM`, `Yesterday`, `May 8`, `May 8, 2024`. Hover for the full date and time.
```

### Reference

If the user asks "remember how I want the Notion format," cite:

- Source-of-truth conversation: bullets per app section, leading with
  `**Page · Tab · Subsection:**`, plain English for non-technical readers.
- Keep entries short — a few lines covering everything edited per
  section, not a wall of text.
- Never include technical jargon, file paths, or implementation details.

## Step 9 — Report

Show the user this table:

| Surface | Result |
|---|---|
| Version bumped | `X.Y.Z` (PATCH/PHASE) |
| `frontend/src/lib/version.ts` | Updated |
| `CLAUDE.md` | Updated |
| `CHANGELOG.md` | New `X.Y.Z — <date>` section added |
| Other docs | Up to date / Updated (N files) |
| Lint / Format / Types | Passed |
| Tests | Passed (N tests) / Skipped (no tests) |
| Security (semgrep) | Passed (0 findings) / Skipped |
| Commit | Created (`<hash>`) |
| Tag (local) | `vX.Y.Z` created |
| Push (branch) | Pushed to `origin/main` |
| Push (tag) | **Awaiting user confirmation** |
| Notion block | Emitted in chat (copy-paste ready) |

## Important notes

- Never push `--force` to `main` or `--force` a tag. Tags are immutable
  once pushed.
- Never skip hooks (`--no-verify`).
- Never amend a commit that's already been pushed. If a fix is needed
  post-push, create a follow-up commit and a `vX.Y.(Z+1)` patch tag.
- If `pre-commit-checks` reveals failures that require significant
  refactoring, stop and let the user decide rather than auto-fixing.
- If the user says "no" to PHASE bump confirmation, fall back to PATCH.
- This project uses `AGENTS.md` (not `CLAUDE.md`) for the frontend
  directory. The backend uses `CLAUDE.md`. Don't accidentally rename
  one to the other.
- **Dev-server gotcha after version bump:** Turbopack can keep an old
  `VERSION` value cached in an in-memory chunk after `version.ts` is
  edited, which manifests as a hydration error in the Sidebar
  ("server says v0.3.5 / client says v0.3.6"). Fix is to restart the
  frontend container: `docker compose exec frontend rm -rf .next/cache
  && docker compose restart frontend`. This affects dev only; prod
  builds are fine.
