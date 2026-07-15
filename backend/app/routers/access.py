"""RBAC API — `/api/access/*`.

Endpoints map 1:1 to the frontend's Access Control UI:

    GET  /api/access/me              — current user's resolved profile
    GET  /api/access/views           — view catalog (for the matrix columns)
    GET  /api/access/groups          — list groups (left-rail of Groups tab)
    GET  /api/access/groups/{slug}   — group detail (members + permissions)
    GET  /api/access/users           — User × Views matrix (Users tab)
    GET  /api/access/audit           — recent permission changes
    POST /api/access/groups/{slug}/members
    DEL  /api/access/groups/{slug}/members/{email}
    PUT  /api/access/groups/{slug}/permissions/{view_slug}
    PUT  /api/access/users/{email}/overrides/{view_slug}
    DEL  /api/access/users/{email}/overrides/{view_slug}

Every mutation is admin-only and writes to `audit_log`. Reads of /me,
/views, /groups, /users, /audit require authentication but do NOT require
the `admin.access` view — VPs and BI Team need to see the matrix to know
who has access to what, even though they can't edit it.
"""

from __future__ import annotations

import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.auth_deps import (
    current_access,
    get_sync_session,
    require_access_editor,
    require_authenticated,
)
from app.models import (
    AccessGroup,
    AccessGroupMember,
    AccessGroupViewPermission,
    AccessUserOverride,
    AccessView,
    AuditLog,
    PodAssignment,
)
from app.services.access import AccessProfile, audit_access

router = APIRouter()


# ───────────────────────────────────────────────────────────────────────
# Schemas
# ───────────────────────────────────────────────────────────────────────


class AccessMeResponse(BaseModel):
    email: str
    is_authenticated: bool
    is_admin: bool
    group_slugs: list[str]
    view_slugs: list[str]
    pod_kind_lock: str | None
    can_toggle_axis: bool
    pod_number_lock: str | None
    client_scope: str
    is_preview: bool = False


class ViewResponse(BaseModel):
    slug: str
    label: str
    parent_label: str  # section: "Dashboards" / "Data" / "Admin"
    dashboard_label: str  # middle level (e.g. "Editorial Clients", "Overview")
    sort_order: int


class GroupMemberResponse(BaseModel):
    email: str
    source: str  # seed | manual | derived
    can_remove: bool


class GroupSummaryResponse(BaseModel):
    slug: str
    name: str
    description: str | None
    is_seeded: bool
    is_pod_derived: bool
    last_synced_at: datetime | None
    member_count: int


class GroupDetailResponse(BaseModel):
    slug: str
    name: str
    description: str | None
    is_seeded: bool
    is_pod_derived: bool
    last_synced_at: datetime | None
    members: list[GroupMemberResponse]
    permissions: dict[str, bool]  # view_slug → can_view


class UserMatrixRow(BaseModel):
    email: str
    display_name: str
    groups: list[str]
    pod_kind: str | None
    pod_number: str | None
    role: str | None
    permissions: dict[str, bool]  # view_slug → effective can_view (group ∪ override)
    overrides: dict[str, bool]  # view_slug → override-only (for UI badges)
    # True when this email is a seeded member of the **admin** group
    # (Daniela / Ricardo by default). The two pills under Access Control
    # are locked for these users regardless of who's editing — a guard
    # against the original admin baseline being accidentally locked out.
    is_seeded_admin: bool = False


class AuditEntryResponse(BaseModel):
    id: int
    when: datetime
    actor: str
    action: str
    affected: str | None
    detail: dict


class AddMemberBody(BaseModel):
    email: str = Field(min_length=3, max_length=255)


class SetPermissionBody(BaseModel):
    can_view: bool


class SetOverrideBody(BaseModel):
    can_view: bool


# ───────────────────────────────────────────────────────────────────────
# Read endpoints
# ───────────────────────────────────────────────────────────────────────


@router.get("/me", response_model=AccessMeResponse)
def access_me(profile: AccessProfile = Depends(current_access)):
    """Current user's effective profile. Drives the entire UI gating layer
    on the frontend. Returns an unauthenticated profile (empty view set,
    no groups) when no `X-User-Email` header is present so the page can
    redirect to login."""
    return AccessMeResponse(
        email=profile.email,
        is_authenticated=profile.is_authenticated,
        is_admin=profile.is_admin,
        group_slugs=profile.group_slugs,
        view_slugs=sorted(profile.view_slugs),
        pod_kind_lock=profile.pod_kind_lock,
        can_toggle_axis=profile.can_toggle_axis,
        pod_number_lock=profile.pod_number_lock,
        client_scope=profile.client_scope,
        is_preview=profile.is_preview,
    )


