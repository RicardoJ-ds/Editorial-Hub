"""Generate the BQ schema catalog for the downstream planning-hub.

Introspects the LIVE `graphite-data.graphite_bi_sandbox` dataset (the editorial
warehouse) and emits two artifacts that give the editorial-team-pods planning
Hub a current, accurate picture of what it can read:

  * ``etl/bq_schema_catalog.json`` — machine-readable inventory
    (one entry per table/view: name, type, family, grain, columns, row_count,
    synced_at freshness).
  * ``etl/bq_schema_catalog.md``   — human-readable, grouped raw / int / views.

It then copies BOTH into the sibling planning-hub repo's ``docs/`` folder so the
Hub always ships with a fresh catalog.

Design notes
------------
* **Standalone.** Unlike the rest of ``etl/`` this script does NOT import the
  ``app`` package or touch Postgres — it only needs BigQuery + the SA key, so it
  runs directly with the repo venv (``.venv/bin/python``) without Docker.
* **Grain is sourced from the build code, not guessed.** ``GRAIN`` below mirrors
  ``etl/warehouse/build.py`` (RAW_TABLES / INT specs) and ``views.py`` — the
  single source of truth for what the warehouse publishes. When BQ is
  unreachable the script still emits a catalog seeded from this map (columns +
  live counts omitted, clearly flagged).
* **Cheap.** ``COUNT(*)`` on a native table is metadata-only (0 bytes billed);
  column types come from ``INFORMATION_SCHEMA.COLUMNS`` in one query.

Run (from the repo root):
    .venv/bin/python -m etl.gen_bq_schema_catalog
    .venv/bin/python -m etl.gen_bq_schema_catalog --no-sync   # skip the copy
    .venv/bin/python -m etl.gen_bq_schema_catalog --no-counts # skip row counts
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path

# ──────────────────────────────────────────────────────────────────────────────
# Config — mirrors backend/app/config.py defaults; overridable via env so this
# stays runnable outside the container.
# ──────────────────────────────────────────────────────────────────────────────
BQ_PROJECT = os.environ.get("BQ_PROJECT", "graphite-data")
BQ_DATASET = os.environ.get("BQ_DATASET", "graphite_bi_sandbox")
DS = f"{BQ_PROJECT}.{BQ_DATASET}"

# Tables PUBLISHED BY the planning-hub app (editorial-team-pods → sync-to-bq.ts),
# not by this repo's ETL. Covered in both catalogs so cross-Hub contracts are
# visible (Q2 of handoff_planning_hub_client_table_sync_review.md). Contract doc:
# editorial-team-pods/docs/capacity-plan-contract.md. `_dev` copies excluded.
HUB_PUBLISHED = (
    "editorial_capacity_plan",
    "editorial_capacity_plan_demand",
    "editorial_capacity_plan_members",
    "editorial_writer_plan",
    "editorial_writer_plan_allocations",
    "editorial_writer_plan_client_verticals",
    "editorial_writer_plan_verticals",
    "team_pod_assignments",
    "team_pod_assignments_editorial",
    "team_pod_assignments_editorial_history",
    # Cross-hub table the EDITORIAL hub now PUBLISHES (daily @writer-desired
    # step) and the planning hub READS — direction is EH → PH, unlike the rest.
    "editorial_writer_desired",
)

# The editorial warehouse surface (matches the build source's naming) + the
# planning-hub-published tables above.
_HUB_IN = ", ".join(f"'{t}'" for t in HUB_PUBLISHED)
TABLE_FILTER = (
    "table_name LIKE 'editorial_raw_%' OR table_name LIKE 'editorial_int_%' "
    f"OR table_name LIKE 'v_editorial_%' OR table_name IN ({_HUB_IN})"
)

REPO_ROOT = Path(__file__).resolve().parent.parent  # editorial-hub/
OUT_JSON = REPO_ROOT / "etl" / "bq_schema_catalog.json"
OUT_MD = REPO_ROOT / "etl" / "bq_schema_catalog.md"

# Sibling planning-hub repo (local). Overridable if the checkout moves.
PLANNING_HUB_DOCS = Path(
    os.environ.get(
        "PLANNING_HUB_DOCS",
        str(REPO_ROOT.parent / "editorial-team-pods" / "docs"),
    )
)

# ──────────────────────────────────────────────────────────────────────────────
# Grain map — SINGLE SOURCE for family + grain + one-line purpose. Kept in sync
# with etl/warehouse/build.py (RAW_TABLES / INT_* specs) and views.py. Any name
# NOT listed here still appears in the catalog (family inferred from the prefix,
# grain = "—"), so newly added-but-undocumented objects are visible, not hidden.
# ──────────────────────────────────────────────────────────────────────────────
GRAIN: dict[str, dict[str, str]] = {
    # ── RAW (faithful mirrors of the source sheets / Neon models) ────────────
    "editorial_raw_clients": {
        "grain": "one row per client",
        "note": "client master + SF identity + pods",
    },
    "editorial_raw_deliverables": {
        "grain": "client × month",
        "note": "delivered / invoiced / sow_target per month",
    },
    "editorial_raw_production": {
        "grain": "client × month",
        "note": "actual vs projected article production",
    },
    "editorial_raw_goals": {
        "grain": "client × month × week × content_type",
        "note": "goals-vs-delivery weekly rows",
    },
    "editorial_raw_cumulative": {
        "grain": "one row per client",
        "note": "lifetime pipeline counters (topics/CBs/articles/published)",
    },
    "editorial_raw_capacity": {
        "grain": "pod × month × version",
        "note": "capacity projection inputs",
    },
    "editorial_raw_capacity_members": {
        "grain": "member × month",
        "note": "per-member capacity inputs",
    },
    "editorial_raw_client_pod_history": {
        "grain": "client × month",
        "note": "historical editorial-pod assignment per client",
    },
    "editorial_raw_articles": {
        "grain": "article × editor",
        "note": "article log; collaborations explode per editor",
    },
    "editorial_raw_article_revisions": {
        "grain": "one row per revision",
        "note": "revision events",
    },
    "editorial_raw_calendar": {
        "grain": "year × month × week",
        "note": "editorial calendar weeks",
    },
    "editorial_raw_kpi_scores": {
        "grain": "member × month × kpi_type",
        "note": "KPI scores vs target",
    },
    "editorial_raw_ai_monitoring": {
        "grain": "one row per monitored article",
        "note": "AI compliance monitoring records",
    },
    "editorial_raw_surfer_usage": {
        "grain": "Surfer API usage rows",
        "note": "Surfer SEO API usage",
    },
    "editorial_raw_team_members": {
        "grain": "one row per team member",
        "note": "roster (name, role, pod, capacity, email)",
    },
    "editorial_raw_delivery_templates": {
        "grain": "delivery template rows",
        "note": "pacing templates (fetched, currently unrendered)",
    },
    "editorial_raw_pod_history": {
        "grain": "year × month × kind × pod × client × role × person",
        "note": "raw per-month staffing history (editorial + growth)",
    },
    "editorial_raw_model_assumptions": {
        "grain": "model assumption rows",
        "note": "always-on capacity model assumptions",
    },
    "editorial_raw_name_mappings": {
        "grain": "kind × raw_name",
        "note": "editor/writer/client name → canonical dictionary",
    },
    # ── INT (business math computed here — the intermediate values) ──────────
    "editorial_int_client_months": {
        "grain": "client × month",
        "note": "the variance brain: delivered/invoiced/sow + Overview & D1 period assignment",
    },
    "editorial_int_client_q_snapshot": {
        "grain": "one row per client",
        "note": "lifetime + current-Q + last-full-Q variance on both Overview & D1 paths",
    },
    "editorial_int_goals_month_ct": {
        "grain": "client × month × content_type",
        "note": "weighted goals after max-of-week + contentTypeRatio",
    },
    "editorial_int_capacity_pod_months": {
        "grain": "pod × month × version",
        "note": "pod capacity mart (total / projected-used / actual-used)",
    },
    "editorial_int_member_months": {
        "grain": "member × month",
        "note": "member utilization mart",
    },
    "editorial_int_client_pod_months": {
        "grain": "client × pod × month",
        "note": "client contribution mart",
    },
    "editorial_int_articles_creation": {
        "grain": "editor × client × creation-month",
        "note": "monthly articles mart (editor credit)",
    },
    "editorial_int_articles_revisions": {
        "grain": "revision × month",
        "note": "monthly revisions mart",
    },
    "editorial_int_pod_assignments": {
        "grain": "year × month × kind × pod × client × role × person",
        "note": "resolved per-month staffing (editorial + growth) — the backfill surface",
    },
    # ── VIEWS (the public read contract — consumers read these) ──────────────
    "v_editorial_dim_client": {
        "grain": "one row per client",
        "note": "client master + SF identity (public)",
    },
    "v_editorial_dim_member": {"grain": "one row per member", "note": "roster dim"},
    "v_editorial_roster": {
        "grain": "one row per person × role",
        "note": "single-source editorial roster (Rippling editors + Slack writers + legacy); carries canonical work_email — DISPLAY this, key on canonical_name/slack_id",
    },
    "v_editorial_dim_calendar": {
        "grain": "year × month × week",
        "note": "calendar dim",
    },
    "v_editorial_fct_client_q_snapshot": {
        "grain": "one row per client",
        "note": "delivery/variance snapshot (Overview + D1)",
    },
    "v_editorial_fct_client_months": {
        "grain": "client × month",
        "note": "per-month delivery/variance detail",
    },
    "v_editorial_fct_pod_snapshot": {
        "grain": "pod_axis × pod",
        "note": "Overview Pod Snapshot rollup, both pod axes",
    },
    "v_editorial_fct_goals_monthly": {
        "grain": "client × month × content_type",
        "note": "weighted goals (raw + weighted measures)",
    },
    "v_editorial_fct_goals_client_totals": {
        "grain": "one row per client",
        "note": "goal totals gated on weighted goal > 0",
    },
    "v_editorial_fct_production_monthly": {
        "grain": "client × month",
        "note": "production actual vs projected + pods",
    },
    "v_editorial_fct_pipeline": {
        "grain": "one row per client",
        "note": "pipeline counters (topics/CBs/articles/published)",
    },
    "v_editorial_fct_milestone_transitions": {
        "grain": "client × transition",
        "note": "8 milestone transitions, calendar-day diffs",
    },
    "v_editorial_fct_kpi_scores": {
        "grain": "member × month × kpi_type",
        "note": "KPI scores + member/role/pod",
    },
    "v_editorial_fct_pod_assignments": {
        "grain": "year × month × pod × client × role × person",
        "note": "resolved editorial-only per-month staffing",
    },
    "v_editorial_fct_capacity_pods": {
        "grain": "pod × month × version",
        "note": "pod capacity (public)",
    },
    "v_editorial_fct_member_utilization": {
        "grain": "member × month",
        "note": "member utilization (public)",
    },
    "v_editorial_fct_client_contributions": {
        "grain": "client × pod × month",
        "note": "client contribution (public)",
    },
    "v_editorial_fct_articles_monthly": {
        "grain": "editor × client × creation-month",
        "note": "monthly articles (editorial-month basis)",
    },
    "v_editorial_fct_article_revisions": {
        "grain": "revision × month",
        "note": "monthly revisions (each revision's own month)",
    },
    "v_editorial_fct_ai_recommendations": {
        "grain": "pod × client × writer × editor × month",
        "note": "AI recommendation counts (rewrites excluded)",
    },
    "v_editorial_fct_ai_flagged": {
        "grain": "one row per flagged/rewrite article",
        "note": "AI flagged / rewrite records",
    },
    # ── HUB-PUBLISHED (written by editorial-team-pods, NOT this ETL) ──────────
    "editorial_capacity_plan": {
        "grain": "ym × pod",
        "note": "published capacity plan: supply, projected/actual demand, utilization",
    },
    "editorial_capacity_plan_demand": {
        "grain": "ym × pod × client_id (NEGATIVE ids = planned/unsigned clients)",
        "note": "published per-client demand incl. Hub edits (note/status_override); joins on client_id drop planned rows",
    },
    "editorial_capacity_plan_members": {
        "grain": "ym × pod × member",
        "note": "published per-member capacity (base + effective)",
    },
    "editorial_writer_plan": {
        "grain": "ym × writer",
        "note": "published writer bandwidth plan (computed/override/effective bw, allocated, delivered)",
    },
    "editorial_writer_plan_allocations": {
        "grain": "ym × writer × client",
        "note": "published writer→client article allocations",
    },
    "editorial_writer_plan_client_verticals": {
        "grain": "one row per client",
        "note": "client vertical tags for writer matching",
    },
    "editorial_writer_plan_verticals": {
        "grain": "writer × vertical",
        "note": "writer vertical skills/difficulty",
    },
    "team_pod_assignments": {
        "grain": "one row per assignment (growth, current)",
        "note": "growth Team-tab current assignments",
    },
    "team_pod_assignments_editorial": {
        "grain": "one row per assignment (editorial, current)",
        "note": "editorial Team-tab current assignments",
    },
    "team_pod_assignments_editorial_history": {
        "grain": "ym × pod × client × role × person (soft-delete via deleted_at)",
        "note": "canonical editorial assignment history — the Hub-first source this ETL reads (people-loop cutover 2026-06-12)",
    },
    "editorial_writer_desired": {
        "grain": "writer × ym (latest submission wins)",
        "note": "writers' self-reported desired article total (Google Form) — published by EH's daily @writer-desired step, read by PH getWriterDesired() as the Writers-model capacity basis",
    },
}


def _family(name: str) -> str:
    if name.startswith("v_editorial_"):
        return "views"
    if name.startswith("editorial_int_"):
        return "int"
    if name.startswith("editorial_raw_"):
        return "raw"
    if name in HUB_PUBLISHED:
        return "hub"
    return "other"


FAMILY_ORDER = {"raw": 0, "int": 1, "views": 2, "hub": 3, "other": 4}
FAMILY_TITLE = {
    "raw": "RAW — source-sheet mirrors (`editorial_raw_*`)",
    "int": "INT — computed intermediates (`editorial_int_*`)",
    "views": "VIEWS — public read contract (`v_editorial_*`)",
    "hub": "HUB-PUBLISHED — written by the planning-hub app, not this ETL",
    "other": "OTHER",
}


# ──────────────────────────────────────────────────────────────────────────────
# BigQuery introspection
# ──────────────────────────────────────────────────────────────────────────────
def _get_bq():
    """Standalone BQ client — SA key resolved the same way as
    backend/app/services/google_auth.py, but WITHOUT importing app."""
    from google.cloud import bigquery
    from google.oauth2 import service_account

    scopes = ["https://www.googleapis.com/auth/bigquery"]
    b64 = os.environ.get("GOOGLE_SERVICE_ACCOUNT_KEY")
    if b64:
        import base64

        info = json.loads(base64.b64decode(b64))
        creds = service_account.Credentials.from_service_account_info(
            info, scopes=scopes
        )
    else:
        candidates = [
            os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", ""),
            str(REPO_ROOT / "sa-key.json"),
            os.path.join(os.getcwd(), "sa-key.json"),
            "/app/sa-key.json",
        ]
        sa_path = next((p for p in candidates if p and os.path.isfile(p)), None)
        if sa_path is None:
            raise FileNotFoundError(f"Cannot find SA key file. Tried: {candidates}")
        creds = service_account.Credentials.from_service_account_file(
            sa_path, scopes=scopes
        )
    return bigquery.Client(project=BQ_PROJECT, credentials=creds)


def introspect(with_counts: bool = True) -> list[dict]:
    """Return the live inventory. Raises on connection failure (caller decides
    whether to fall back to the seed catalog)."""
    bq = _get_bq()
    location = bq.get_dataset(DS).location  # INFORMATION_SCHEMA queries need it

    def q(sql: str):
        return bq.query(sql, location=location).result()

    # 1) table/view inventory
    objects: dict[str, str] = {}
    for r in q(
        f"SELECT table_name, table_type FROM `{DS}.INFORMATION_SCHEMA.TABLES` "
        f"WHERE {TABLE_FILTER} ORDER BY table_name"
    ):
        objects[r.table_name] = "VIEW" if r.table_type == "VIEW" else "TABLE"

    # 2) columns (one query for the whole dataset slice)
    cols: dict[str, list[dict]] = {name: [] for name in objects}
    for r in q(
        f"SELECT table_name, column_name, data_type FROM `{DS}.INFORMATION_SCHEMA.COLUMNS` "
        f"WHERE {TABLE_FILTER} ORDER BY table_name, ordinal_position"
    ):
        if r.table_name in cols:
            cols[r.table_name].append({"name": r.column_name, "type": r.data_type})

    # 3) row counts + freshness (COUNT(*) on a table is metadata-only / 0 bytes)
    counts: dict[str, int | None] = {}
    freshness: dict[str, str | None] = {}
    if with_counts:
        for name in objects:
            counts[name] = None
            freshness[name] = None
            has_synced = any(c["name"] == "synced_at" for c in cols.get(name, []))
            select = "COUNT(*) AS n" + (
                ", MAX(synced_at) AS fresh" if has_synced else ""
            )
            try:
                row = list(q(f"SELECT {select} FROM `{DS}.{name}`"))[0]
                counts[name] = int(row.n)
                if has_synced and row.fresh is not None:
                    freshness[name] = row.fresh.isoformat()
            except Exception as exc:  # noqa: BLE001 — one bad object shouldn't sink the run
                print(f"  ! count failed for {name}: {type(exc).__name__}: {exc}")

    catalog = []
    for name, typ in objects.items():
        g = GRAIN.get(name, {})
        catalog.append(
            {
                "name": name,
                "type": typ,
                "family": _family(name),
                "grain": g.get("grain", "—"),
                "note": g.get("note", ""),
                "columns": cols.get(name, []),
                "row_count": counts.get(name),
                "synced_at": freshness.get(name),
            }
        )
    return catalog


def seed_catalog() -> list[dict]:
    """Fallback when BQ is unreachable: emit what the build source declares
    (no live columns / counts). Flagged in the artifacts so it's obvious."""
    out = []
    for name, g in GRAIN.items():
        out.append(
            {
                "name": name,
                "type": "VIEW" if name.startswith("v_editorial_") else "TABLE",
                "family": _family(name),
                "grain": g.get("grain", "—"),
                "note": g.get("note", ""),
                "columns": [],
                "row_count": None,
                "synced_at": None,
            }
        )
    return out


