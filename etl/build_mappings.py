"""Build the canonical name-mapping dictionaries (editors / clients / writers).

Combines three inputs:
  1. curated seed rules (the human decisions documented in NAME_MAPPINGS.md),
  2. the live distinct values in Postgres (so coverage is always complete —
     anything new since the last build lands as status="unresolved", never
     silently dropped),
  3. the canonical pulls from BigQuery (mappings/canonical_editors.json from
     the HR view, mappings/canonical_clients.json from Salesforce).

Outputs (all in etl/mappings/):
  editor_aliases.json   article-log editor name → HR employee_name
  client_aliases.json   Hub client name → Salesforce Client_Name (+ unmapped tabs)
  writer_aliases.json   article-log writer name → canonical writer
  MAPPINGS_SUMMARY.json coverage stats for the DaniQ report

Run inside the backend container:
    docker compose exec -T backend python -m etl.build_mappings
"""

from __future__ import annotations

import json
import os
import re
from collections import defaultdict
from datetime import date

from sqlalchemy import text

from app.config import settings
from app.database import make_sync_engine
from etl.util import norm_key, strip_member_annotations

MAPPINGS_DIR = os.path.join(os.path.dirname(__file__), "mappings")


# ---------------------------------------------------------------------------
# Curated seeds — the human layer. Every decision here is documented in
# NAME_MAPPINGS.md and surfaced in DATA_QUALITY_CAVEATS_for_DaniQ.md.
# ---------------------------------------------------------------------------

# article-log editor first name (normalized) → HR employee_name
EDITOR_CONFIRMED: dict[str, str] = {
    "alyssa": "Alyssa Zacharias",
    "bryan": "Bryan Clark",
    "chrissy": "Chrissy Woods",
    "elliot": "Elliot Gardner",
    "haley": "Haley Drucker",
    "jimmy": "Jimmy Bunes",
    "kennedy": "Kennedy Stevens",
    "lee": "Lee Anderson",
    "nina": "Nina Denison",
    "robert": "Robert Thorpe",
    "shivani": "Shivani Verma",
    "abby": "Abby Norwood",
    "anabelle": "Anabelle Zaluski",
    "chelsea": "Chelsea Erhard",
    "derrik": "Derrik Chinn",
    "derriik": "Derrik Chinn",  # typo
    "eesha": "Eesha Verma",
    "jared": "Jared Maguire",
    "katie": "Katie Shevlin",
    "kimberly": "Kimberly Pavlovich",
    "micki": "Micki Cottam",
    "nicholas": "Nicholas Youngblood",
    "shelby": "Shelby Talbot",
    "vince": "Vincent Lee",
    "maggie": "Maggie Gowland",
    "magggie": "Maggie Gowland",  # typo
    "magie": "Maggie Gowland",  # typo
    "tiffany": "Tiffany Anderson",
    # Confirmed via HR dates: Michael Doyle, Editor, employed 2023-03..2023-05 —
    # exactly the months "Mike" appears in the article log.
    "mike": "Michael Doyle",
    # DaniQ rule (2026-06-11): she renamed the new Lauren's entries to
    # "Lauren Keleher" in the sheet, so every remaining bare "Lauren" is the
    # first Lauren in headcount — Lauren Friar (Sr. Editor, since 2025-09-15).
    "lauren": "Lauren Friar",
}
# Resolved by Rippling tenure windows — one raw name, different people over
# time. Applied as date-windowed rows in article_name_aliases (valid_from/
# valid_to, 'YYYY-MM' inclusive); the importer picks by the article's month.
EDITOR_CONFIRMED_WINDOWED: dict[str, dict] = {
    "sam": {
        "windows": [
            {"to": "2026-01", "canonical": "Samantha McGrail"},
            {"from": "2026-02", "canonical": "Samantha Marceau"},
        ],
        "note": "Split by headcount dates: McGrail 2025-08-04→2026-01-27 "
        "(log shows Sam Aug 2025–Jan 2026, none Feb–Apr); Marceau "
        "2026-05-11→ (log resumes May 2026). Zero overlap.",
    },
}
# Two candidates each — needs a DaniQ split rule before the ETL applies one.
EDITOR_AMBIGUOUS: dict[str, dict] = {}
# 2022-era names that predate every people source (HR incl. terminated,
# pod sheets, AI monitoring, Notion). Need human memory or stay unmapped.
EDITOR_UNRESOLVED = ["kira", "kristin", "shain", "shalin"]
# Not people — markers/garbage in the editor column.
EDITOR_JUNK = ["^", "^^", "and", "83", "no edits"]

