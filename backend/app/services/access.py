"""RBAC seed, derived-membership refresh, and per-user resolver.

Three roles in this module:

1. `seed_access_baseline()`  — idempotent: ensures the catalog of views,
   the four seeded groups (Admin / VPs / Leadership / BI Team), the two
   pod-derived groups (Editorial Team / Growth Team), the explicit
   seed-member emails, and the default per-group view permission matrix
   are present. Run on app startup, no-op on subsequent boots.

2. `refresh_pod_derived_members()` — replaces the `derived` rows of the
   pod-derived groups (Editorial Team / Growth Team / Leadership) from the
   current `pod_assignments` table. Called at the end of every
   `import_team_pods` run; manual + seed members survive.

3. `resolve_access(email)` — returns a single `AccessProfile` describing
   the effective permissions of the requesting user. The resolver is the
   one place where group inheritance + user overrides + pod scope all
   compose. Both the API middleware and the `/api/access/me` endpoint
   call this; nothing else should re-implement the logic.

The whole module is intentionally synchronous — it's called from sync
SQLAlchemy sessions inside the importer and from FastAPI dependencies
that already use a sync session for legacy reasons.
"""

from __future__ import annotations

import copy
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import (
    AccessGroup,
    AccessGroupMember,
    AccessGroupViewPermission,
    AccessUserOverride,
    AccessView,
    PodAssignment,
)

# ─── View catalog ────────────────────────────────────────────────────────
# Source-of-truth list of views participating in the access matrix. Slug
# is the stable identifier the API + frontend speak in. Adding a view here
# + restarting the backend extends the matrix with `can_view=False` rows
# for every existing group; admins then explicitly grant access.

_VIEWS: list[tuple[str, str, str, str, int]] = [
    # (slug,             label,                  dashboard_label,        section,       sort_order)
    # Section is the top-row group; dashboard_label is the middle row; label is the leaf
    # (tab name, or = dashboard_label when the dashboard has no tabs).
    ("overview", "Overview", "Overview", "Dashboards", 10),
    ("d1.contract", "Contract & Timeline", "Editorial Clients", "Dashboards", 20),
    ("d1.deliverables", "Deliverables vs SOW", "Editorial Clients", "Dashboards", 21),
    ("d2.kpi", "KPI Performance", "Team KPIs", "Dashboards", 30),
    ("d2.capacity", "Capacity Projections", "Team KPIs", "Dashboards", 31),
    ("d2.ai", "AI Compliance", "Team KPIs", "Dashboards", 32),
    ("data.import", "Import Data", "Import Data", "Data", 50),
    ("admin.access", "Access Control", "Access Control", "Admin", 60),
    # Edit privilege for the Access Control matrix. Rendered as a second
    # "Edit" pill next to "View" in the matrix UI rather than a separate
    # column. Granting this lets a user toggle cell permissions and edit
    # group memberships, but NOT touch the admin group or grant the edit
    # privilege itself — those stay admin-only to prevent escalation.
    ("admin.access.edit", "Edit Access Control", "Access Control", "Admin", 61),
    ("admin.data_quality", "Data Quality", "Data Quality", "Admin", 62),
    ("admin.analytics", "Analytics", "Analytics", "Admin", 63),
]

# ─── Group catalog ───────────────────────────────────────────────────────
# Slugs are stable — the resolver hard-codes a couple of them (`admin`,
# `editorial_team`, `growth_team`, `leadership`) for pod-axis math.

_GROUPS: list[dict] = [
    {
        "slug": "admin",
        "name": "Admin",
        "description": "Full access — edit access matrix + every dashboard. Seed members protected.",
        "is_seeded": True,
        "is_pod_derived": False,
    },
    {
        "slug": "leadership",
        "name": "Leadership + Ops",
        "description": (
            "Dashboards + Capacity Planning v2 + view-only Access Control. Toggle between "
            "Editorial / Growth axes, sees all clients. Seeded — VPs, managers, and ops "
            "leads of the Editorial / Growth orgs."
        ),
        "is_seeded": True,
        "is_pod_derived": False,
    },
    {
        "slug": "bi_team",
        "name": "BI Team",
        "description": "Dashboards + Data + view-only Access Control. Toggle between axes.",
        "is_seeded": True,
        "is_pod_derived": False,
    },
    {
        "slug": "editorial_team",
        "name": "Editorial Team",
        "description": (
            "Auto-populated from the Team Pods sheet — Editorial Team tab. Includes Senior "
            "Editors and Editors (writers excluded — they don't use the dashboards). Locked "
            "to Editorial axis, only their pod's clients."
        ),
        "is_seeded": True,
        "is_pod_derived": True,
    },
    {
        "slug": "growth_team",
        "name": "Growth Team",
        "description": (
            "Auto-populated from the Team Pods sheet — Growth Team tab. Includes everyone "
            "in that tab: Growth Leads, Growth Directors, Sr Growth Directors, Managing "
            "Directors, Account Directors / Managers / Jr AMs, Content Specialists, etc. "
            "Locked to Growth axis, only their pod's clients."
        ),
        "is_seeded": True,
        "is_pod_derived": True,
    },
]