# ──────────────────────────────────────────────────────────────────────────────
# Emit
# ──────────────────────────────────────────────────────────────────────────────
def _sorted(catalog: list[dict]) -> list[dict]:
    return sorted(catalog, key=lambda e: (FAMILY_ORDER.get(e["family"], 9), e["name"]))


def write_json(catalog: list[dict], generated_at: str, live: bool) -> None:
    payload = {
        "dataset": DS,
        "generated_at": generated_at,
        "source": "live BigQuery INFORMATION_SCHEMA"
        if live
        else "SEED (BQ unreachable — from build.py/views.py)",
        "counts": {
            "tables": sum(1 for e in catalog if e["type"] == "TABLE"),
            "views": sum(1 for e in catalog if e["type"] == "VIEW"),
            "columns": sum(len(e["columns"]) for e in catalog),
        },
        "objects": _sorted(catalog),
    }
    OUT_JSON.write_text(json.dumps(payload, indent=2) + "\n")


def _key_columns(cols: list[dict], limit: int = 8) -> str:
    """A scannable subset — id/name/key/pod/date/count columns first, then fill."""
    if not cols:
        return "—"
    names = [c["name"] for c in cols]
    priority = [
        n
        for n in names
        if any(
            k in n
            for k in (
                "id",
                "name",
                "pod",
                "year",
                "month",
                "date",
                "kind",
                "role",
                "status",
                "person",
            )
        )
        and n != "synced_at"
    ]
    rest = [n for n in names if n not in priority and n != "synced_at"]
    picked = (priority + rest)[:limit]
    suffix = (
        " …" if len(names) - (1 if "synced_at" in names else 0) > len(picked) else ""
    )
    return "`" + "`, `".join(picked) + "`" + suffix


