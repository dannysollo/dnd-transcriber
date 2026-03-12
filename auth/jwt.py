"""
auth/jwt.py — JWT creation and verification.

Tokens are stored in an httpOnly cookie named 'access_token'.
SECRET_KEY is read from env; defaults to a random value (dev mode — not persistent across restarts).
"""
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from jose import JWTError, jwt

SECRET_KEY = os.getenv("SECRET_KEY", secrets.token_hex(32))
ALGORITHM = "HS256"
TOKEN_EXPIRE_DAYS = 30
COOKIE_NAME = "access_token"


def create_access_token(user_id: int) -> str:
    """Create a signed JWT encoding the user's DB id."""
    expire = datetime.now(timezone.utc) + timedelta(days=TOKEN_EXPIRE_DAYS)
    payload = {"sub": str(user_id), "exp": expire}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def verify_token(token: str) -> Optional[int]:
    """Decode and validate a JWT. Returns user_id (int) or None on failure."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        sub = payload.get("sub")
        if sub is None:
            return None
        return int(sub)
    except (JWTError, ValueError):
        return None