# ─── Seed members ────────────────────────────────────────────────────────
# These rows are written with source='seed' and are PROTECTED — admins
# can't remove them via the API.

_SEED_MEMBERS: dict[str, list[str]] = {
    "admin": [
        "daniela.quiroga@graphitehq.com",
        "ricardo.jaramillo@graphitehq.com",
    ],
    "leadership": [
        "rafa@graphitehq.com",
        "marcos@graphitehq.com",
        "juan.cardoso@graphitehq.com",
        "ethan@graphitehq.com",
        "caitlin@graphitehq.com",
        "ainoa@graphitehq.com",
        "christine.woods@graphitehq.com",
        "bryan@graphitehq.com",
        "paula.landinez@graphitehq.com",
        "juan.mantilla@graphitehq.com",
        "diego.rubio@graphitehq.com",
    ],
    "bi_team": [
        "ricardo.jaramillo@graphitehq.com",
        "simon.betancur@graphitehq.com",
        "paolo.cavalli@graphitehq.com",
    ],
    "editorial_team": [],
    "growth_team": [],
}


def seeded_emails() -> set[str]:
    """Union of every email seeded into any group. Used by callers that
    need a quick is-this-user-seeded check without running a per-group
    membership query."""
    out: set[str] = set()
    for emails in _SEED_MEMBERS.values():
        out.update(e.lower().strip() for e in emails)
    return out


def seeded_admin_emails() -> set[str]:
    """Just the admin-group seed members (Daniela + Ricardo by default).
    Used to lock these accounts against ANY override on the Access Control
    views — not even other admins can revoke them, so the original admin
    baseline can't accidentally be locked out by a misclick."""
    return {e.lower().strip() for e in _SEED_MEMBERS.get("admin", [])}


# ─── Default permission matrix ───────────────────────────────────────────
# Maps group_slug → set of view slugs the group can_view by default.
# Anything not listed defaults to can_view=False.

_DEFAULT_PERMISSIONS: dict[str, set[str]] = {
    "admin": {v[0] for v in _VIEWS},  # admin sees everything
    "leadership": {
        # Leadership (formerly VPs and Managers) is the only non-admin
        # group with Capacity Planning v2 access by default — CP2 is
        # still a prototype + the canonical maintainer audience is
        # leadership-track managers.
        "overview",
        "d1.contract",
        "d1.deliverables",
        "d2.kpi",
        "d2.capacity",
        "d2.ai",
        "admin.access",
    },
    "bi_team": {
        "overview",
        "d1.contract",
        "d1.deliverables",
        "d2.kpi",
        "d2.capacity",
        "d2.ai",
        "data.import",
        "admin.access",
        "admin.data_quality",
    },
    "editorial_team": {
        # Dashboards minus Overview per spec; no CP2.
        "d1.contract",
        "d1.deliverables",
        "d2.kpi",
        "d2.capacity",
        "d2.ai",
    },
    "growth_team": {
        # Growth Team does NOT get the Team KPIs dashboard by default —
        # KPI Performance / Capacity Projections / AI Compliance are
        # Editorial-team metrics. Admins can grant Team KPIs to
        # individual growth users via the Users × Views override if
        # they need it. CP2 is also excluded.
        "d1.contract",
        "d1.deliverables",
    },
}


# ───────────────────────────────────────────────────────────────────────
# Seed
# ───────────────────────────────────────────────────────────────────────