@router.get("/views", response_model=list[ViewResponse])
def list_views(_: AccessProfile = Depends(require_authenticated)):
    with get_sync_session() as session:
        rows = (
            session.execute(select(AccessView).order_by(AccessView.sort_order, AccessView.label))
            .scalars()
            .all()
        )
        return [
            ViewResponse(
                slug=v.slug,
                label=v.label,
                parent_label=v.parent_label,
                dashboard_label=v.dashboard_label or v.label,
                sort_order=v.sort_order,
            )
            for v in rows
        ]


@router.get("/groups", response_model=list[GroupSummaryResponse])
def list_groups(_: AccessProfile = Depends(require_authenticated)):
    with get_sync_session() as session:
        groups = (
            session.execute(select(AccessGroup).order_by(AccessGroup.sort_order, AccessGroup.id))
            .scalars()
            .all()
        )
        out: list[GroupSummaryResponse] = []
        for g in groups:
            count = (
                session.execute(select(AccessGroupMember).where(AccessGroupMember.group_id == g.id))
                .scalars()
                .all()
            )
            out.append(
                GroupSummaryResponse(
                    slug=g.slug,
                    name=g.name,
                    description=g.description,
                    is_seeded=g.is_seeded,
                    is_pod_derived=g.is_pod_derived,
                    last_synced_at=g.last_synced_at,
                    member_count=len(count),
                )
            )
        return out


@router.get("/groups/{slug}", response_model=GroupDetailResponse)
def group_detail(slug: str, _: AccessProfile = Depends(require_authenticated)):
    with get_sync_session() as session:
        g = session.execute(
            select(AccessGroup).where(AccessGroup.slug == slug)
        ).scalar_one_or_none()
        if g is None:
            raise HTTPException(status_code=404, detail=f"Group '{slug}' not found")
        members = (
            session.execute(
                select(AccessGroupMember)
                .where(AccessGroupMember.group_id == g.id)
                .order_by(AccessGroupMember.email)
            )
            .scalars()
            .all()
        )
        # Permissions keyed by view slug for easy frontend lookup.
        perms = session.execute(
            select(AccessView.slug, AccessGroupViewPermission.can_view)
            .join(AccessGroupViewPermission, AccessGroupViewPermission.view_id == AccessView.id)
            .where(AccessGroupViewPermission.group_id == g.id)
        ).all()
        return GroupDetailResponse(
            slug=g.slug,
            name=g.name,
            description=g.description,
            is_seeded=g.is_seeded,
            is_pod_derived=g.is_pod_derived,
            last_synced_at=g.last_synced_at,
            members=[
                GroupMemberResponse(
                    email=m.email,
                    source=m.source,
                    # Seed members are PROTECTED — UI must hide the remove
                    # button. Manual + derived can be removed (derived will
                    # repopulate on next sync, manual won't).
                    can_remove=(m.source != "seed"),
                )
                for m in members
            ],
            permissions={slug: bool(can_view) for slug, can_view in perms},
        )


class RosterPersonRow(BaseModel):
    """One selectable person for the member-add picker."""

    name: str
    emails: list[str]
    role: str | None = None
    title: str | None = None
    department: str | None = None


@router.get("/roster", response_model=list[RosterPersonRow])
async def list_roster(_: AccessProfile = Depends(require_authenticated)):
    """People roster for the member-add dropdown — from BQ `v_company_roster`
    (all-company: Rippling employees + Slack writers + legacy), one row per
    person with their email(s) + title/department for the search results.
    Degrades to [] if BigQuery is unreachable (the picker just shows nothing)."""
    import asyncio

    from app.config import settings

    ds = f"{settings.bq_project}.{settings.bq_dataset}"

    def _fetch() -> list[dict]:
        from app.services.bq_dashboard import q

        return q(
            "SELECT canonical_name AS name, "
            "ARRAY_AGG(DISTINCT work_email IGNORE NULLS ORDER BY work_email) AS emails, "
            "ANY_VALUE(title) AS title, ANY_VALUE(department) AS department, MIN(role) AS role "
            f"FROM `{ds}.v_company_roster` "
            "WHERE is_active AND canonical_name IS NOT NULL "
            "GROUP BY canonical_name ORDER BY canonical_name"
        )

    try:
        rows = await asyncio.to_thread(_fetch)
    except Exception:
        return []
    out: list[RosterPersonRow] = []
    for r in rows:
        emails = [e for e in (r.get("emails") or []) if e]
        if not emails:  # can't add someone with no email
            continue
        out.append(
            RosterPersonRow(
                name=r["name"],
                emails=emails,
                role=r.get("role"),
                title=r.get("title"),
                department=r.get("department"),
            )
        )
    return out


