"""
db/crud.py — CRUD helpers for all models.
"""
import secrets
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from db.models import Campaign, CampaignInvite, CampaignMember, TranscriptEdit, TranscriptionJob, User


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


def update_campaign_settings(db: Session, campaign: Campaign, settings_dict: dict) -> Campaign:
    """Merge settings_dict into campaign.settings and commit."""
    current = dict(campaign.settings or {})
    current.update(settings_dict)
    campaign.settings = current
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


# ─── TranscriptEdit ───────────────────────────────────────────────────────────

def create_transcript_edit(
    db: Session,
    campaign_id: int,
    session_name: str,
    user_id: int,
    line_number: int,
    original_text: str,
    proposed_text: str,
) -> TranscriptEdit:
    edit = TranscriptEdit(
        campaign_id=campaign_id,
        session_name=session_name,
        user_id=user_id,
        line_number=line_number,
        original_text=original_text,
        proposed_text=proposed_text,
        status="pending",
    )
    db.add(edit)
    db.commit()
    db.refresh(edit)
    return edit


def get_pending_edits(db: Session, campaign_id: int) -> list[TranscriptEdit]:
    return (
        db.query(TranscriptEdit)
        .filter(TranscriptEdit.campaign_id == campaign_id, TranscriptEdit.status == "pending")
        .order_by(TranscriptEdit.submitted_at)
        .all()
    )


def get_pending_edit_count(db: Session, campaign_id: int) -> int:
    return (
        db.query(TranscriptEdit)
        .filter(TranscriptEdit.campaign_id == campaign_id, TranscriptEdit.status == "pending")
        .count()
    )


def get_transcript_edit(db: Session, edit_id: int) -> Optional[TranscriptEdit]:
    return db.query(TranscriptEdit).filter(TranscriptEdit.id == edit_id).first()


def approve_edit(db: Session, edit: TranscriptEdit, reviewer_id: int) -> TranscriptEdit:
    edit.status = "approved"
    edit.reviewed_by = reviewer_id
    edit.reviewed_at = datetime.utcnow()
    db.commit()
    db.refresh(edit)
    return edit


def reject_edit(db: Session, edit: TranscriptEdit, reviewer_id: int,
                note: Optional[str] = None) -> TranscriptEdit:
    edit.status = "rejected"
    edit.reviewed_by = reviewer_id
    edit.reviewed_at = datetime.utcnow()
    edit.review_note = note
    db.commit()
    db.refresh(edit)
    return edit


# ─── TranscriptionJob ─────────────────────────────────────────────────────────

def create_transcription_job(db: Session, campaign_id: int, session_name: str,
                              created_by: int) -> TranscriptionJob:
    job = TranscriptionJob(
        campaign_id=campaign_id,
        session_name=session_name,
        created_by=created_by,
        created_at=datetime.utcnow(),
        status="pending",
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def get_pending_jobs(db: Session, campaign_id: int) -> list:
    return (
        db.query(TranscriptionJob)
        .filter(TranscriptionJob.campaign_id == campaign_id,
                TranscriptionJob.status == "pending")
        .all()
    )


def get_job(db: Session, campaign_id: int, session_name: str) -> Optional[TranscriptionJob]:
    return (
        db.query(TranscriptionJob)
        .filter(TranscriptionJob.campaign_id == campaign_id,
                TranscriptionJob.session_name == session_name)
        .first()
    )


def claim_job(db: Session, job: TranscriptionJob) -> TranscriptionJob:
    job.status = "claimed"
    job.claimed_at = datetime.utcnow()
    db.commit()
    db.refresh(job)
    return job


def complete_job(db: Session, job: TranscriptionJob) -> TranscriptionJob:
    job.status = "done"
    job.completed_at = datetime.utcnow()
    db.commit()
    db.refresh(job)
    return job


def fail_job(db: Session, job: TranscriptionJob, error_msg: str) -> TranscriptionJob:
    job.status = "error"
    job.error_message = error_msg
    db.commit()
    db.refresh(job)
    return job


def reset_job(db: Session, job: TranscriptionJob) -> TranscriptionJob:
    job.status = "pending"
    job.claimed_at = None
    job.error_message = None
    db.commit()
    db.refresh(job)
    return job


def get_all_jobs(db: Session, campaign_id: int) -> list:
    return (
        db.query(TranscriptionJob)
        .filter(TranscriptionJob.campaign_id == campaign_id)
        .order_by(TranscriptionJob.created_at.desc())
        .all()
    )