# Hub client name → Salesforce Client_Name. None = no SF account exists.
# Entries may be (name, status) to flag decisions; plain str = confirmed.
CLIENT_OVERRIDES: dict[str, tuple[str | None, str, str]] = {
    # (sf_name, status, note)
    "Meta BMG": ("Meta for Business", "confirmed", "auto-fuzzy had wrongly said Meta AI"),
    "Meta RL": ("Meta Reality Labs", "confirmed", "auto-fuzzy had wrongly said Meta AI"),
    "Meta Manus": (
        None,
        "dismissed",
        "DaniQ 2026-06-12: Meta domain never kicked off — remove, nothing to track",
    ),
    "ChatGPT": ("OpenAI", "confirmed", "DaniQ 2026-06-12: Ok"),
    "EarnIn B2C": (
        "EarnIn",
        "confirmed",
        "DaniQ 2026-06-12: keep split — classified as different clients; both → SF EarnIn",
    ),
    "Earnin B2B": (
        "EarnIn",
        "confirmed",
        "DaniQ 2026-06-12: keep split — classified as different clients; both → SF EarnIn",
    ),
    "Orderful (I)": (
        "Orderful",
        "confirmed",
        "DaniQ 2026-06-12: same SF account (left + came back). Ricardo 2026-06-12: KEEP SPLIT in Hub (like EarnIn B2B/B2C) — separate contract rows keep SOW/variance math correct; both → SF Orderful",
    ),
    "Orderful (II)": (
        "Orderful",
        "confirmed",
        "DaniQ + Ricardo 2026-06-12: keep split in Hub; both → SF Orderful",
    ),
    "Workleap + Sharegate": (
        "Workleap",
        "confirmed",
        "combined engagement; ShareGate has no SF account of its own",
    ),
    "Tempo XYZ": (
        "Tempo",
        "confirmed",
        "DaniQ 2026-06-12: Tempo XYZ IS Tempo (active). Old Tempo renamed → Tempo.io (inactive) in SF + article sheet tabs",
    ),
    "Engine": ("Hotel Engine", "confirmed", "DaniQ 2026-06-12: Ok"),
    "Landing": ("Hello Landing", "confirmed", "DaniQ 2026-06-12: Ok"),
    "GenstoreAI": ("Genstore", "confirmed", ""),
    "TaskRabbit": ("TaskRabbit Inc", "confirmed", "legal-entity suffix"),
    "Fishbowl": ("Fishbowl Inventory", "confirmed", ""),
    "Grindr": ("Grindr LLC", "confirmed", "legal-entity suffix"),
    "First Round Capital": (
        None,
        "confirmed_unlinked",
        "DaniQ 2026-06-12: leave unlinked (she asks: does FRC exist in SF? follow-up)",
    ),
    "Lenny": (None, "confirmed_unlinked", "DaniQ 2026-06-12: leave unlinked"),
    "Neeva": (None, "confirmed_unlinked", "DaniQ 2026-06-12: leave unlinked (defunct)"),
}

# Article-tab name → Hub client (proposals for tabs that exist in the Monthly
# Article Count sheet but don't match a Hub client). status indicates whether
# the ETL may apply it or DaniQ must decide first.
TAB_PROPOSALS: dict[str, tuple[str | None, str, str]] = {
    "Men's Warehouse": ("Men's Wearhouse", "proposed", "tab is misspelled"),
    "Orderful 2": ("Orderful (II)", "proposed", "phase-2 tab"),
    "Orderful": ("Orderful (I)", "proposed", "phase-1 tab"),
    "EarnIn": (None, "decision", "which Hub variant — B2C or B2B?"),
    "Athena2": (None, "decision", "second Athena engagement?"),
    "Neiman": ("Neiman Marcus", "proposed", "shorthand"),
    "Genstore": ("GenstoreAI", "proposed", "same client"),
    "ShareGate": ("Workleap + Sharegate", "proposed", "combined Hub client"),
    "FRC": ("First Round Capital", "proposed", "acronym"),
    "Workleap": ("Workleap + Sharegate", "applied", "alias already live in the Hub"),
}

# Writer variants we can resolve by hand (normalized variant → canonical).
# Also applied to the roster itself so dupes collapse (middle initials, ALL
# CAPS, email-derived display names).
WRITER_VARIANT_OVERRIDES: dict[str, str] = {
    "richard dezso": "Rich Dezso",
    "writer tim": "Tim Suleyman",
    "tessina grant moloney": "Tessina Grant",
    "tessina gm": "Tessina Grant",
    "sam mcgrail": "Samantha McGrail",
    "chelsea m oliver": "Chelsea Oliver",
    "aranyaknanda98": "Aranyak Nanda",
    "robert thorpe": "Robert Thorpe",
}
WRITER_ROSTER_JUNK = {"g | r | 0 accounts"}
WRITER_JUNK = {"", "-", "—", "n/a", "na", "no edits", "^", "^^", "tbd", "?"}
# Substrings that mark trial/audition writers — kept as status="trial".
WRITER_TRIAL_MARKERS = ("trial writer", "aud writer", "auditioning writer", "trial")