@router.get("/users", response_model=list[UserMatrixRow])
def list_users(_: AccessProfile = Depends(require_authenticated)):
    """Returns one row per known email — the union of every email that
    appears in any access table or the pod_assignments roster. Drives the
    Users × Views matrix tab.

    Heavily optimized: this endpoint used to call `resolve_access()` per
    email inside a loop, doing ~5 round-trips per user × ~120 users =
    ~600 queries against Neon (15-25s page load). Now every table is
    pulled ONCE up-front into Python dicts; the per-user composition is
    pure in-memory work."""
    from app.services.access import seeded_admin_emails

    seeded_admins = seeded_admin_emails()
    with get_sync_session() as session:
        # 1) Every view (slug + sort order).
        all_views = (
            session.execute(select(AccessView).order_by(AccessView.sort_order)).scalars().all()
        )
        view_slugs = [v.slug for v in all_views]
        view_id_to_slug = {v.id: v.slug for v in all_views}

        # 2) Every group + its slug.
        all_groups = session.execute(select(AccessGroup)).scalars().all()
        group_id_to_slug = {g.id: g.slug for g in all_groups}

        # 3) Every group → which views it grants (slug set).
        perm_rows = session.execute(
            select(
                AccessGroupViewPermission.group_id,
                AccessGroupViewPermission.view_id,
                AccessGroupViewPermission.can_view,
            )
        ).all()
        group_views: dict[int, set[str]] = {}
        for gid, vid, can_view in perm_rows:
            if not can_view:
                continue
            slug = view_id_to_slug.get(vid)
            if slug is None:
                continue
            group_views.setdefault(gid, set()).add(slug)

        # 4) Email → list of group_id (and ordered group_slug list).
        member_rows = session.execute(
            select(AccessGroupMember.email, AccessGroupMember.group_id)
        ).all()
        email_to_group_ids: dict[str, list[int]] = {}
        for email, gid in member_rows:
            email_to_group_ids.setdefault(email, []).append(gid)

        # 5) Email → {view_slug: can_view} overrides.
        override_rows = session.execute(
            select(
                AccessUserOverride.email,
                AccessUserOverride.view_id,
                AccessUserOverride.can_view,
            )
        ).all()
        email_overrides: dict[str, dict[str, bool]] = {}
        for email, vid, can_view in override_rows:
            slug = view_id_to_slug.get(vid)
            if slug is None:
                continue
            email_overrides.setdefault(email, {})[slug] = bool(can_view)

        # 6) Email → display info from pod_assignments (one row per email
        #    after collapsing — prefer non-pod_member roles).
        pa_rows = session.execute(select(PodAssignment)).scalars().all()
        info: dict[str, dict] = {}
        for r in pa_rows:
            slot = info.setdefault(
                r.email,
                {
                    "display_name": r.display_name,
                    "pod_kind": r.pod_kind,
                    "pod_number": r.pod_number,
                    "role": r.role,
                },
            )
            if slot["role"] == "pod_member" and r.role != "pod_member":
                slot["role"] = r.role

        # 7) Union of every email known to the matrix.
        member_emails = set(email_to_group_ids.keys())
        override_emails = set(email_overrides.keys())
        pod_emails = {r.email for r in pa_rows}
        all_emails = sorted(member_emails | override_emails | pod_emails)

        # Compose each row in memory — zero queries from here on.
        out: list[UserMatrixRow] = []
        for email in all_emails:
            gids = email_to_group_ids.get(email, [])
            group_slugs = [group_id_to_slug[gid] for gid in gids if gid in group_id_to_slug]

            # Default view set = union of every group's grants.
            view_set: set[str] = set()
            for gid in gids:
                view_set |= group_views.get(gid, set())

            # Overrides flip the bit either way.
            overrides = email_overrides.get(email, {})
            for slug, can_view in overrides.items():
                if can_view:
                    view_set.add(slug)
                else:
                    view_set.discard(slug)

            permissions = {slug: (slug in view_set) for slug in view_slugs}

            inf = info.get(email, {})
            out.append(
                UserMatrixRow(
                    email=email,
                    display_name=inf.get("display_name") or email.split("@")[0],
                    groups=group_slugs,
                    pod_kind=inf.get("pod_kind"),
                    pod_number=inf.get("pod_number"),
                    role=inf.get("role"),
                    permissions=permissions,
                    overrides=overrides,
                    is_seeded_admin=email.lower() in seeded_admins,
                )
            )
        return out