def seed_access_baseline(session: Session) -> None:
    """Idempotent: ensure views + groups + seed members + default
    permissions exist. Safe to run on every app startup. Existing rows are
    not mutated; only missing rows are inserted. Manual edits to view
    permissions or non-seed memberships are preserved."""

    # 1) Views — insert any missing slugs. Existing rows get their label /
    #    parent / dashboard_label / sort_order refreshed so renames in
    #    `_VIEWS` propagate on every restart.
    existing_views = {v.slug: v for v in session.execute(select(AccessView)).scalars().all()}
    for slug, label, dashboard_label, parent, order in _VIEWS:
        v = existing_views.get(slug)
        if v is None:
            v = AccessView(
                slug=slug,
                label=label,
                dashboard_label=dashboard_label,
                parent_label=parent,
                sort_order=order,
            )
            session.add(v)
        else:
            v.label = label
            v.dashboard_label = dashboard_label
            v.parent_label = parent
            v.sort_order = order

    # Prune views removed from the catalog (e.g. `cp2` after CP v2 removal) so
    # the matrix + permissions/overrides don't keep dead rows — `_VIEWS` is the
    # source of truth (FK ON DELETE CASCADE clears their permissions/overrides).
    _catalog_slugs = {v[0] for v in _VIEWS}
    for _slug, _v in existing_views.items():
        if _slug not in _catalog_slugs:
            session.delete(_v)

    # 2) Groups — insert missing, update mutable metadata (description /
    #    flags / sort_order) on existing rows. `sort_order` comes from
    #    each group's index in the `_GROUPS` list — so reordering only
    #    requires reordering the list above and restarting the backend.
    existing_groups = {g.slug: g for g in session.execute(select(AccessGroup)).scalars().all()}
    for i, spec in enumerate(_GROUPS):
        g = existing_groups.get(spec["slug"])
        if g is None:
            g = AccessGroup(**spec, sort_order=i)
            session.add(g)
        else:
            g.name = spec["name"]
            g.description = spec["description"]
            g.is_seeded = spec["is_seeded"]
            g.is_pod_derived = spec["is_pod_derived"]
            g.sort_order = i

    session.flush()  # surface the inserted IDs

    # Reload after flush so we have IDs.
    views_by_slug = {v.slug: v for v in session.execute(select(AccessView)).scalars().all()}
    groups_by_slug = {g.slug: g for g in session.execute(select(AccessGroup)).scalars().all()}

    # 3) Seed members — insert any missing rows. Never delete.
    #
    # IMPORTANT: skip by (group_id, email) regardless of source. The
    # UNIQUE constraint `uq_access_group_members_group_email` ignores
    # source, so a row already added via the admin UI (source='manual')
    # or auto-derived from a pod sheet (source='derived') will block a
    # subsequent INSERT with source='seed'. Previously this loop only
    # looked at source='seed' rows and crashed startup when an admin
    # had manually added someone who later got promoted into the seed
    # list (e.g. Christine Woods / Bryan / Paula Landinez when the
    # leadership consolidation widened the seed roster).
    for group_slug, emails in _SEED_MEMBERS.items():
        group = groups_by_slug[group_slug]
        existing_emails = {
            row.email
            for row in session.execute(
                select(AccessGroupMember).where(
                    AccessGroupMember.group_id == group.id,
                )
            )
            .scalars()
            .all()
        }
        for email in emails:
            normalized = email.strip().lower()
            if normalized in existing_emails:
                continue
            session.add(
                AccessGroupMember(
                    group_id=group.id,
                    email=normalized,
                    source="seed",
                    added_by_email="system",
                )
            )

    # 4) Default permissions — for each (group, view) pair NOT yet in the
    #    table, insert with the matrix's default. Existing rows are left
    #    alone so admin edits survive restarts.
    for group_slug, allowed_views in _DEFAULT_PERMISSIONS.items():
        group = groups_by_slug[group_slug]
        existing_perms = {
            (row.view_id): row
            for row in session.execute(
                select(AccessGroupViewPermission).where(
                    AccessGroupViewPermission.group_id == group.id
                )
            )
            .scalars()
            .all()
        }
        for slug, view in views_by_slug.items():
            if view.id in existing_perms:
                continue
            session.add(
                AccessGroupViewPermission(
                    group_id=group.id,
                    view_id=view.id,
                    can_view=(slug in allowed_views),
                )
            )

    # 4b) Forced policy revokes — explicit (group, view) pairs whose
    #     default permission must be applied even to existing rows.
    #     Step 4 above is insert-only so admin edits survive; this list
    #     is the narrow escape hatch for policy changes that need to
    #     overwrite a stale True. Each entry should also reflect the
    #     current `_DEFAULT_PERMISSIONS` so the two stay in sync.
    _FORCED_REVOKES: list[tuple[str, str]] = [
        # Growth Team should NOT see Team KPIs — those are editorial
        # metrics. (See `_DEFAULT_PERMISSIONS["growth_team"]`.)
        ("growth_team", "d2.kpi"),
        ("growth_team", "d2.capacity"),
        ("growth_team", "d2.ai"),
        # Admin · Analytics is admin-only. The summary endpoint exposes
        # other users' activity (email, last seen, top route, return
        # cadence), so we revoke it explicitly on every non-admin
        # group even when nobody has manually granted it — keeps the
        # tab off the Sidebar for everyone but admins.
        ("leadership", "admin.analytics"),
        ("bi_team", "admin.analytics"),
        ("editorial_team", "admin.analytics"),
        ("growth_team", "admin.analytics"),
    ]
    _FORCED_GRANTS: list[tuple[str, str]] = []
    for group_slug, view_slug in _FORCED_REVOKES:
        group = groups_by_slug.get(group_slug)
        view = views_by_slug.get(view_slug)
        if group is None or view is None:
            continue
        row = session.execute(
            select(AccessGroupViewPermission).where(
                AccessGroupViewPermission.group_id == group.id,
                AccessGroupViewPermission.view_id == view.id,
            )
        ).scalar_one_or_none()
        if row is not None and row.can_view:
            row.can_view = False
    for group_slug, view_slug in _FORCED_GRANTS:
        group = groups_by_slug.get(group_slug)
        view = views_by_slug.get(view_slug)
        if group is None or view is None:
            continue
        row = session.execute(
            select(AccessGroupViewPermission).where(
                AccessGroupViewPermission.group_id == group.id,
                AccessGroupViewPermission.view_id == view.id,
            )
        ).scalar_one_or_none()
        if row is not None and not row.can_view:
            row.can_view = True

    # 5) Wipe any per-user overrides on seeded admins (Daniela / Ricardo).
    #    The rule is "seeded admins are immutable across the matrix" so
    #    stale overrides are an inconsistent state. Idempotent — empty on
    #    every clean run.
    seeded_admin_set = {e.lower().strip() for e in _SEED_MEMBERS.get("admin", [])}
    if seeded_admin_set:
        stale_overrides = (
            session.execute(
                select(AccessUserOverride).where(AccessUserOverride.email.in_(seeded_admin_set))
            )
            .scalars()
            .all()
        )
        for ov in stale_overrides:
            session.delete(ov)

    session.commit()