def _fetch_slack_writers() -> list[dict]:
    """Real writer roster from Slack — the source of truth Simón published in
    BigQuery `graphite_bi.slack_raw_users`. The writer contractors carry
    `@ext.writing.graphitehq.com` emails (real_name + email live in the `profile`
    JSON). ADDITIVE: this enriches the writer roster + supplies authoritative
    emails; the existing pod-sheet / first-name / variant-override / DaniQ layers
    are untouched. Falls back silently to the other sources if BQ is unreachable
    (offline build)."""
    rows: list[dict] = []
    try:
        from etl.load import get_bq

        bq = get_bq()
        for r in bq.query(
            "SELECT real_name, JSON_VALUE(profile,'$.email') AS email "
            "FROM `graphite-data.graphite_bi.slack_raw_users` "
            "WHERE COALESCE(deleted, FALSE) = FALSE AND COALESCE(is_bot, FALSE) = FALSE "
            "AND LOWER(JSON_VALUE(profile,'$.email')) LIKE '%writing.graphitehq.com'"
        ).result():
            if r["real_name"] and r["email"]:
                rows.append({"display_name": r["real_name"], "email": r["email"]})
    except Exception:
        pass
    return rows


def _load_canonical():
    with open(os.path.join(MAPPINGS_DIR, "canonical_editors.json")) as f:
        editors = json.load(f)["editors"]
    with open(os.path.join(MAPPINGS_DIR, "canonical_clients.json")) as f:
        clients = json.load(f)["clients"]
    # SF export carries literal "nan" strings — treat as null.
    for c in clients:
        for k, v in list(c.items()):
            if isinstance(v, str) and v.lower() == "nan":
                c[k] = None
    return editors, clients


def _client_key(name: str | None) -> str:
    """Alphanumeric-lower key for client matching — same idea as the
    importer's `_name_key`, so 'Dr Squatch' ↔ 'Dr. Squatch' and
    'ThredUp' ↔ 'Thred Up' match."""
    return re.sub(r"[^a-z0-9]", "", str(name or "").lower())


def _load_existing(name: str) -> dict:
    """Previously-built dictionary, so applied before→after pairs survive a
    rebuild (e.g. once writer aliases are applied at import, the raw variants
    disappear from the DB — the dictionary keeps them)."""
    path = os.path.join(MAPPINGS_DIR, name)
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return {}