@router.get("/audit", response_model=list[AuditEntryResponse])
def access_audit(
    limit: int = 100,
    _: AccessProfile = Depends(require_authenticated),
):
    with get_sync_session() as session:
        rows = (
            session.execute(
                select(AuditLog)
                .where(AuditLog.entity_type == "access_control")
                .order_by(AuditLog.performed_at.desc())
                .limit(min(limit, 500))
            )
            .scalars()
            .all()
        )
        out: list[AuditEntryResponse] = []
        for r in rows:
            try:
                detail = json.loads(r.changes_json or "{}")
            except json.JSONDecodeError:
                detail = {}
            out.append(
                AuditEntryResponse(
                    id=r.id,
                    when=r.performed_at,
                    actor=r.performed_by or "system",
                    action=r.action,
                    affected=detail.pop("affected", None),
                    detail=detail,
                )
            )
        return out


# ───────────────────────────────────────────────────────────────────────
# Mutations
# ───────────────────────────────────────────────────────────────────────
#
# Two privilege tiers:
#   • require_admin           — true Admin group. Required for sensitive
#     ops that could escalate privilege: membership changes on the admin
#     group, permission grants on `admin.access` / `admin.access.edit`,
#     and overrides on those same views.
#   • require_access_editor   — Admin OR holder of the `admin.access.edit`
#     view. Cell-level edits to anything that ISN'T the admin group or the
#     access-edit views themselves.
#
# Each endpoint applies the right tier as its dependency, then re-checks
# the sensitive cases inline so a non-admin holding `admin.access.edit`
# still gets a 403 when reaching for the escalation paths.

# View slugs that, when targeted, require true admin (not just access editor).
# Granting these is the privilege-escalation door, so we bolt it shut.
_ADMIN_ONLY_VIEW_SLUGS = frozenset({"admin.access", "admin.access.edit"})

# Group slugs whose membership changes require true admin.
_ADMIN_ONLY_GROUP_SLUGS = frozenset({"admin"})


def _ensure_admin(actor: AccessProfile, reason: str) -> None:
    if not actor.is_admin:
        raise HTTPException(status_code=403, detail=reason)


@router.post("/groups/{slug}/members", response_model=GroupDetailResponse)
def add_group_member(
    slug: str,
    body: AddMemberBody,
    actor: AccessProfile = Depends(require_access_editor),
):
    if slug in _ADMIN_ONLY_GROUP_SLUGS:
        _ensure_admin(actor, "Only Admin-group members can edit Admin group membership")
    email = body.email.strip().lower()
    with get_sync_session() as session:
        group = session.execute(
            select(AccessGroup).where(AccessGroup.slug == slug)
        ).scalar_one_or_none()
        if group is None:
            raise HTTPException(status_code=404, detail=f"Group '{slug}' not found")
        existing = session.execute(
            select(AccessGroupMember).where(
                AccessGroupMember.group_id == group.id,
                AccessGroupMember.email == email,
            )
        ).scalar_one_or_none()
        if existing:
            raise HTTPException(status_code=409, detail=f"{email} is already a member of '{slug}'")
        session.add(
            AccessGroupMember(
                group_id=group.id,
                email=email,
                source="manual",
                added_by_email=actor.email,
            )
        )
        audit_access(
            session,
            actor_email=actor.email,
            action="ADD_GROUP_MEMBER",
            affected=email,
            detail={"group": slug},
        )
        session.commit()
    return group_detail(slug)


@router.delete("/groups/{slug}/members/{email}", response_model=GroupDetailResponse)
def remove_group_member(
    slug: str,
    email: str,
    actor: AccessProfile = Depends(require_access_editor),
):
    if slug in _ADMIN_ONLY_GROUP_SLUGS:
        _ensure_admin(actor, "Only Admin-group members can edit Admin group membership")
    email = email.strip().lower()
    with get_sync_session() as session:
        group = session.execute(
            select(AccessGroup).where(AccessGroup.slug == slug)
        ).scalar_one_or_none()
        if group is None:
            raise HTTPException(status_code=404, detail=f"Group '{slug}' not found")
        member = session.execute(
            select(AccessGroupMember).where(
                AccessGroupMember.group_id == group.id,
                AccessGroupMember.email == email,
            )
        ).scalar_one_or_none()
        if member is None:
            raise HTTPException(status_code=404, detail=f"{email} is not a member of '{slug}'")
        if member.source == "seed":
            raise HTTPException(
                status_code=403,
                detail=(
                    f"{email} is a seeded member of '{slug}' and cannot be removed. "
                    "Only manually-added or derived members can be unlinked."
                ),
            )
        session.delete(member)
        audit_access(
            session,
            actor_email=actor.email,
            action="REMOVE_GROUP_MEMBER",
            affected=email,
            detail={"group": slug, "previous_source": member.source},
        )
        session.commit()
    return group_detail(slug)


