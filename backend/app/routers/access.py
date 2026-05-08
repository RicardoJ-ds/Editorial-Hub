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
from app.services.access import AccessProfile, audit_access, resolve_access

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
        groups = session.execute(select(AccessGroup).order_by(AccessGroup.id)).scalars().all()
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


@router.get("/users", response_model=list[UserMatrixRow])
def list_users(_: AccessProfile = Depends(require_authenticated)):
    """Returns one row per known email — the union of every email that
    appears in any access table or the pod_assignments roster. Drives the
    Users × Views matrix tab."""
    from app.services.access import seeded_admin_emails

    seeded_admins = seeded_admin_emails()
    with get_sync_session() as session:
        # Gather distinct emails from the three sources.
        member_emails = {
            r[0] for r in session.execute(select(AccessGroupMember.email).distinct()).all()
        }
        override_emails = {
            r[0] for r in session.execute(select(AccessUserOverride.email).distinct()).all()
        }
        pod_emails = {r[0] for r in session.execute(select(PodAssignment.email).distinct()).all()}
        all_emails = sorted(member_emails | override_emails | pod_emails)

        # Display info per email (best-effort lookup from pod_assignments).
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
            # Prefer non-pod_member roles for the display "role" — they're
            # more specific (senior_editor > pod_member).
            if slot["role"] == "pod_member" and r.role != "pod_member":
                slot["role"] = r.role

        out: list[UserMatrixRow] = []
        for email in all_emails:
            profile = resolve_access(session, email)
            overrides_rows = session.execute(
                select(AccessView.slug, AccessUserOverride.can_view)
                .join(AccessUserOverride, AccessUserOverride.view_id == AccessView.id)
                .where(AccessUserOverride.email == email)
            ).all()
            override_map = {slug: bool(cv) for slug, cv in overrides_rows}

            # Effective permissions = union of group defaults overridden by
            # user overrides — same logic as resolver.
            effective_views = profile.view_slugs
            view_slugs = [
                v.slug
                for v in session.execute(select(AccessView).order_by(AccessView.sort_order))
                .scalars()
                .all()
            ]
            permissions = {slug: (slug in effective_views) for slug in view_slugs}

            inf = info.get(email, {})
            out.append(
                UserMatrixRow(
                    email=email,
                    display_name=inf.get("display_name") or email.split("@")[0],
                    groups=profile.group_slugs,
                    pod_kind=inf.get("pod_kind"),
                    pod_number=inf.get("pod_number"),
                    role=inf.get("role"),
                    permissions=permissions,
                    overrides=override_map,
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