def build(engine=None) -> dict:
    eng = engine or make_sync_engine(settings.database_url)
    hr_editors, sf_clients = _load_canonical()
    hr_by_name = {e["employee_name"]: e for e in hr_editors}
    sf_by_name = {c["Client_Name"]: c for c in sf_clients}
    sf_by_key = {_client_key(c["Client_Name"]): c for c in sf_clients}

    with eng.connect() as cx:
        ed_counts = dict(
            cx.execute(
                text("SELECT editor_name, COUNT(*) FROM article_records GROUP BY editor_name")
            ).all()
        )
        hub_clients = [
            dict(r._mapping)
            for r in cx.execute(
                text("SELECT name, editorial_pod, growth_pod, status FROM clients ORDER BY name")
            )
        ]
        unmapped_tabs = [
            dict(r._mapping)
            for r in cx.execute(
                text(
                    "SELECT raw_value, occurrences, resolved_at IS NOT NULL AS resolved "
                    "FROM article_unmapped_names WHERE kind='client' ORDER BY occurrences DESC"
                )
            )
        ]
        live_aliases = [
            dict(r._mapping)
            for r in cx.execute(
                text("SELECT kind, raw_value, canonical_value FROM article_name_aliases")
            )
        ]
        writer_counts = dict(
            cx.execute(
                text(
                    "SELECT writer_name, COUNT(*) FROM article_records "
                    "WHERE writer_name IS NOT NULL GROUP BY writer_name"
                )
            ).all()
        )
        pod_writers = [
            dict(r._mapping)
            for r in cx.execute(
                text(
                    "SELECT DISTINCT display_name, email FROM pod_assignments "
                    "WHERE role='writer' ORDER BY display_name"
                )
            )
        ]
        monitoring_writers = [
            r[0]
            for r in cx.execute(
                text(
                    "SELECT DISTINCT writer_name FROM ai_monitoring_records "
                    "WHERE writer_name IS NOT NULL AND writer_name != ''"
                )
            )
        ]
        member_raws = [
            r[0]
            for r in cx.execute(
                text(
                    "SELECT DISTINCT member_raw FROM editorial_member_capacity WHERE member_raw IS NOT NULL"
                )
            )
        ]

    # ── editors ──────────────────────────────────────────────────────────
    editors: dict[str, dict] = {}
    for raw, n in sorted(ed_counts.items()):
        k = norm_key(raw)
        entry: dict = {"raw": raw, "articles": int(n)}
        if k in EDITOR_CONFIRMED:
            canon = EDITOR_CONFIRMED[k]
            hr = hr_by_name.get(canon, {})
            entry.update(
                canonical=canon,
                status="confirmed",
                hr_status=hr.get("status"),
                hr_title=hr.get("title"),
            )
        elif k in EDITOR_CONFIRMED_WINDOWED:
            win = EDITOR_CONFIRMED_WINDOWED[k]
            entry.update(
                canonical=" / ".join(w["canonical"] for w in win["windows"]),
                status="confirmed_windowed",
                windows=win["windows"],
                note=win["note"],
            )
        elif k in EDITOR_AMBIGUOUS:
            amb = EDITOR_AMBIGUOUS[k]
            entry.update(
                canonical=amb["proposed"],
                status="ambiguous",
                candidates=amb["candidates"],
                note=amb["note"],
            )
        elif k in EDITOR_UNRESOLVED:
            entry.update(canonical=None, status="unresolved")
        elif k in EDITOR_JUNK:
            entry.update(canonical=None, status="junk")
        else:
            entry.update(canonical=None, status="unresolved", note="NEW since last build")
        editors[raw] = entry

    # capacity member names — strip annotations, then full-name match to HR
    members: dict[str, dict] = {}
    for raw in sorted(member_raws):
        bare = strip_member_annotations(raw)
        from etl.util import is_placeholder_member

        if is_placeholder_member(raw):
            members[raw] = {"raw": raw, "canonical": None, "status": "placeholder"}
            continue
        # Combined cells ("A (28) + B (15)" or space-separated "A (14) B (10)")
        # are split by the importer into member_breakdown; here we only map the
        # bare single names.
        if "+" in bare or "/" in bare or len(re.findall(r"\(\d+\)", raw)) >= 2:
            members[raw] = {"raw": raw, "canonical": None, "status": "combined_cell"}
            continue
        if bare in hr_by_name:
            members[raw] = {"raw": raw, "canonical": bare, "status": "confirmed"}
        elif bare.title() in hr_by_name:
            members[raw] = {"raw": raw, "canonical": bare.title(), "status": "confirmed"}
        elif norm_key(bare) == "kennedy sievers":
            members[raw] = {
                "raw": raw,
                "canonical": "Kennedy Stevens",
                "status": "confirmed",
                "note": "capacity-sheet surname typo (Sievers → Stevens)",
            }
        else:
            # case-insensitive full-name match (e.g. "ROBERT THORPE")
            hit = next((n for n in hr_by_name if norm_key(n) == norm_key(bare)), None)
            if hit:
                members[raw] = {"raw": raw, "canonical": hit, "status": "confirmed"}
            else:
                members[raw] = {"raw": raw, "canonical": None, "status": "unresolved"}

    # ── clients ──────────────────────────────────────────────────────────
    clients: dict[str, dict] = {}
    for c in hub_clients:
        name = c["name"]
        entry = {"hub_name": name, "hub_status": c["status"]}
        if name in CLIENT_OVERRIDES:
            sf_name, status, note = CLIENT_OVERRIDES[name]
            sf = sf_by_name.get(sf_name) if sf_name else None
            entry.update(
                sf_name=sf_name,
                sf_account_id=(sf or {}).get("AccountId"),
                status=status,
                note=note,
            )
        elif name in sf_by_name:
            entry.update(
                sf_name=name,
                sf_account_id=sf_by_name[name].get("AccountId"),
                status="confirmed",
                note="exact match",
            )
        elif _client_key(name) in sf_by_key:
            sf = sf_by_key[_client_key(name)]
            entry.update(
                sf_name=sf["Client_Name"],
                sf_account_id=sf.get("AccountId"),
                status="confirmed",
                note="spelling drift (normalized match)",
            )
        else:
            entry.update(sf_name=None, sf_account_id=None, status="no_sf_match", note="")
        clients[name] = entry

    # article tabs with no Hub client — annotate SF existence + proposals
    tabs: dict[str, dict] = {}
    live_client_aliases = {
        a["raw_value"]: a["canonical_value"] for a in live_aliases if a["kind"] == "client"
    }
    for t in unmapped_tabs:
        raw = t["raw_value"]
        entry = {
            "tab": raw,
            "articles": int(t["occurrences"]),
            "sf_exists": _client_key(raw) in sf_by_key,
        }
        sf_hits = [
            n
            for n in sf_by_name
            if _client_key(raw)
            and (_client_key(raw) in _client_key(n) or _client_key(n) in _client_key(raw))
        ]
        entry["sf_candidates"] = sf_hits[:3]
        if raw in live_client_aliases:
            entry.update(hub_client=live_client_aliases[raw], status="applied")
        elif raw in TAB_PROPOSALS:
            hub, status, note = TAB_PROPOSALS[raw]
            entry.update(hub_client=hub, status=status, note=note)
        else:
            entry.update(
                hub_client=None,
                status="decision",
                note="no Hub client — add to SOW or out of scope?",
            )
        tabs[raw] = entry

    # ── writers ──────────────────────────────────────────────────────────
    # Canonical roster: Slack writer contractors (real_name+email, the source of
    # truth) + pod sheet (current, email-keyed) + historical full names from AI
    # monitoring that aren't roster members.
    def _roster_canon(nm: str) -> str:
        nm = re.sub(r"\s+", " ", nm.strip())
        if nm.isupper():  # "ROBERT THORPE"
            nm = nm.title()
        return WRITER_VARIANT_OVERRIDES.get(norm_key(nm), nm)

    roster: dict[str, dict] = {}
    # Slack contractors first — the authoritative writer roster (real_name +
    # email). pod_sheet writers layer on top (setdefault keeps the Slack canon
    # for shared keys, but both contribute emails).
    for w in (*_fetch_slack_writers(), *pod_writers):
        nm = (w["display_name"] or "").strip()
        if not nm or "@" in nm:  # some rows carry the raw email as display name
            nm = (w["email"] or "").split("@")[0].replace(".", " ").replace("-", " ").title()
        nm = _roster_canon(nm)
        key = norm_key(nm)
        if key in WRITER_ROSTER_JUNK:
            continue
        roster.setdefault(key, {"canonical": nm, "emails": [], "source": "slack/pod_sheet"})
        if w["email"] and w["email"] not in roster[key]["emails"]:
            roster[key]["emails"].append(w["email"])
    for src_name, src in (("ai_monitoring", monitoring_writers),):
        for nm in src:
            nm = nm.strip()
            k = norm_key(nm)
            if not nm or k in WRITER_JUNK or k in WRITER_ROSTER_JUNK:
                continue
            if any(m in k for m in WRITER_TRIAL_MARKERS):
                continue
            # skip glued concatenations ("Jack LimebearOwen Murray") — an
            # internal lower→UPPER boundary with 3+ tokens is two names
            if len(nm.split()) >= 3 and any(
                c.islower() and n.isupper() for c, n in zip(nm, nm[1:])
            ):
                continue
            canon = _roster_canon(nm)
            if len(canon.split()) >= 2 and norm_key(canon) not in roster:
                roster[norm_key(canon)] = {
                    "canonical": canon,
                    "emails": [],
                    "source": f"historical:{src_name}",
                }

    first_name_index: dict[str, list[str]] = defaultdict(list)
    for k, r in roster.items():
        first_name_index[k.split(" ")[0]].append(r["canonical"])

    def _first_name_hits(ft: str) -> list[str]:
        """Exact first-name hits, else nickname/prefix overlap ≥3 chars
        ('kev' ↔ 'kevin') — same rule the capacity matcher uses."""
        hits = first_name_index.get(ft, [])
        if hits or len(ft) < 3:
            return hits
        out = []
        for k, names in first_name_index.items():
            if k.startswith(ft) or ft.startswith(k):
                out.extend(names)
        return out

    writers: dict[str, dict] = {}
    for raw, n in sorted(writer_counts.items(), key=lambda kv: -kv[1]):
        k = norm_key(raw)
        entry = {"raw": raw, "articles": int(n)}
        if k in WRITER_JUNK:
            entry.update(canonical=None, status="junk")
        elif any(m in k for m in WRITER_TRIAL_MARKERS):
            entry.update(canonical=None, status="trial")
        elif k in WRITER_VARIANT_OVERRIDES:
            entry.update(canonical=WRITER_VARIANT_OVERRIDES[k], status="confirmed")
        elif k in roster:
            entry.update(canonical=roster[k]["canonical"], status="confirmed")
        else:
            ft = k.split(" ")[0]
            hits = _first_name_hits(ft)
            if len(hits) == 1:
                entry.update(canonical=hits[0], status="confirmed_first_name")
            elif len(hits) > 1:
                entry.update(canonical=None, status="ambiguous", candidates=sorted(hits))
            elif len(raw.split()) >= 2:
                entry.update(canonical=None, status="unresolved")
            else:
                # Pre-2025 writers whose full name exists in NO source: keep
                # the first name as its own canonical so grouping still works;
                # flagged for DaniQ in case the team can supply full names.
                entry.update(canonical=raw.strip().title(), status="first_name_only")
        writers[raw] = entry

    # ── merge with previous build (never lose applied before→after pairs) ──
    prev_ed = _load_existing("editor_aliases.json").get("aliases", {})
    for raw, v in prev_ed.items():
        if raw not in editors:
            editors[raw] = {**v, "retained": True}
    # Retained entries can carry a stale status from before a curated decision
    # landed (e.g. "Lauren" disappears from editor_name once its alias applies,
    # so only the old ambiguous entry survives the merge). Re-classify them.
    for raw, v in editors.items():
        if not v.get("retained"):
            continue
        k = norm_key(raw)
        if k in EDITOR_CONFIRMED:
            canon = EDITOR_CONFIRMED[k]
            hr = hr_by_name.get(canon, {})
            v.update(
                canonical=canon,
                status="confirmed",
                hr_status=hr.get("status"),
                hr_title=hr.get("title"),
            )
            v.pop("candidates", None)
            v.pop("note", None)
        elif k in EDITOR_CONFIRMED_WINDOWED:
            win = EDITOR_CONFIRMED_WINDOWED[k]
            v.update(
                canonical=" / ".join(w["canonical"] for w in win["windows"]),
                status="confirmed_windowed",
                windows=win["windows"],
                note=win["note"],
            )
            v.pop("candidates", None)
    prev_wr = _load_existing("writer_aliases.json").get("aliases", {})
    for raw, v in prev_wr.items():
        if raw not in writers:
            writers[raw] = {**v, "retained": True}

    # ── write outputs ────────────────────────────────────────────────────
    today = date.today().isoformat()

    def _dump(name: str, payload: dict):
        with open(os.path.join(MAPPINGS_DIR, name), "w") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)

    _dump(
        "editor_aliases.json",
        {
            "built_at": today,
            "canonical_source": "graphite_bi_sandbox.v_team_pods_editorial (HR)",
            "aliases": editors,
            "capacity_members": members,
        },
    )
    _dump(
        "client_aliases.json",
        {
            "built_at": today,
            "canonical_source": "graphite_bi.salesforce_int_Account",
            "hub_to_salesforce": clients,
            "article_tabs_unmapped": tabs,
        },
    )
    _dump(
        "writer_aliases.json",
        {
            "built_at": today,
            "canonical_source": "slack_raw_users (writing.graphitehq.com contractors, "
            "real_name+email) ∪ pod_assignments(role=writer) ∪ historical full names "
            "(ai_monitoring_records.writer_name)",
            "roster": {k: v for k, v in sorted(roster.items())},
            "aliases": writers,
        },
    )

    def _stats(d: dict, field="status") -> dict:
        out: dict[str, int] = defaultdict(int)
        for v in d.values():
            out[v[field]] += 1
        return dict(sorted(out.items()))

    def _stats_weighted(d: dict) -> dict:
        out: dict[str, int] = defaultdict(int)
        for v in d.values():
            out[v["status"]] += v.get("articles", 0)
        return dict(sorted(out.items()))

    summary = {
        "built_at": today,
        "editors": {"names": _stats(editors), "article_rows": _stats_weighted(editors)},
        "capacity_members": _stats(members),
        "clients": _stats(clients),
        "article_tabs": {
            "tabs": _stats(tabs),
            "article_rows": _stats_weighted(
                {k: {**v, "status": v["status"]} for k, v in tabs.items()}
            ),
        },
        "writers": {"names": _stats(writers), "article_rows": _stats_weighted(writers)},
        "writer_roster_size": len(roster),
    }
    _dump("MAPPINGS_SUMMARY.json", summary)
    return summary


