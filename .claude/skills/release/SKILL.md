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
5. **`frontend/src/content/help.ts`** — in-app Help & Glossary (rendered
   by `HelpModal`). **MUST be kept in sync with any user-facing UX change
   that ships in this round.** Read the diff, then audit every section
   of `help.ts` for stale wording / missing capabilities. Specifically
   check:
   - **Which dashboard for which question?** table — add new pages,
     mark removed/proposal-stage pages, update the question framing.
   - **Glossary** — every renamed concept (e.g. "Projected end of Q" →
     "End-of-Q variance"), new badge/tier introduced, new acronym.
   - **How to…** — every new UI affordance the user can trigger
     (filters, toggles, tabs, drill-downs, comments). Remove tips that
     reference removed UI.
   - **Permissions** — re-check the one-line group summary if RBAC
     scope changed.
   - **Reading the cards / dashboards** — any added column, badge, or
     section per-card needs a one-liner here.
   - **SYNC** — flag new sync steps (e.g. past-months resync additions).
   - `help.ts` is a JS template literal — do NOT introduce raw backticks
     inside the string; use `*italic*` or quotes for inline emphasis.
6. Sidebar version chip reads from `version.ts` automatically — no edit.

**Two UI surfaces stay in lockstep with stakeholder docs:** when you
update `CHANGELOG.md` you MUST regenerate `changelog.ts`; when shipping
UX changes you MUST audit `help.ts`. The Help & Changelog modal IS the
in-app stakeholder doc — leaving it stale ships a worse experience than
not updating Notion.

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

The Notion block is **scannable, not exhaustive**. The audience is
Editorial Ops + stakeholders — they want to know **what visually
changed and how to test it** in under 30 seconds. No technical detail.

- **Heading**: `## X.Y.Z — <Month Day>` (level-2 markdown so it nests
  cleanly under the master "Changelog" page).
- **Section sub-headings**: `#### <Page · Tab · Subsection>` describing
  exactly where in the app the user will see the change. Highest-traffic
  area first (Overview → Editorial Clients → Team KPIs → Capacity
  Maintenance → Admin → Data Quality → Under the hood).
- **Bullets — ONE LINE EACH.** Format strictly:
  `- **<UX label>** — <what visually changed>. *Validate:* <2–5 word click path>.`
  - **UX label** = the user-visible UI affordance (e.g. "Rich-text composer",
    "Monthly grid", "1st Q tier label"). Never a code name or component name.
  - **What changed** = the outcome in plain English ("bold, italic, links,
    lists via toolbar"). Never the implementation ("Tiptap", "useEditor",
    "context"). No "now persists in Postgres" — say "stays where you left
    it when you reload".
  - **Validate** = the concrete click path the reader can run themselves
    to see the change. Keep it short — `click X → see Y`. Skip the
    *Validate:* clause only when the change has no UX surface to click
    on (rare — for under-the-hood entries only).
- **One bullet = one change.** Never combine two changes with "and".
  Two changes = two bullets.
- **Non-technical vocabulary only.** No file paths, function names,
  schema names, library names, commit hashes, version numbers
  (other than the heading), or stack jargon. The reader doesn't know
  what "upsert" or "stacking context" or "Postgres" means.
- **No mid-bullet UI screenshots.** Notion will render the markdown
  cleanly; resist the urge to add formatting beyond bold + italic.
- **Inline emphasis** with `**bold**` (UX label, italicised value) and
  `*Validate:*` only. No `<code>` blocks, no tables.

### Template

```markdown
## X.Y.Z — May 11

#### Admin · Access Control · Groups tab

- **Capability card** — each expanded group row lists views, axis-toggle, and client scope. *Validate:* expand any group row.
- **Reference table** — "How groups work" collapsible at the top maps all six seeded groups. *Validate:* open the collapsible above the matrix.

#### Top bar

- **Editorial / Growth toggle** — only renders on the three dashboards now. *Validate:* visit Admin pages → toggle is gone.

#### Overview · Comments

- **Per-section icons** — chat-bubble next to each section title; click opens a popover anchored below. *Validate:* hover any section title.
- **Empty-state icon** — empty sections show a faded "+ chat bubble" that fades in on hover. *Validate:* hover a section with no comments.
- **Client picker** — typeahead search box matching the dashboards' "Search clients..." filter. *Validate:* click `+ Add comment` and start typing a client name.
- **Notion-style timestamps** — `now / 42m / 2h / 10:42 AM / Yesterday / May 8 / May 8, 2024`. Hover shows full date. *Validate:* hover any timestamp.
```

### Reference

If the user asks "remember how I want the Notion format," cite this
SKILL.md `Step 8 — Format rules`. The three rules that matter most:

1. **One line per bullet, with a *Validate:* clause.** This is the
   single hardest rule to internalise — earlier drafts ran 2–4 lines
   per bullet and felt like a wall. One line + click path.
2. **UX label, not code label.** "Rich-text composer" beats "Tiptap
   editor". "Monthly grid" beats "ClientDetailPopover goals variant".
3. **No tech leak.** If the reader needs to know what a "stacking
   context" or "upsert key" is to understand the bullet, rewrite it.

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
