"""
db/models.py — SQLAlchemy ORM models for multi-campaign, multi-user support.
"""
import secrets
from datetime import datetime

from sqlalchemy import (
    Boolean, DateTime, ForeignKey, Integer, JSON, String, Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    discord_id: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True)
    username: Mapped[str] = mapped_column(String(64), nullable=False)
    discriminator: Mapped[str] = mapped_column(String(8), nullable=False, default="0")
    avatar: Mapped[str | None] = mapped_column(String(128), nullable=True)
    email: Mapped[str | None] = mapped_column(String(256), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    memberships: Mapped[list["CampaignMember"]] = relationship("CampaignMember", back_populates="user")
    owned_campaigns: Mapped[list["Campaign"]] = relationship("Campaign", back_populates="owner")


class Campaign(Base):
    __tablename__ = "campaigns"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    slug: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    owner_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    # settings JSON: {require_edit_approval: bool, discord_webhook_url: str|None, discord_channel_id: str|None}
    settings: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    # relative path to campaign data folder, e.g. "campaigns/as-above-so-below"
    data_path: Mapped[str] = mapped_column(String(256), nullable=False)

    owner: Mapped["User"] = relationship("User", back_populates="owned_campaigns")
    members: Mapped[list["CampaignMember"]] = relationship("CampaignMember", back_populates="campaign")
    invites: Mapped[list["CampaignInvite"]] = relationship("CampaignInvite", back_populates="campaign")


class CampaignMember(Base):
    __tablename__ = "campaign_members"
    __table_args__ = (UniqueConstraint("campaign_id", "user_id", name="uq_campaign_member"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    campaign_id: Mapped[int] = mapped_column(Integer, ForeignKey("campaigns.id"), nullable=False)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False)  # "dm" | "player" | "spectator"
    joined_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    campaign: Mapped["Campaign"] = relationship("Campaign", back_populates="members")
    user: Mapped["User"] = relationship("User", back_populates="memberships")


class CampaignInvite(Base):
    __tablename__ = "campaign_invites"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    campaign_id: Mapped[int] = mapped_column(Integer, ForeignKey("campaigns.id"), nullable=False)
    token: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True,
                                       default=lambda: secrets.token_hex(16))
    role: Mapped[str] = mapped_column(String(16), nullable=False)  # role to grant on use
    created_by: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    used_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    max_uses: Mapped[int | None] = mapped_column(Integer, nullable=True)
    use_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    campaign: Mapped["Campaign"] = relationship("Campaign", back_populates="invites")
    creator: Mapped["User"] = relationship("User", foreign_keys=[created_by])
    used_by_user: Mapped["User | None"] = relationship("User", foreign_keys=[used_by])