def apply_writer_aliases(engine=None) -> dict:
    """Load the generated writer dictionary into `article_name_aliases`
    (kind='writer', source='etl') so the next Monthly Article Count sync
    canonicalizes writer names — the same self-healing path the Data Quality
    review screen uses. Only high-confidence rows are applied (status
    'confirmed' / 'confirmed_first_name'); ambiguous + unresolved stay for
    DaniQ. Reversible: DELETE FROM article_name_aliases WHERE source='etl'."""
    eng = engine or make_sync_engine(settings.database_url)
    with open(os.path.join(MAPPINGS_DIR, "writer_aliases.json")) as f:
        aliases = json.load(f)["aliases"]
    inserted = updated = skipped = 0
    with eng.begin() as cx:
        for v in aliases.values():
            if v["status"] not in ("confirmed", "confirmed_first_name"):
                skipped += 1
                continue
            if not v.get("canonical") or v["canonical"] == v["raw"]:
                skipped += 1
                continue
            res = cx.execute(
                text(
                    "UPDATE article_name_aliases SET canonical_value=:canon "
                    "WHERE kind='writer' AND raw_value=:raw"
                ),
                {"canon": v["canonical"], "raw": v["raw"]},
            )
            if res.rowcount:
                updated += res.rowcount
            else:
                cx.execute(
                    text(
                        "INSERT INTO article_name_aliases "
                        "(kind, raw_value, canonical_value, source, created_by, created_at) "
                        "VALUES ('writer', :raw, :canon, 'etl', 'etl-mappings', NOW())"
                    ),
                    {"raw": v["raw"], "canon": v["canonical"]},
                )
                inserted += 1
    return {"inserted": inserted, "updated": updated, "skipped": skipped}


