"""
auth/middleware.py — FastAPI dependency helpers for authentication and authorization.

Role hierarchy (ascending): spectator < player < dm < admin
"""
import os
from typing import Optional

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from auth.jwt import COOKIE_NAME, verify_token
from db import crud
from db.database import get_db
from db.models import User

AUTH_ENABLED = os.getenv("AUTH_ENABLED", "false").lower() == "true"

ROLE_RANK = {
    "spectator": 0,
    "player": 1,
    "dm": 2,
    "admin": 3,
}


def _role_rank(role: str) -> int:
    return ROLE_RANK.get(role, -1)


def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
) -> Optional[User]:
    """Read JWT cookie and return the matching User, or None if not authenticated."""
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return None
    user_id = verify_token(token)
    if user_id is None:
        return None
    return crud.get_user(db, user_id)


def require_user(
    user: Optional[User] = Depends(get_current_user),
) -> User:
    """Raise 401 if the user is not authenticated."""
    if not AUTH_ENABLED:
        # In dev mode without auth, return a synthetic admin-like user stub.
        # Actual DB operations that need a real user_id will need AUTH_ENABLED=true.
        return user  # type: ignore[return-value]
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


def require_campaign_member(min_role: str = "spectator"):
    """
    FastAPI dependency factory. Returns a dependency that validates the user
    is a campaign member with at least `min_role`.

    Usage:
        @app.get("/campaigns/{slug}/something")
        def route(slug: str, member=Depends(require_campaign_member("dm")), db=Depends(get_db)):
            ...
    """
    def _dep(
        slug: str,
        user: Optional[User] = Depends(get_current_user),
        db: Session = Depends(get_db),
    ):
        if not AUTH_ENABLED:
            return None  # dev mode: skip

        if user is None:
            raise HTTPException(status_code=401, detail="Not authenticated")

        campaign = crud.get_campaign_by_slug(db, slug)
        if campaign is None:
            raise HTTPException(status_code=404, detail="Campaign not found")

        # Admins bypass role check
        if user.is_admin:
            return crud.get_member(db, campaign.id, user.id)

        member = crud.get_member(db, campaign.id, user.id)
        if member is None:
            raise HTTPException(status_code=403, detail="Not a member of this campaign")

        if _role_rank(member.role) < _role_rank(min_role):
            raise HTTPException(status_code=403, detail=f"Requires role: {min_role}")

        return member

    return _dep