# ───────────────────────────────────────────────────────────────────────
# Refresh derived members from pod_assignments
# ───────────────────────────────────────────────────────────────────────


# Roles that should NOT be added to the auto-populated pod groups.
#
#   editorial_team excludes  writer            — they work in Notion /
#                                                Master Tracker, not in
#                                                the Hub dashboards.
#   growth_team    excludes  content_specialist — CS executes deliverables
#                                                inside the source tools
#                                                (Notion, Surfer, etc.)
#                                                and doesn't need the
#                                                growth-team dashboards.
#
# Role tag canonical forms come from `_ROLE_TAG_CANONICAL` in
# migration_service.py — keep these sets in sync with the values that
# importer emits (`writer` from `W`, `content_specialist` from `CS`).
_EDITORIAL_TEAM_EXCLUDED_ROLES = {"writer"}
_GROWTH_TEAM_EXCLUDED_ROLES = {"content_specialist"}


def refresh_pod_derived_members(session: Session) -> dict[str, int]:
    """Rebuild the `derived`-source membership of the two pod-derived
    groups (Editorial Team / Growth Team). Manual + seed members are
    untouched.

    Called at the end of `import_team_pods`. Returns a count summary
    `{group_slug: derived_count}` for logging."""

    groups_by_slug = {g.slug: g for g in session.execute(select(AccessGroup)).scalars().all()}

    # Two-pass exclusion: first collect every email that carries an excluded
    # role, then only add emails that are never associated with one. A single
    # pass misses the case where the same person has both a `pod_member` row
    # (added first) and a `content_specialist` row (skipped, but too late —
    # the email is already in the set).
    all_rows = session.execute(select(PodAssignment)).scalars().all()

    editorial_excluded: set[str] = set()
    growth_excluded: set[str] = set()
    for row in all_rows:
        e = (row.email or "").strip().lower()
        if not e:
            continue
        if row.pod_kind == "editorial" and row.role in _EDITORIAL_TEAM_EXCLUDED_ROLES:
            editorial_excluded.add(e)
        elif row.pod_kind == "growth" and row.role in _GROWTH_TEAM_EXCLUDED_ROLES:
            growth_excluded.add(e)

    editorial_emails: set[str] = set()
    growth_emails: set[str] = set()
    for row in all_rows:
        e = (row.email or "").strip().lower()
        if not e:
            continue
        if row.pod_kind == "editorial" and e not in editorial_excluded:
            editorial_emails.add(e)
        elif row.pod_kind == "growth" and e not in growth_excluded:
            growth_emails.add(e)

    plan: dict[str, set[str]] = {
        "editorial_team": editorial_emails,
        "growth_team": growth_emails,
    }

    summary: dict[str, int] = {}
    now = datetime.utcnow()
    for slug, emails in plan.items():
        group = groups_by_slug.get(slug)
        if group is None:
            continue
        # Wipe only the derived rows; preserve seed + manual.
        session.query(AccessGroupMember).filter(
            AccessGroupMember.group_id == group.id,
            AccessGroupMember.source == "derived",
        ).delete()
        # Re-insert. UNIQUE(group_id, email) means we can't write a
        # `derived` row when the email already exists with a different
        # source — skip those (the seed/manual entry already grants the
        # group; the source flag's only job is "can this be deleted").
        existing = {
            row.email
            for row in session.execute(
                select(AccessGroupMember.email).where(AccessGroupMember.group_id == group.id)
            ).all()
        }
        added = 0
        for email in emails:
            if email in existing:
                continue
            session.add(
                AccessGroupMember(
                    group_id=group.id,
                    email=email,
                    source="derived",
                    added_by_email="system",
                )
            )
            added += 1
        group.last_synced_at = now
        summary[slug] = added

    session.commit()
    return summary