@router.put("/groups/{slug}/permissions/{view_slug}", response_model=GroupDetailResponse)
def set_group_permission(
    slug: str,
    view_slug: str,
    body: SetPermissionBody,
    actor: AccessProfile = Depends(require_access_editor),
):
    # The Admin group's permissions are immutable — admin = full access by
    # definition; flipping any cell off would brick the matrix for everyone.
    if slug in _ADMIN_ONLY_GROUP_SLUGS:
        raise HTTPException(
            status_code=403,
            detail="Admin group permissions are read-only — admin always has full access.",
        )
    if view_slug in _ADMIN_ONLY_VIEW_SLUGS:
        _ensure_admin(
            actor,
            "Only Admin-group members can grant Access Control view/edit privileges",
        )
    with get_sync_session() as session:
        group = session.execute(
            select(AccessGroup).where(AccessGroup.slug == slug)
        ).scalar_one_or_none()
        if group is None:
            raise HTTPException(status_code=404, detail=f"Group '{slug}' not found")
        view = session.execute(
            select(AccessView).where(AccessView.slug == view_slug)
        ).scalar_one_or_none()
        if view is None:
            raise HTTPException(status_code=404, detail=f"View '{view_slug}' not found")
        perm = session.execute(
            select(AccessGroupViewPermission).where(
                AccessGroupViewPermission.group_id == group.id,
                AccessGroupViewPermission.view_id == view.id,
            )
        ).scalar_one_or_none()
        if perm is None:
            perm = AccessGroupViewPermission(
                group_id=group.id, view_id=view.id, can_view=body.can_view
            )
            session.add(perm)
        else:
            perm.can_view = body.can_view
        audit_access(
            session,
            actor_email=actor.email,
            action="SET_GROUP_PERMISSION",
            affected=f"{slug} → {view_slug}",
            detail={"group": slug, "view": view_slug, "can_view": body.can_view},
        )
        session.commit()
    return group_detail(slug)


@router.put("/users/{email}/overrides/{view_slug}", response_model=UserMatrixRow)
def set_user_override(
    email: str,
    view_slug: str,
    body: SetOverrideBody,
    actor: AccessProfile = Depends(require_access_editor),
):
    if view_slug in _ADMIN_ONLY_VIEW_SLUGS:
        _ensure_admin(
            actor,
            "Only Admin-group members can override Access Control view/edit privileges",
        )
    email = email.strip().lower()
    # Seeded admins (Daniela / Ricardo) are immutable across EVERY view,
    # for EVERYONE — even other admins can't override them. Protects the
    # original admin baseline so admins can't accidentally revoke each
    # other's access on any matrix column.
    from app.services.access import seeded_admin_emails

    if email in seeded_admin_emails():
        raise HTTPException(
            status_code=403,
            detail=(
                f"{email} is a seeded Admin and is locked across the whole "
                "matrix. Per-user overrides aren't allowed on seeded admins."
            ),
        )
    with get_sync_session() as session:
        view = session.execute(
            select(AccessView).where(AccessView.slug == view_slug)
        ).scalar_one_or_none()
        if view is None:
            raise HTTPException(status_code=404, detail=f"View '{view_slug}' not found")
        existing = session.execute(
            select(AccessUserOverride).where(
                AccessUserOverride.email == email,
                AccessUserOverride.view_id == view.id,
            )
        ).scalar_one_or_none()
        if existing is None:
            session.add(
                AccessUserOverride(
                    email=email,
                    view_id=view.id,
                    can_view=body.can_view,
                    set_by_email=actor.email,
                )
            )
        else:
            existing.can_view = body.can_view
            existing.set_by_email = actor.email
        audit_access(
            session,
            actor_email=actor.email,
            action="SET_USER_OVERRIDE",
            affected=email,
            detail={"view": view_slug, "can_view": body.can_view},
        )
        session.commit()
    # Return the updated row from the matrix endpoint logic.
    rows = list_users()
    for r in rows:
        if r.email == email:
            return r
    raise HTTPException(status_code=500, detail="Override saved but row not rebuilt")


