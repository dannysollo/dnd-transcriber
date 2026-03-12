"""
db/crud.py — CRUD helpers for all models.
"""
import secrets
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from db.models import Campaign, CampaignInvite, CampaignMember, User


# ─── User ─────────────────────────────────────────────────────────────────────

def get_user(db: Session, user_id: int) -> Optional[User]:
    return db.query(User).filter(User.id == user_id).first()


def get_user_by_discord_id(db: Session, discord_id: str) -> Optional[User]:
    return db.query(User).filter(User.discord_id == discord_id).first()


def create_or_update_user(db: Session, discord_id: str, username: str,
                          discriminator: str, avatar: Optional[str],
                          email: Optional[str]) -> User:
    user = get_user_by_discord_id(db, discord_id)
    if user:
        user.username = username
        user.discriminator = discriminator
        user.avatar = avatar
        user.email = email
    else:
        user = User(
            discord_id=discord_id,
            username=username,
            discriminator=discriminator,
            avatar=avatar,
            email=email,
        )
        db.add(user)
    db.commit()
    db.refresh(user)
    return user


# ─── Campaign ─────────────────────────────────────────────────────────────────

def get_campaign(db: Session, campaign_id: int) -> Optional[Campaign]:
    return db.query(Campaign).filter(Campaign.id == campaign_id).first()


def get_campaign_by_slug(db: Session, slug: str) -> Optional[Campaign]:
    return db.query(Campaign).filter(Campaign.slug == slug).first()


def get_user_campaigns(db: Session, user_id: int) -> list[Campaign]:
    """Return all campaigns the user is a member of."""
    return (
        db.query(Campaign)
        .join(CampaignMember, CampaignMember.campaign_id == Campaign.id)
        .filter(CampaignMember.user_id == user_id)
        .all()
    )


def create_campaign(db: Session, slug: str, name: str, owner_id: int,
                    data_path: str, description: Optional[str] = None,
                    settings: Optional[dict] = None) -> Campaign:
    campaign = Campaign(
        slug=slug,
        name=name,
        description=description,
        owner_id=owner_id,
        data_path=data_path,
        settings=settings or {
            "require_edit_approval": False,
            "discord_webhook_url": None,
            "discord_channel_id": None,
        },
    )
    db.add(campaign)
    db.flush()  # get ID before adding member
    # Auto-add owner as DM
    member = CampaignMember(campaign_id=campaign.id, user_id=owner_id, role="dm")
    db.add(member)
    db.commit()
    db.refresh(campaign)
    return campaign


def update_campaign(db: Session, campaign: Campaign, **kwargs) -> Campaign:
    for key, value in kwargs.items():
        if hasattr(campaign, key):
            setattr(campaign, key, value)
    db.commit()
    db.refresh(campaign)
    return campaign


# ─── CampaignMember ───────────────────────────────────────────────────────────

def get_member(db: Session, campaign_id: int, user_id: int) -> Optional[CampaignMember]:
    return (
        db.query(CampaignMember)
        .filter(CampaignMember.campaign_id == campaign_id, CampaignMember.user_id == user_id)
        .first()
    )


def get_campaign_members(db: Session, campaign_id: int) -> list[CampaignMember]:
    return db.query(CampaignMember).filter(CampaignMember.campaign_id == campaign_id).all()


def add_member(db: Session, campaign_id: int, user_id: int, role: str) -> CampaignMember:
    member = CampaignMember(campaign_id=campaign_id, user_id=user_id, role=role)
    db.add(member)
    db.commit()
    db.refresh(member)
    return member


def update_member_role(db: Session, member: CampaignMember, role: str) -> CampaignMember:
    member.role = role
    db.commit()
    db.refresh(member)
    return member


def remove_member(db: Session, member: CampaignMember):
    db.delete(member)
    db.commit()


# ─── CampaignInvite ───────────────────────────────────────────────────────────

def create_invite(db: Session, campaign_id: int, created_by: int, role: str,
                  expires_in_days: Optional[int] = None,
                  max_uses: Optional[int] = None) -> CampaignInvite:
    expires_at = None
    if expires_in_days is not None:
        expires_at = datetime.utcnow() + timedelta(days=expires_in_days)
    invite = CampaignInvite(
        campaign_id=campaign_id,
        token=secrets.token_hex(16),
        role=role,
        created_by=created_by,
        expires_at=expires_at,
        max_uses=max_uses,
    )
    db.add(invite)
    db.commit()
    db.refresh(invite)
    return invite


def get_invite_by_token(db: Session, token: str) -> Optional[CampaignInvite]:
    return db.query(CampaignInvite).filter(CampaignInvite.token == token).first()


def get_campaign_invites(db: Session, campaign_id: int) -> list[CampaignInvite]:
    return db.query(CampaignInvite).filter(CampaignInvite.campaign_id == campaign_id).all()


def use_invite(db: Session, invite: CampaignInvite, user_id: int) -> CampaignMember:
    """Mark invite as used and add the user to the campaign."""
    invite.use_count += 1
    if invite.max_uses and invite.use_count >= invite.max_uses:
        invite.used_by = user_id
        invite.used_at = datetime.utcnow()
    member = add_member(db, invite.campaign_id, user_id, invite.role)
    db.commit()
    return member