# ───────────────────────────────────────────────────────────────────────
# Resolver
# ───────────────────────────────────────────────────────────────────────


@dataclass
class AccessProfile:
    """Effective permissions for a single email. Computed once per
    request; everything downstream (middleware, API filters, frontend
    /me endpoint) reads from this."""

    email: str
    is_authenticated: bool
    group_slugs: list[str] = field(default_factory=list)
    is_admin: bool = False
    view_slugs: set[str] = field(default_factory=set)
    # Pod-axis machinery — drives the top-bar toggle + the per-API client
    # filter:
    #   pod_kind_lock   = 'editorial' / 'growth' / None (None means free)
    #   can_toggle_axis = True for Admin / VPs / BI Team
    #   pod_number_lock = the user's own pod number when locked, else None
    #   client_scope    = 'all' (see every client) or 'assigned' (clients
    #                     where the user has a pod_assignments row)
    pod_kind_lock: str | None = None
    can_toggle_axis: bool = False
    pod_number_lock: str | None = None
    client_scope: str = "all"  # 'all' | 'assigned'
    # True when an admin is using `X-Preview-As` to view as someone else.
    # Set by the auth dep, not the resolver itself.
    is_preview: bool = False


def resolve_access(session: Session, email: str | None) -> AccessProfile:
    """Compute the effective access profile for `email`. None / empty
    email → unauthenticated profile (no views, no clients)."""
    if not email:
        return AccessProfile(email="", is_authenticated=False)
    e = email.strip().lower()

    # Group membership.
    group_rows = session.execute(
        select(AccessGroup, AccessGroupMember)
        .join(AccessGroupMember, AccessGroupMember.group_id == AccessGroup.id)
        .where(AccessGroupMember.email == e)
    ).all()
    groups = [g for g, _ in group_rows]
    group_slugs = [g.slug for g in groups]
    group_ids = [g.id for g in groups]

    profile = AccessProfile(
        email=e,
        is_authenticated=True,
        group_slugs=group_slugs,
        is_admin=("admin" in group_slugs),
    )

    # Default view set = union of `can_view=True` permissions across the
    # user's groups.
    view_set: set[str] = set()
    if group_ids:
        perms = session.execute(
            select(AccessView.slug, AccessGroupViewPermission.can_view)
            .join(
                AccessGroupViewPermission,
                AccessGroupViewPermission.view_id == AccessView.id,
            )
            .where(
                AccessGroupViewPermission.group_id.in_(group_ids),
                AccessGroupViewPermission.can_view.is_(True),
            )
        ).all()
        view_set = {slug for slug, _ in perms}

    # User overrides — trump the group default in either direction.
    overrides = session.execute(
        select(AccessView.slug, AccessUserOverride.can_view)
        .join(AccessUserOverride, AccessUserOverride.view_id == AccessView.id)
        .where(AccessUserOverride.email == e)
    ).all()
    for slug, can_view in overrides:
        if can_view:
            view_set.add(slug)
        else:
            view_set.discard(slug)
    profile.view_slugs = view_set

    # Pod-axis math. Order matters — admin & friends override pod-team
    # locks even if the user is in both groups.
    if "admin" in group_slugs or "leadership" in group_slugs or "bi_team" in group_slugs:
        profile.can_toggle_axis = True
        profile.client_scope = "all"
        profile.pod_kind_lock = None
    elif "editorial_team" in group_slugs:
        profile.can_toggle_axis = False
        profile.client_scope = "assigned"
        profile.pod_kind_lock = "editorial"
    elif "growth_team" in group_slugs:
        profile.can_toggle_axis = False
        profile.client_scope = "assigned"
        profile.pod_kind_lock = "growth"
    else:
        # No matching group → no client access at all.
        profile.can_toggle_axis = False
        profile.client_scope = "assigned"

    # Pod-number lock — only meaningful when `pod_kind_lock` is set. Pick
    # the user's first pod_number for that kind from pod_assignments.
    if profile.pod_kind_lock:
        first = session.execute(
            select(PodAssignment.pod_number)
            .where(
                PodAssignment.email == e,
                PodAssignment.pod_kind == profile.pod_kind_lock,
            )
            .limit(1)
        ).first()
        profile.pod_number_lock = first[0] if first else None

    return profile


