"""
auth/discord.py — Discord OAuth2 flow helpers.

Required environment variables:
  DISCORD_CLIENT_ID       — OAuth2 application client ID
  DISCORD_CLIENT_SECRET   — OAuth2 application client secret
  DISCORD_REDIRECT_URI    — Full callback URL (e.g. http://localhost:8765/auth/discord/callback)
"""
import os
from typing import Optional

import httpx

DISCORD_CLIENT_ID = os.getenv("DISCORD_CLIENT_ID", "")
DISCORD_CLIENT_SECRET = os.getenv("DISCORD_CLIENT_SECRET", "")
DISCORD_REDIRECT_URI = os.getenv("DISCORD_REDIRECT_URI", "http://localhost:8765/auth/discord/callback")

DISCORD_AUTH_URL = "https://discord.com/oauth2/authorize"
DISCORD_TOKEN_URL = "https://discord.com/api/oauth2/token"
DISCORD_API_BASE = "https://discord.com/api/v10"

SCOPES = "identify email"


def get_authorization_url(state: Optional[str] = None) -> str:
    """Return the Discord OAuth2 authorization URL to redirect the user to."""
    params = {
        "client_id": DISCORD_CLIENT_ID,
        "redirect_uri": DISCORD_REDIRECT_URI,
        "response_type": "code",
        "scope": SCOPES,
    }
    if state:
        params["state"] = state
    query = "&".join(f"{k}={v}" for k, v in params.items())
    return f"{DISCORD_AUTH_URL}?{query}"


async def exchange_code(code: str) -> dict:
    """Exchange an OAuth2 authorization code for an access token dict."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            DISCORD_TOKEN_URL,
            data={
                "client_id": DISCORD_CLIENT_ID,
                "client_secret": DISCORD_CLIENT_SECRET,
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": DISCORD_REDIRECT_URI,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        resp.raise_for_status()
        return resp.json()


async def get_user_info(access_token: str) -> dict:
    """Fetch the authenticated user's profile from the Discord API.

    Returns dict with keys: id, username, discriminator, avatar, email
    """
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{DISCORD_API_BASE}/users/@me",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        resp.raise_for_status()
        data = resp.json()
    return {
        "id": data["id"],
        "username": data["username"],
        "discriminator": data.get("discriminator", "0"),
        "avatar": data.get("avatar"),
        "email": data.get("email"),
    }