def apply_editor_aliases(engine=None) -> dict:
    """Load confirmed editor aliases into `article_name_aliases` (kind='editor',
    source='etl') so the next Monthly Article Count sync canonicalizes editor
    names (e.g. Tiffany → Tiffany Anderson). Handles date-windowed aliases
    (Sam → McGrail/Marceau) via valid_from/valid_to. Only 'confirmed' /
    'confirmed_windowed' applied; ambiguous/unresolved/junk stay for DaniQ.
    Reversible: DELETE FROM article_name_aliases WHERE source='etl' AND kind='editor'."""
    eng = engine or make_sync_engine(settings.database_url)
    with open(os.path.join(MAPPINGS_DIR, "editor_aliases.json")) as f:
        aliases = json.load(f)["aliases"]
    inserted = updated = skipped = 0
    with eng.begin() as cx:
        for v in aliases.values():
            raw = v["raw"]
            rows: list[tuple[str, str | None, str | None]] = []  # (canonical, valid_from, valid_to)
            if v["status"] == "confirmed" and v.get("canonical") and v["canonical"] != raw:
                rows.append((v["canonical"], None, None))
            elif v["status"] == "confirmed_windowed":
                for w in v.get("windows", []):
                    if w.get("canonical"):
                        rows.append((w["canonical"], w.get("from"), w.get("to")))
            if not rows:
                skipped += 1
                continue
            for canon, vf, vt in rows:
                res = cx.execute(
                    text(
                        "UPDATE article_name_aliases SET canonical_value=:canon, valid_to=:vt "
                        "WHERE kind='editor' AND raw_value=:raw "
                        "AND COALESCE(valid_from,'')=COALESCE(:vf,'')"
                    ),
                    {"canon": canon, "raw": raw, "vf": vf, "vt": vt},
                )
                if res.rowcount:
                    updated += res.rowcount
                else:
                    cx.execute(
                        text(
                            "INSERT INTO article_name_aliases (kind, raw_value, canonical_value, "
                            "source, created_by, created_at, valid_from, valid_to) "
                            "VALUES ('editor', :raw, :canon, 'etl', 'etl-mappings', NOW(), :vf, :vt)"
                        ),
                        {"raw": raw, "canon": canon, "vf": vf, "vt": vt},
                    )
                    inserted += 1
    return {"inserted": inserted, "updated": updated, "skipped": skipped}