def write_md(catalog: list[dict], generated_at: str, live: bool) -> None:
    tables = sum(1 for e in catalog if e["type"] == "TABLE")
    views = sum(1 for e in catalog if e["type"] == "VIEW")
    columns = sum(len(e["columns"]) for e in catalog)

    lines: list[str] = []
    lines.append(
        "# BQ schema catalog — `graphite-data.graphite_bi_sandbox` (editorial warehouse)"
    )
    lines.append("")
    lines.append(
        "**Auto-generated** by `etl/gen_bq_schema_catalog.py` — do not hand-edit. "
        "Re-run after adding/renaming a table or view in `etl/warehouse/build.py` / `views.py`."
    )
    lines.append("")
    lines.append(f"- **Dataset:** `{DS}` (everything is `{DS}.<name>`)")
    lines.append(f"- **Generated:** {generated_at}")
    src = (
        "live BigQuery `INFORMATION_SCHEMA`"
        if live
        else "⚠️ **SEED** — BQ was unreachable; columns & counts omitted, grains from build source"
    )
    lines.append(f"- **Source:** {src}")
    lines.append(
        f"- **Inventory:** {tables} tables · {views} views · {columns} columns"
    )
    lines.append("")
    lines.append(
        "> **Read the `v_editorial_*` views** for anything with business math applied "
        "(variance, weighting, utilization). `editorial_raw_*` = faithful sheet mirrors; "
        "`editorial_int_*` = where the math is computed (the intermediate values a capacity "
        "model wants). Every published row carries `synced_at` (the publish timestamp)."
    )
    lines.append("")

    by_family: dict[str, list[dict]] = {}
    for e in _sorted(catalog):
        by_family.setdefault(e["family"], []).append(e)

    for fam in sorted(by_family, key=lambda f: FAMILY_ORDER.get(f, 9)):
        entries = by_family[fam]
        lines.append(f"## {FAMILY_TITLE.get(fam, fam)}")
        lines.append("")
        header = "| Name | Grain | Rows | Fresh (synced_at) | Purpose / key columns |"
        sep = "|---|---|---:|---|---|"
        lines.append(header)
        lines.append(sep)
        for e in entries:
            rows = "—" if e["row_count"] is None else f"{e['row_count']:,}"
            fresh = "—"
            if e["synced_at"]:
                fresh = e["synced_at"].replace("T", " ").split(".")[0] + " UTC"
            purpose = e["note"] or ""
            keycols = _key_columns(e["columns"])
            detail = purpose
            if keycols != "—":
                detail = f"{purpose}<br>{keycols}" if purpose else keycols
            lines.append(
                f"| `{e['name']}` | {e['grain']} | {rows} | {fresh} | {detail} |"
            )
        lines.append("")

    lines.append("---")
    lines.append("")
    lines.append(
        "*Companion: `etl/handoff_planning_hub_capacity_data.md` (consumer guide with SQL "
        "recipes) and `etl/WAREHOUSE_DESIGN.md` (design + bug register). Grain/family come "
        "from `etl/warehouse/build.py` + `views.py`; columns/counts/freshness are live from BQ.*"
    )
    OUT_MD.write_text("\n".join(lines) + "\n")


