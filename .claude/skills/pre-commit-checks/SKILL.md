---
name: commit
description: |
  Run all CI checks (lint, typecheck, tests, security scan) then commit.
  Use this skill when:
  (1) User types /commit
  (2) User asks to "commit", "commit changes", "make a commit"
  (3) User asks to commit code in any way
  Triggers: "commit", "commit changes", "commit this", "make a commit", "create a commit"
---

# Pre-Commit Checks & Commit

Run the full CI pipeline locally before committing to prevent deployment failures.
This skill runs documentation validation, lint, format check, type checking, tests, and a security scan — then creates the commit only if everything passes.

## Step 1: Check What Changed

Run from the **repository root**:

```bash
git status
git diff --stat
```

If there are no changes to commit, inform the user and stop.

## Step 2: Documentation Validation

Before any code checks, verify that project documentation reflects the current changes.
This prevents documentation drift where code ships without updated docs.

### What to check

Discover all documentation files dynamically — don't rely on a fixed list:

```bash
# Find all CLAUDE.md and README.md files in the project (skip hidden dirs, deps, and build artifacts)
find . \( -path '*/.*' -o -path '*/node_modules' -o -path '*/.venv' -o -path '*/dist' -o -path '*/__pycache__' \) -prune -o \( -name 'CLAUDE.md' -o -name 'README.md' \) -print | sort
```

This ensures:
- Newly added docs (e.g., a `CLAUDE.md` in a new subdirectory) are automatically included
- Hidden directories (`.elasticbeanstalk`, `.platform`, `.github`, `.claude`, etc.) are excluded
- Dependency/build directories (`node_modules`, `.venv`, `dist`, `__pycache__`) are excluded

### How to validate

1. **Discover and read all doc files** found by the search above
2. **Read the diff** (`git diff --cached` if staged, else `git diff`) to understand what changed
3. **Check for gaps** — specifically look for these categories of undocumented changes:

| Change Type | Where It Should Be Documented |
|-------------|-------------------------------|
| New service file in `backend/app/services/` | `backend/CLAUDE.md` → Services list |
| New API router in `backend/app/api/` | `backend/CLAUDE.md` → API router count, `backend/README.md` if major feature |
| New database model in `backend/app/database.py` | `backend/CLAUDE.md` → Key Database Models |
| New env var in `backend/app/config.py` | `CLAUDE.md` (root) → Environment Variables |
| New frontend component | `frontend/CLAUDE.md` → Key Files & Structure |
| New frontend hook | `frontend/CLAUDE.md` → Key Files & Structure |
| Changes to `frontend/lib/api.ts` types/functions | `frontend/CLAUDE.md` if significant new API surface |
| Changes to `backend/main.py` startup logic | `backend/CLAUDE.md` → Startup Logic |
| New major feature (new API module + service + frontend) | All relevant docs + `backend/README.md` dedicated section |
| Removed functionality | Remove from all docs that mention it |

4. **If docs are up to date**: Report "Documentation: Up to date" and proceed to Step 3
5. **If docs need updates**: Make the updates directly (these are non-protected files), then show the user what was updated before proceeding

### Documentation update rules

- Keep descriptions concise — match the style and depth of existing entries
- Don't add implementation details that can be derived from code (file paths, line numbers)
- For new features: add a one-line entry in the relevant list, and a dedicated section in `backend/README.md` only if it's a major feature (new API module + service + tests)
- For removed features: delete mentions from all docs, don't leave "removed X" comments
- Update counts (e.g., "15 API routers" → "16 API routers") when routers are added/removed
- Don't update `README.md` (root) or `frontend/README.md` for minor backend-only changes
- Each doc file has its own scope — update the doc(s) closest to the changed code (e.g., a backend service change goes in `backend/CLAUDE.md`, not `frontend/README.md`)
- If a new directory has its own `CLAUDE.md` or `README.md`, treat it as the authoritative doc for that directory's contents

## Step 3: Backend Checks (if backend files changed)

If any files under `backend/` are staged or modified, run these checks **sequentially** from `backend/`:

### 3a. Lint

```bash
cd backend && source .venv/bin/activate && uv run ruff check .
```

If it fails:
- Show the errors to the user
- Offer to auto-fix with `uv run ruff check . --fix`
- Re-run the check after fixing

### 3b. Format Check

```bash
cd backend && source .venv/bin/activate && uv run ruff format --check .
```

If it fails (files would be reformatted):
- Auto-fix by running `uv run ruff format .`
- Show which files were reformatted
- Re-run the check to confirm it passes

### 3c. Type Check

```bash
cd backend && source .venv/bin/activate && uv run mypy .
```

If it fails:
- Show the errors
- Offer to fix them (type annotation issues, wrong imports, etc.)
- Re-run after fixing

### 3d. Tests

```bash
cd backend && source .venv/bin/activate && uv run pytest -v
```

If tests fail:
- Show the failures
- Offer to fix the failing tests or the code causing failures
- Re-run after fixing

## Step 4: Security Scan

Run from the **repository root** (covers both backend and frontend):

```bash
semgrep scan --error --config auto --json 2>/dev/null
```

Use a 5-minute timeout. If semgrep is not installed, warn the user and skip this step (don't block the commit).

If findings exist:
- Parse JSON output and group by severity (ERROR > WARNING > INFO)
- Show file:line, rule, severity, issue, and offending code for each finding
- Ask user: **Fix all**, **Skip** (proceed anyway), or **Abort**
- If fixing, re-scan after fixes (max 3 iterations)

## Step 5: Commit

Only reach this step if all checks pass (or user chose to skip security findings).

1. Stage the relevant files (prefer specific files over `git add -A`)
2. Draft a concise commit message summarizing the changes
3. Show the message to the user for approval
4. Create the commit — do NOT include a Co-Authored-By line unless the user explicitly asks

## Results Summary

After all steps, show a summary table:

| Check | Result |
|-------|--------|
| Documentation | Up to date / Updated (N files) / Skipped |
| Lint (`ruff check`) | Passed / Fixed / Skipped |
| Format (`ruff format`) | Passed / Fixed / Skipped |
| Types (`mypy`) | Passed / Fixed / Skipped |
| Tests (`pytest`) | Passed (N tests) / Fixed / Skipped |
| Security (`semgrep`) | Passed / N findings / Skipped |
| Commit | Created (hash) / Aborted |

## Important Notes

- Always run checks from the correct directory (`backend/` for Python checks, repo root for semgrep)
- Use `.venv` for all backend commands — the project uses Python 3.12, not the system Python
- Never push automatically — only commit. The user decides when to push.
- If checks reveal issues that require significant refactoring, inform the user and let them decide how to proceed rather than making large changes autonomously
- Do NOT modify protected files (`.elasticbeanstalk`, `.platform`, `docker-compose.yml`, Dockerfiles, `proxy/`, `scripts/`)