def apply_client_aliases(engine=None) -> dict:
    """Load confirmed article-tab → Hub-client aliases into `article_name_aliases`
    (kind='client', source='etl') so the Monthly Article Count importer routes a
    tab to the right Hub client (+ pod). Only entries with a resolved `hub_client`
    and status 'applied'/'proposed' (DaniQ-reviewed) are applied; ambiguous rows
    (hub_client=None, e.g. EarnIn / Athena2) stay for confirmation. Reversible:
    DELETE FROM article_name_aliases WHERE source='etl' AND kind='client'."""
    eng = engine or make_sync_engine(settings.database_url)
    with open(os.path.join(MAPPINGS_DIR, "client_aliases.json")) as f:
        tabs = json.load(f).get("article_tabs_unmapped", {})
    inserted = updated = skipped = 0
    with eng.begin() as cx:
        for raw, e in tabs.items():
            hub = e.get("hub_client")
            if not hub or e.get("status") not in ("applied", "proposed"):
                skipped += 1
                continue
            res = cx.execute(
                text(
                    "UPDATE article_name_aliases SET canonical_value=:canon "
                    "WHERE kind='client' AND raw_value=:raw"
                ),
                {"canon": hub, "raw": raw},
            )
            if res.rowcount:
                updated += res.rowcount
            else:
                cx.execute(
                    text(
                        "INSERT INTO article_name_aliases (kind, raw_value, canonical_value, "
                        "source, created_by, created_at) "
                        "VALUES ('client', :raw, :canon, 'etl', 'etl-mappings', NOW())"
                    ),
                    {"raw": raw, "canon": hub},
                )
                inserted += 1
    return {"inserted": inserted, "updated": updated, "skipped": skipped}


def build_name_map_rows() -> list[dict]:
    """The unified raw→canonical mapping rows from the 3 JSON dicts — the SAME
    confirmed set the `apply_*_aliases` loaders write to Neon `article_name_aliases`,
    collapsed into one shape for the BigQuery `editorial_name_map` table
    (kind ∈ writer|editor|client). Source of truth = the JSON (built from
    Slack / Rippling / Salesforce + DaniQ decisions)."""
    rows: list[dict] = []

    def _row(kind, raw, canon, vf, vt, status, source):
        return {
            "kind": kind,
            "raw_value": raw,
            "canonical_value": canon,
            "valid_from": vf,
            "valid_to": vt,
            "status": status,
            "source": source,
        }

    with open(os.path.join(MAPPINGS_DIR, "writer_aliases.json")) as f:
        for v in json.load(f)["aliases"].values():
            if (
                v["status"] in ("confirmed", "confirmed_first_name")
                and v.get("canonical")
                and v["canonical"] != v["raw"]
            ):
                rows.append(
                    _row("writer", v["raw"], v["canonical"], None, None, v["status"], "slack")
                )
    with open(os.path.join(MAPPINGS_DIR, "editor_aliases.json")) as f:
        for v in json.load(f)["aliases"].values():
            if v["status"] == "confirmed" and v.get("canonical") and v["canonical"] != v["raw"]:
                rows.append(
                    _row("editor", v["raw"], v["canonical"], None, None, "confirmed", "rippling")
                )
            elif v["status"] == "confirmed_windowed":
                for w in v.get("windows", []):
                    if w.get("canonical"):
                        rows.append(
                            _row(
                                "editor",
                                v["raw"],
                                w["canonical"],
                                w.get("from"),
                                w.get("to"),
                                "confirmed_windowed",
                                "rippling",
                            )
                        )
    with open(os.path.join(MAPPINGS_DIR, "client_aliases.json")) as f:
        for raw, v in json.load(f).get("article_tabs_unmapped", {}).items():
            if v.get("hub_client") and v.get("status") in ("applied", "proposed"):
                rows.append(
                    _row("client", raw, v["hub_client"], None, None, v["status"], "salesforce")
                )
    return rows


