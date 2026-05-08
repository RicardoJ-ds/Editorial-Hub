---
name: release
description: |
  Cut a new release: bump version, refresh the changelog + docs, run the full
  CI pipeline, commit, tag, and push. End-to-end version-shipping workflow
  that wraps the existing `pre-commit-checks` skill with the version-bump
  procedure.

  Use this skill when:
  (1) User types /release
  (2) User asks to "ship", "cut a release", "release this round", "do the
      whole shipping workflow", "update version + commit + push"
  Triggers: "release", "ship", "cut release", "release round",
            "version bump and ship", "shipping workflow"

  Stops short of pushing the tag without explicit confirmation — the user's
  feedback memory `feedback_version_bump.md` rule #5.
---

# Release Workflow

End-to-end shipping workflow for the Editorial Hub. Wraps version bump +
documentation update + pre-commit-checks + commit + tag + push.

## Step 0 — Sanity check

Run from the repository root:

```bash
git status
git log --oneline -5
cat frontend/src/lib/version.ts | grep VERSION
```

If the working tree is clean (nothing to commit), inform the user and stop —
nothing to release.

## Step 1 — Determine the version bump

Read the rules from the user's memory file
`~/.claude/projects/-Users-ricardo-python-editorial-hub/memory/feedback_version_bump.md`
if present. The default is **PATCH** bump (e.g. `0.3.5 → 0.3.6`).

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

Tell the user the proposed version and the reason. If PHASE/1.0 bump,
**stop and wait for confirmation** before continuing.

## Step 2 — Update the four version surfaces

Update **all of these in the same commit**:

1. `frontend/src/lib/version.ts` — the `VERSION` constant.
2. `CLAUDE.md` (root) — the "Current version" line at the top.
3. `CHANGELOG.md` — add a new top section under the `## X.Y.Z — <date>`
   heading. **Plain-language** for stakeholders, mirroring the style of
   the existing entries. Group changes by feature area, not by file.
4. Sidebar version chip reads from `version.ts` automatically — no edit.

Generating the changelog body:
- Run `git log --oneline <previous-tag>..HEAD` and `git diff --stat
  <previous-tag>..HEAD` to see what shipped.
- For uncommitted local work in this round, also include the local diff.
- Group by user-facing feature area (Access Control, Pod axis, Overview,
  Sync, etc.). Keep technical jargon out — write for the Editorial Ops
  team and stakeholders.

## Step 3 — Update other documentation

Discover all CLAUDE.md / AGENTS.md / README.md files dynamically:

```bash
find . \( -path '*/.*' -o -path '*/node_modules' -o -path '*/.venv' \
        -o -path '*/dist' -o -path '*/__pycache__' \) -prune -o \
       \( -name 'CLAUDE.md' -o -name 'AGENTS.md' -o -name 'README.md' \) \
       -print | sort
```

For each doc, scan the diff and check for gaps. Use the same gap rules as
the `pre-commit-checks` skill. Update concisely — match existing style,
don't over-explain.

## Step 4 — Run the CI pipeline

Invoke the `pre-commit-checks` skill (or run the same steps inline if
called from a parent agent). Required gates:

1. Lint: `cd backend && uv run ruff check .`
2. Format: `cd backend && uv run ruff format --check .` (auto-fix if needed)
3. Types (backend): `cd backend && uv run mypy .`
4. Types (frontend): `cd frontend && npx tsc --noEmit`
5. Tests: `cd backend && uv run pytest -q`
6. Security: `semgrep scan --error --config auto --json --quiet` from repo
   root, 5-minute timeout, 0 findings expected. Skip with a warning if
   semgrep isn't installed.

Stop and surface any failures. Don't auto-fix lint or format issues
without showing the user what was fixed.

## Step 5 — Commit

Stage all relevant files (prefer specific paths over `git add -A`).
Commit with a subject line in the format:

```
X.Y.Z — <short summary of the round>
```

(e.g. `0.3.5 — Access Control granular edit role + matrix UX + pod-axis fully wired`)

The body lists the 3–6 highest-impact changes, one per line, dash-prefixed.
**Do NOT include `Co-Authored-By` lines** — see `feedback_no_coauthor.md`.

The commit subject MUST start with the version in the same format as
`version.ts`. Don't invent shorthand like `v0.5` or `version 0.3.5`.

## Step 6 — Annotated tag

```bash
git tag -a vX.Y.Z -m "<same subject as the commit>"
```

Always annotated, never lightweight.

## Step 7 — Push branch + ask before pushing tag

```bash
git push origin main      # branch first, no confirmation
git push origin vX.Y.Z    # tag — ASK THE USER FIRST
```

Per `feedback_version_bump.md` rule #5, the tag push waits for explicit
"go" / "yes" / "push the tag" from the user. Pushing branch is fine —
that's where Vercel + Railway redeploy from.

## Step 8 — Report

Show the user:

1. Full release table (version, commit hash, tag, files touched).
2. The new CHANGELOG section as a copy-paste-ready block (so they can
   share it directly in Notion or Slack).
3. A reminder that the tag will only push to origin after they confirm.

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
| Tag | `vX.Y.Z` created locally |
| Push (branch) | Pushed to `origin/main` |
| Push (tag) | **Awaiting user confirmation** |

## Important notes

- Never push `--force` to `main` or `--force` a tag. Tags should be
  immutable once pushed.
- Never skip hooks (`--no-verify`).
- Never amend a commit that's already been pushed. If a fix is needed
  post-push, create a follow-up commit and a `vX.Y.(Z+1)` patch tag.
- If the user says "no" to PHASE bump confirmation, fall back to PATCH.
- If `pre-commit-checks` reports failures that need significant
  refactoring, stop and let the user decide rather than auto-fixing.