def sync_to_planning_hub() -> list[str]:
    """Copy both artifacts into the sibling planning-hub docs/ folder."""
    if not PLANNING_HUB_DOCS.exists():
        print(
            f"  ! planning-hub docs dir not found: {PLANNING_HUB_DOCS} — skipping sync"
        )
        return []
    copied = []
    for src in (OUT_JSON, OUT_MD):
        dst = PLANNING_HUB_DOCS / src.name
        shutil.copyfile(src, dst)
        copied.append(str(dst))
    return copied


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Generate the BQ schema catalog for the planning-hub."
    )
    ap.add_argument(
        "--no-sync",
        action="store_true",
        help="don't copy artifacts into the planning-hub docs/ folder",
    )
    ap.add_argument(
        "--no-counts", action="store_true", help="skip per-table row counts / freshness"
    )
    args = ap.parse_args()

    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

    live = True
    try:
        catalog = introspect(with_counts=not args.no_counts)
        if not catalog:
            raise RuntimeError("no editorial objects returned")
    except Exception as exc:  # noqa: BLE001 — fall back to the seed catalog
        print(f"⚠️  Live BQ introspection failed ({type(exc).__name__}: {exc}).")
        print(
            "    Emitting SEED catalog from build.py/views.py grain map (no live columns/counts)."
        )
        catalog = seed_catalog()
        live = False

    write_json(catalog, generated_at, live)
    write_md(catalog, generated_at, live)

    copied = [] if args.no_sync else sync_to_planning_hub()

    tables = sum(1 for e in catalog if e["type"] == "TABLE")
    views = sum(1 for e in catalog if e["type"] == "VIEW")
    columns = sum(len(e["columns"]) for e in catalog)
    print("─" * 60)
    print(f"BQ schema catalog {'(LIVE)' if live else '(SEED — BQ unreachable)'}")
    print(f"  {tables} tables · {views} views · {columns} columns")
    print(f"  → {OUT_JSON.relative_to(REPO_ROOT)}")
    print(f"  → {OUT_MD.relative_to(REPO_ROOT)}")
    for c in copied:
        print(f"  → synced: {c}")
    if not copied and not args.no_sync:
        print("  (planning-hub sync skipped)")


if __name__ == "__main__":
    main()