# Short-TTL cache for resolve_access. Once dashboards serve from BigQuery, the
# per-request RBAC resolve becomes the dominant Neon read; this collapses it to
# ~1 query per email per TTL window. Revocations propagate within the TTL (plus
# the frontend's tab-focus refetch). Set rbac_cache_ttl_seconds=0 to disable.
_rbac_cache: dict[str, tuple[float, AccessProfile]] = {}
_rbac_lock = threading.Lock()


def resolve_access_cached(session: Session, email: str | None) -> AccessProfile:
    """`resolve_access` with a short-TTL in-process cache. Returns a deep copy
    so callers (e.g. the preview-as path, which sets `email` / `is_preview` on
    the result) can mutate freely without corrupting the cached profile."""
    ttl = settings.rbac_cache_ttl_seconds
    if not email or ttl <= 0:
        return resolve_access(session, email)
    e = email.strip().lower()
    now = time.monotonic()
    with _rbac_lock:
        hit = _rbac_cache.get(e)
        if hit is not None and (now - hit[0]) < ttl:
            return copy.deepcopy(hit[1])
    profile = resolve_access(session, e)
    with _rbac_lock:
        _rbac_cache[e] = (now, profile)
    return copy.deepcopy(profile)


def clear_rbac_cache() -> None:
    """Drop all cached access profiles (tests / explicit invalidation)."""
    with _rbac_lock:
        _rbac_cache.clear()


def assigned_client_names(session: Session, email: str) -> set[str]:
    """Set of client names the user has at least one pod_assignment row
    for. Used by the API client-scope filter when `client_scope = 'assigned'`."""
    rows = session.execute(
        select(PodAssignment.client_name).where(PodAssignment.email == email.strip().lower())
    ).all()
    return {r[0] for r in rows if r[0]}


# ───────────────────────────────────────────────────────────────────────
# Audit log helper — thin wrapper around AuditLog so access-control
# mutations always land with a consistent shape.
# ───────────────────────────────────────────────────────────────────────


def audit_access(
    session: Session,
    *,
    actor_email: str,
    action: str,
    affected: str,
    detail: dict,
) -> None:
    """Write a single row to `audit_log` describing an access-control
    mutation. Caller commits."""
    import json

    from app.models import AuditLog

    session.add(
        AuditLog(
            entity_type="access_control",
            entity_id=None,
            action=action,
            changes_json=json.dumps({"affected": affected, **detail}),
            performed_by=actor_email,
        )
    )
