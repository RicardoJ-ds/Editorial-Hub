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

from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

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

_VIEWS: list[tuple[str, str, str, int]] = [
    # (slug,                    label,                  parent,            sort_order)
    ("overview", "Overview", "Dashboards", 10),
    ("d1.contract", "Contract & Timeline", "Editorial Clients", 20),
    ("d1.deliverables", "Deliverables vs SOW", "Editorial Clients", 21),
    ("d2.kpi", "KPI Performance", "Team KPIs", 30),
    ("d2.capacity", "Capacity Projections", "Team KPIs", 31),
    ("d2.ai", "AI Compliance", "Team KPIs", 32),
    ("cp2", "Capacity Planning v2", "Proposal", 40),
    ("data.import", "Import Data", "Data", 50),
    ("admin.access", "Access Control", "Admin", 60),
    ("admin.data_quality", "Data Quality", "Admin", 61),
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
        "slug": "vps_managers",
        "name": "VPs and Managers",
        "description": "Dashboards + view-only Access Control. Toggle between Editorial / Growth axes.",
        "is_seeded": True,
        "is_pod_derived": False,
    },
    {
        "slug": "leadership",
        "name": "Leadership",
        "description": (
            "Dashboards only, restricted to clients they're assigned to. Auto-includes "
            "Senior Editors (from Editorial Team sheet) + Growth Lead / SR Growth Director "
            "(from Growth Team sheet)."
        ),
        "is_seeded": True,
        "is_pod_derived": True,  # leadership pulls from pod_assignments
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
        "description": "Auto-populated from the Editorial Team sheet. Locked to Editorial axis, only own pod's clients.",
        "is_seeded": True,
        "is_pod_derived": True,
    },
    {
        "slug": "growth_team",
        "name": "Growth Team",
        "description": "Auto-populated from the Growth Team sheet. Locked to Growth axis, only own pod's clients.",
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
    "vps_managers": [
        "rafa@graphitehq.com",
        "marcos@graphitehq.com",
        "juan.cardoso@graphitehq.com",
        "ethan@graphitehq.com",
        "caitlin@graphitehq.com",
        "ainoa@graphitehq.com",
    ],
    "bi_team": [
        "ricardo.jaramillo@graphitehq.com",
        "simon.betancur@graphitehq.com",
        "paolo.cavalli@graphitehq.com",
    ],
    # Leadership is derived — no seed list.
    "leadership": [],
    "editorial_team": [],
    "growth_team": [],
}

# ─── Default permission matrix ───────────────────────────────────────────
# Maps group_slug → set of view slugs the group can_view by default.
# Anything not listed defaults to can_view=False.

_DEFAULT_PERMISSIONS: dict[str, set[str]] = {
    "admin": {v[0] for v in _VIEWS},  # admin sees everything
    "vps_managers": {
        "overview",
        "d1.contract",
        "d1.deliverables",
        "d2.kpi",
        "d2.capacity",
        "d2.ai",
        "cp2",
        "admin.access",
    },
    "leadership": {
        "overview",
        "d1.contract",
        "d1.deliverables",
        "d2.kpi",
        "d2.capacity",
        "d2.ai",
        "cp2",
    },
    "bi_team": {
        "overview",
        "d1.contract",
        "d1.deliverables",
        "d2.kpi",
        "d2.capacity",
        "d2.ai",
        "cp2",
        "data.import",
        "admin.access",
        "admin.data_quality",
    },
    "editorial_team": {
        # Dashboards minus Overview per spec.
        "d1.contract",
        "d1.deliverables",
        "d2.kpi",
        "d2.capacity",
        "d2.ai",
        "cp2",
    },
    "growth_team": {
        "d1.contract",
        "d1.deliverables",
        "d2.kpi",
        "d2.capacity",
        "d2.ai",
        "cp2",
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
    #    parent / sort_order refreshed so renames in `_VIEWS` propagate.
    existing_views = {v.slug: v for v in session.execute(select(AccessView)).scalars().all()}
    for slug, label, parent, order in _VIEWS:
        v = existing_views.get(slug)
        if v is None:
            v = AccessView(slug=slug, label=label, parent_label=parent, sort_order=order)
            session.add(v)
        else:
            v.label = label
            v.parent_label = parent
            v.sort_order = order

    # 2) Groups — insert missing, update mutable metadata (description /
    #    flags) on existing rows.
    existing_groups = {g.slug: g for g in session.execute(select(AccessGroup)).scalars().all()}
    for spec in _GROUPS:
        g = existing_groups.get(spec["slug"])
        if g is None:
            g = AccessGroup(**spec)
            session.add(g)
        else:
            g.name = spec["name"]
            g.description = spec["description"]
            g.is_seeded = spec["is_seeded"]
            g.is_pod_derived = spec["is_pod_derived"]

    session.flush()  # surface the inserted IDs

    # Reload after flush so we have IDs.
    views_by_slug = {v.slug: v for v in session.execute(select(AccessView)).scalars().all()}
    groups_by_slug = {g.slug: g for g in session.execute(select(AccessGroup)).scalars().all()}

    # 3) Seed members — insert any missing seed rows. Never delete.
    for group_slug, emails in _SEED_MEMBERS.items():
        group = groups_by_slug[group_slug]
        existing_emails = {
            row.email
            for row in session.execute(
                select(AccessGroupMember).where(
                    AccessGroupMember.group_id == group.id,
                    AccessGroupMember.source == "seed",
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

    session.commit()


# ───────────────────────────────────────────────────────────────────────
# Refresh derived members from pod_assignments
# ───────────────────────────────────────────────────────────────────────


# Roles that qualify a person for the Leadership group. Mirrors the spec:
# "all growth leadership members in the Growth pod table, and Senior
# Editors in the Editorial Team sheet". Sr Growth Lead / Growth Director
# are included since they're functional leadership in the Growth org.
_LEADERSHIP_ROLES = {
    "senior_editor",
    "growth_lead",
    "sr_growth_lead",
    "growth_director",
    "sr_growth_director",
    "managing_director",
    "sr_growth_director_or_managing_director",
}


def refresh_pod_derived_members(session: Session) -> dict[str, int]:
    """Rebuild the `derived`-source membership of the three pod-derived
    groups. Manual + seed members are untouched.

    Called at the end of `import_team_pods`. Returns a count summary
    `{group_slug: derived_count}` for logging."""

    groups_by_slug = {g.slug: g for g in session.execute(select(AccessGroup)).scalars().all()}

    # Distinct emails per pod_kind.
    editorial_emails: set[str] = set()
    growth_emails: set[str] = set()
    leadership_emails: set[str] = set()
    for row in session.execute(select(PodAssignment)).scalars().all():
        e = (row.email or "").strip().lower()
        if not e:
            continue
        if row.pod_kind == "editorial":
            editorial_emails.add(e)
        elif row.pod_kind == "growth":
            growth_emails.add(e)
        if row.role in _LEADERSHIP_ROLES:
            leadership_emails.add(e)

    plan: dict[str, set[str]] = {
        "editorial_team": editorial_emails,
        "growth_team": growth_emails,
        "leadership": leadership_emails,
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
    if "admin" in group_slugs or "vps_managers" in group_slugs or "bi_team" in group_slugs:
        profile.can_toggle_axis = True
        profile.client_scope = "all"
        profile.pod_kind_lock = None
    elif "leadership" in group_slugs:
        profile.can_toggle_axis = False
        profile.client_scope = "assigned"
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
