#!/usr/bin/env python3
"""
migrate.py — Migrate flat file structure to campaign-scoped layout.

Usage: python migrate.py

Migrates:
  config.yaml → campaigns/as-above-so-below/config.yaml
  sessions/*  → campaigns/as-above-so-below/sessions/

Creates a Campaign DB record for the migrated data.
Safe to run twice (idempotent).
"""
import shutil
from pathlib import Path

import yaml

BASE_DIR = Path(__file__).parent
CAMPAIGN_SLUG = "as-above-so-below"
CAMPAIGN_NAME = "As Above, So Below"


def run_migration(verbose: bool = True) -> bool:
    """
    Run the migration. Returns True if migration was performed or already done,
    False if there's nothing to migrate.
    """
    sessions_dir = BASE_DIR / "sessions"
    campaigns_dir = BASE_DIR / "campaigns"
    campaign_dir = campaigns_dir / CAMPAIGN_SLUG

    # Already fully migrated
    if campaign_dir.exists() and not sessions_dir.exists():
        if verbose:
            print("Migration already complete — campaigns/ exists, sessions/ does not.")
        return True

    if not sessions_dir.exists():
        if verbose:
            print("No sessions/ directory found — nothing to migrate.")
        return False

    # 1. Create campaign directories
    campaign_sessions_dir = campaign_dir / "sessions"
    campaign_sessions_dir.mkdir(parents=True, exist_ok=True)
    if verbose:
        print(f"Created: {campaign_dir.relative_to(BASE_DIR)}/")
        print(f"Created: {campaign_sessions_dir.relative_to(BASE_DIR)}/")

    # 2. Copy config.yaml → campaigns/as-above-so-below/config.yaml
    src_config = BASE_DIR / "config.yaml"
    dst_config = campaign_dir / "config.yaml"
    if src_config.exists() and not dst_config.exists():
        shutil.copy2(src_config, dst_config)
        if verbose:
            print(f"Copied:  config.yaml → {dst_config.relative_to(BASE_DIR)}")
    elif dst_config.exists() and verbose:
        print(f"Skipped: {dst_config.relative_to(BASE_DIR)} already exists")

    # 3. Move sessions/* → campaigns/as-above-so-below/sessions/
    moved = []
    skipped = []
    for session_dir in sorted(sessions_dir.iterdir()):
        if not session_dir.is_dir() or session_dir.name.startswith("."):
            continue
        dest = campaign_sessions_dir / session_dir.name
        if dest.exists():
            skipped.append(session_dir.name)
            if verbose:
                print(f"Skipped: sessions/{session_dir.name} (already at destination)")
        else:
            shutil.move(str(session_dir), str(dest))
            moved.append(session_dir.name)
            if verbose:
                print(f"Moved:   sessions/{session_dir.name} → {dest.relative_to(BASE_DIR)}")

    # Remove old sessions dir if now empty
    try:
        sessions_dir.rmdir()
        if verbose:
            print("Removed: sessions/ (empty)")
    except OSError:
        if verbose and any(sessions_dir.iterdir()):
            print("Note:    sessions/ not removed (still has contents)")

    # 4. Create Campaign DB record
    try:
        from db.database import SessionLocal, init_db
        from db import crud
        from db.models import User

        init_db()
        db = SessionLocal()
        try:
            existing = crud.get_campaign_by_slug(db, CAMPAIGN_SLUG)
            if existing:
                if verbose:
                    print(f"DB:      Campaign '{CAMPAIGN_SLUG}' already exists (id={existing.id})")
            else:
                # Find or create a system user as placeholder owner
                user = db.query(User).first()
                if not user:
                    user = User(
                        discord_id="system",
                        username="system",
                        discriminator="0",
                        is_admin=True,
                    )
                    db.add(user)
                    db.flush()
                    if verbose:
                        print("DB:      Created system user as campaign owner placeholder")

                # Use direct campaign creation to avoid FK issues with owner_id=0
                campaign = crud.create_campaign(
                    db,
                    slug=CAMPAIGN_SLUG,
                    name=CAMPAIGN_NAME,
                    owner_id=user.id,
                    data_path=f"campaigns/{CAMPAIGN_SLUG}",
                )
                if verbose:
                    print(f"DB:      Created campaign '{CAMPAIGN_SLUG}' (id={campaign.id})")
        finally:
            db.close()
    except Exception as e:
        if verbose:
            print(f"Warning: Could not create DB record: {e}")
        # Don't fail the migration for DB errors — file migration is what matters

    if verbose:
        print()
        print(f"Migration complete: {len(moved)} session(s) moved, {len(skipped)} skipped.")

    return True


if __name__ == "__main__":
    run_migration(verbose=True)