def build_name_map(bq=None) -> dict:
    """Publish the unified mapping to BigQuery `editorial_name_map` (WRITE_TRUNCATE).
    This is what the importer + warehouse read once mappings move off Neon."""
    from etl.load import get_bq, load_rows, schema_from_spec

    rows = build_name_map_rows()
    schema = schema_from_spec(
        [
            ("kind", "STRING"),
            ("raw_value", "STRING"),
            ("canonical_value", "STRING"),
            ("valid_from", "STRING"),
            ("valid_to", "STRING"),
            ("status", "STRING"),
            ("source", "STRING"),
        ]
    )
    load_rows(bq or get_bq(), "editorial_name_map", rows, schema)
    return {
        "rows": len(rows),
        "by_kind": {
            k: sum(1 for r in rows if r["kind"] == k) for k in ("writer", "editor", "client")
        },
    }


def read_name_map_sheet() -> list[dict]:
    """Read the DaniQ-editable 'Editorial Name Mappings' sheet (Writers / Editors /
    Clients tabs) → unified rows for `editorial_name_map`. This is the live,
    editable source of truth once mappings are off Neon. Columns (row 1 = header):
    RAW · CANONICAL · VALID FROM · VALID TO · STATUS · SOURCE · NOTE."""
    from googleapiclient.discovery import build as _gbuild

    from app.services.google_auth import get_google_credentials

    svc = _gbuild(
        "sheets",
        "v4",
        credentials=get_google_credentials(
            scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"]
        ),
    )
    sid = settings.name_mappings_sheet_id
    out: list[dict] = []
    for kind, tab in (("writer", "Writers"), ("editor", "Editors"), ("client", "Clients")):
        vals = (
            svc.spreadsheets()
            .values()
            .get(spreadsheetId=sid, range=f"'{tab}'!A2:G")
            .execute()
            .get("values", [])
        )
        for row in vals:
            cells = [(c or "").strip() for c in (row + [""] * 7)[:7]]
            raw, canon, vf, vt, status, source, _note = cells
            if not raw or not canon:
                continue
            out.append(
                {
                    "kind": kind,
                    "raw_value": raw,
                    "canonical_value": canon,
                    "valid_from": vf or None,
                    "valid_to": vt or None,
                    "status": status or "confirmed",
                    "source": source or "sheet",
                }
            )
    return out


def publish_name_map_from_sheet(bq=None) -> dict:
    """Read the mappings sheet → publish `editorial_name_map` to BigQuery
    (WRITE_TRUNCATE). Run as a sync step so DaniQ's sheet edits flow to BQ, where
    the importer + warehouse read them — no Neon involved."""
    from etl.load import get_bq, load_rows, schema_from_spec

    rows = read_name_map_sheet()
    schema = schema_from_spec(
        [
            ("kind", "STRING"),
            ("raw_value", "STRING"),
            ("canonical_value", "STRING"),
            ("valid_from", "STRING"),
            ("valid_to", "STRING"),
            ("status", "STRING"),
            ("source", "STRING"),
        ]
    )
    load_rows(bq or get_bq(), "editorial_name_map", rows, schema)
    return {
        "rows": len(rows),
        "by_kind": {
            k: sum(1 for r in rows if r["kind"] == k) for k in ("writer", "editor", "client")
        },
    }


if __name__ == "__main__":
    import sys

    if "--publish-name-map-from-sheet" in sys.argv:
        print(json.dumps(publish_name_map_from_sheet(), indent=2))
    elif "--build-name-map" in sys.argv:
        print(json.dumps(build_name_map(), indent=2))
    elif "--apply-writer-aliases" in sys.argv:
        print(json.dumps(apply_writer_aliases(), indent=2))
    elif "--apply-editor-aliases" in sys.argv:
        print(json.dumps(apply_editor_aliases(), indent=2))
    elif "--apply-client-aliases" in sys.argv:
        print(json.dumps(apply_client_aliases(), indent=2))
    elif "--apply-aliases" in sys.argv:  # writers + editors + clients
        print(
            json.dumps(
                {
                    "writers": apply_writer_aliases(),
                    "editors": apply_editor_aliases(),
                    "clients": apply_client_aliases(),
                },
                indent=2,
            )
        )
    else:
        s = build()
        print(json.dumps(s, indent=2))