@router.delete("/users/{email}/overrides/{view_slug}", response_model=UserMatrixRow)
def clear_user_override(
    email: str,
    view_slug: str,
    actor: AccessProfile = Depends(require_access_editor),
):
    if view_slug in _ADMIN_ONLY_VIEW_SLUGS:
        _ensure_admin(
            actor,
            "Only Admin-group members can clear Access Control view/edit overrides",
        )
    email_norm = email.strip().lower()
    # Seeded admins (Daniela / Ricardo) shouldn't carry overrides on any
    # view. Stale rows are wiped by the seed step at startup, but we also
    # reject the API path so the UI lock is mirrored on the server.
    from app.services.access import seeded_admin_emails

    if email_norm in seeded_admin_emails():
        raise HTTPException(
            status_code=403,
            detail=(
                f"{email_norm} is a seeded Admin; per-user overrides aren't "
                "allowed on seeded admins. Stale overrides are cleaned up on "
                "the next backend restart."
            ),
        )
    email = email.strip().lower()
    with get_sync_session() as session:
        view = session.execute(
            select(AccessView).where(AccessView.slug == view_slug)
        ).scalar_one_or_none()
        if view is None:
            raise HTTPException(status_code=404, detail=f"View '{view_slug}' not found")
        existing = session.execute(
            select(AccessUserOverride).where(
                AccessUserOverride.email == email,
                AccessUserOverride.view_id == view.id,
            )
        ).scalar_one_or_none()
        if existing is None:
            raise HTTPException(status_code=404, detail=f"No override on '{view_slug}' for {email}")
        session.delete(existing)
        audit_access(
            session,
            actor_email=actor.email,
            action="CLEAR_USER_OVERRIDE",
            affected=email,
            detail={"view": view_slug},
        )
        session.commit()
    rows = list_users()
    for r in rows:
        if r.email == email:
            return r
    raise HTTPException(status_code=500, detail="Override cleared but row not rebuilt")


@router.delete("/users/{email}/overrides", response_model=UserMatrixRow)
def reset_user_overrides(
    email: str,
    actor: AccessProfile = Depends(require_access_editor),
):
    """Bulk clear every per-user override for `email`. After this the user
    falls back to whatever permissions their group(s) grant. Useful when
    a user's matrix row has accumulated experimental flags and we want to
    snap them back to the canonical group default."""
    email_norm = email.strip().lower()
    from app.services.access import seeded_admin_emails

    # Seeded admins shouldn't carry overrides; the seed step wipes any
    # that exist on startup. Block the API path to mirror the UI lock.
    if email_norm in seeded_admin_emails():
        raise HTTPException(
            status_code=403,
            detail=(f"{email_norm} is a seeded Admin; per-user overrides aren't allowed."),
        )

    with get_sync_session() as session:
        # Inspect what we're about to delete — if any override touches a
        # sensitive view (admin.access / admin.access.edit), require true
        # Admin even if the actor holds `admin.access.edit`. Same
        # escalation guard as the single-clear endpoint, just batched.
        rows = session.execute(
            select(AccessUserOverride, AccessView.slug)
            .join(AccessView, AccessView.id == AccessUserOverride.view_id)
            .where(AccessUserOverride.email == email_norm)
        ).all()
        if not rows:
            # Nothing to do — return the user's current row.
            users = list_users()
            for r in users:
                if r.email == email_norm:
                    return r
            raise HTTPException(status_code=404, detail=f"User '{email_norm}' not found")

        touches_sensitive = any(slug in _ADMIN_ONLY_VIEW_SLUGS for _, slug in rows)
        if touches_sensitive:
            _ensure_admin(
                actor,
                "Only Admin-group members can clear Access Control view/edit overrides",
            )

        view_slugs_cleared = [slug for _, slug in rows]
        for override, _slug in rows:
            session.delete(override)

        audit_access(
            session,
            actor_email=actor.email,
            action="RESET_USER_OVERRIDES",
            affected=email_norm,
            detail={"views_cleared": view_slugs_cleared, "count": len(rows)},
        )
        session.commit()

    users = list_users()
    for r in users:
        if r.email == email_norm:
            return r
    raise HTTPException(status_code=500, detail="Overrides reset but row not rebuilt")
