"""
db/database.py — SQLAlchemy engine + session setup.
Reads DATABASE_URL from env (default: sqlite:///./transcriber.db).
"""
import os
from typing import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from db.models import Base

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./transcriber.db")

# SQLite needs check_same_thread=False; ignored for other DBs
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def init_db():
    """Create all tables (idempotent)."""
    Base.metadata.create_all(bind=engine)


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency: yield a DB session, always close on exit."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
