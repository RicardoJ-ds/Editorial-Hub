"""Auth dependencies for FastAPI endpoints.

The frontend's API client (`lib/api.ts`) injects `X-User-Email` on every
backend call, sourced from the decoded session cookie via the Next.js
`/api/me` route. The backend trusts the header — see the comment in
`api.ts` for the trust-boundary rationale.

These dependencies do three things:
  1. `current_email`        — extract the email from the request header.
  2. `current_access`       — resolve to an `AccessProfile`.
  3. `require_view(slug)`   — 403 unless the profile grants the slug.
  4. `require_admin`        — 403 unless the profile is admin.

Anything that needs a more granular check (e.g. "must be in this group
to remove a member") composes off of these.
"""

from __future__ import annotations

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.config import settings
from app.database import prepare_sync_url
from app.services.access import AccessProfile, resolve_access

_sync_engine = None


def _get_sync_engine():
    global _sync_engine
    if _sync_engine is None:
        _sync_engine = create_engine(prepare_sync_url(settings.database_url), echo=False)
    return _sync_engine


def get_sync_session() -> Session:
    """Sync session for RBAC reads — the resolver is sync because it's
    called from places that don't have an AsyncSession (e.g. importer)."""
    return Session(_get_sync_engine())


def current_email(
    request: Request,
    x_user_email: str | None = Header(default=None, alias="X-User-Email"),
) -> str | None:
    """Pull the current user's email from the X-User-Email header.

    Honors `X-Preview-As` only when set by an admin — the actual gate runs
    inside `current_access`, since at this point we don't yet know if the
    real user is admin. This dep just exposes the raw header.
    """
    if x_user_email:
        return x_user_email.strip().lower() or None
    return None


def current_access(
    real_email: str | None = Depends(current_email),
    x_preview_as: str | None = Header(default=None, alias="X-Preview-As"),
) -> AccessProfile:
    """Resolve the request's effective AccessProfile. When the real caller
    is admin AND sends `X-Preview-As: <other-email>`, the returned profile
    impersonates that other email — that's how the admin-only "Preview
    Access" mode works without persisted state.
    """
    if real_email is None:
        # No header → unauthenticated. Endpoints that require auth will 401
        # via require_view / require_admin.
        return AccessProfile(email="", is_authenticated=False)

    with get_sync_session() as session:
        profile = resolve_access(session, real_email)
        if x_preview_as and profile.is_admin:
            preview_email = x_preview_as.strip().lower()
            if preview_email and preview_email != real_email:
                preview = resolve_access(session, preview_email)
                # Tag so the frontend can show a banner; the impersonation
                # is otherwise transparent to downstream code.
                preview.email = preview_email
                preview.is_preview = True
                return preview
        return profile


def require_authenticated(
    profile: AccessProfile = Depends(current_access),
) -> AccessProfile:
    if not profile.is_authenticated:
        raise HTTPException(status_code=401, detail="Authentication required")
    return profile


def require_admin(
    profile: AccessProfile = Depends(current_access),
) -> AccessProfile:
    if not profile.is_authenticated:
        raise HTTPException(status_code=401, detail="Authentication required")
    if not profile.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return profile


def require_view(view_slug: str):
    """Returns a dependency that 403s unless the profile has `view_slug` in
    its view set. Use as `Depends(require_view("admin.access"))`."""

    def _dep(profile: AccessProfile = Depends(current_access)) -> AccessProfile:
        if not profile.is_authenticated:
            raise HTTPException(status_code=401, detail="Authentication required")
        if view_slug not in profile.view_slugs:
            raise HTTPException(
                status_code=403,
                detail=f"Access to view '{view_slug}' is not granted",
            )
        return profile

    return _dep
