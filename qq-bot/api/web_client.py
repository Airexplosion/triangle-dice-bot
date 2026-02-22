"""Async HTTP client for communicating with the Character Sheet web API."""

from __future__ import annotations

import logging
import os
from typing import Any

import aiohttp

logger = logging.getLogger("web_client")

_client: WebClient | None = None


class WebClient:
    """Singleton aiohttp client that talks to the Character Sheet API."""

    def __init__(self, base_url: str, bot_key: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.bot_key = bot_key
        self._session: aiohttp.ClientSession | None = None

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            timeout = aiohttp.ClientTimeout(total=5)
            self._session = aiohttp.ClientSession(
                timeout=timeout,
                headers={"X-Bot-Key": self.bot_key},
                trust_env=False,
            )
        return self._session

    async def close(self) -> None:
        if self._session and not self._session.closed:
            await self._session.close()

    # ------------------------------------------------------------------
    # Low-level helpers
    # ------------------------------------------------------------------

    async def _get(self, path: str, params: dict | None = None) -> dict | None:
        try:
            session = await self._get_session()
            async with session.get(f"{self.base_url}{path}", params=params) as resp:
                if resp.content_type and "json" in resp.content_type:
                    return await resp.json()
                body = await resp.text()
                logger.warning("GET %s -> %s: %s", path, resp.status, body)
                return None
        except Exception as exc:
            logger.warning("GET %s failed: %s", path, exc)
            return None

    async def _post(self, path: str, json: dict | None = None) -> dict | None:
        try:
            session = await self._get_session()
            async with session.post(f"{self.base_url}{path}", json=json) as resp:
                if resp.content_type and "json" in resp.content_type:
                    return await resp.json()
                body = await resp.text()
                logger.warning("POST %s -> %s: %s", path, resp.status, body)
                return None
        except Exception as exc:
            logger.warning("POST %s failed: %s", path, exc)
            return None

    # ------------------------------------------------------------------
    # Binding
    # ------------------------------------------------------------------

    async def bind_user(self, bind_code: str, qq_openid: str) -> dict | None:
        return await self._post("/api/bot/bind-user", {
            "bindCode": bind_code,
            "qqOpenid": qq_openid,
        })

    async def bind_mission(self, bind_code: str, qq_group_openid: str) -> dict | None:
        return await self._post("/api/bot/bind-mission", {
            "bindCode": bind_code,
            "qqGroupOpenid": qq_group_openid,
        })

    # ------------------------------------------------------------------
    # Aptitude sync
    # ------------------------------------------------------------------

    async def get_aptitudes(
        self, qq_openid: str, qq_group_openid: str
    ) -> dict | None:
        return await self._get("/api/bot/aptitudes", {
            "qqOpenid": qq_openid,
            "qqGroupOpenid": qq_group_openid,
        })

    async def consume_aptitude(
        self,
        qq_openid: str,
        qq_group_openid: str,
        aptitude_name: str,
        amount: int,
    ) -> dict | None:
        return await self._post("/api/bot/consume-aptitude", {
            "qqOpenid": qq_openid,
            "qqGroupOpenid": qq_group_openid,
            "aptitudeName": aptitude_name,
            "amount": amount,
        })

    async def set_aptitudes(
        self,
        qq_openid: str,
        qq_group_openid: str,
        updates: dict[str, int],
    ) -> dict | None:
        return await self._post("/api/bot/set-aptitudes", {
            "qqOpenid": qq_openid,
            "qqGroupOpenid": qq_group_openid,
            "aptitudes": updates,
        })

    # ------------------------------------------------------------------
    # Chaos / failure sync
    # ------------------------------------------------------------------

    async def sync_chaos(
        self, qq_group_openid: str, delta: int, reason: str = ""
    ) -> dict | None:
        return await self._post("/api/bot/sync-chaos", {
            "qqGroupOpenid": qq_group_openid,
            "delta": delta,
            "reason": reason,
        })

    async def sync_failure(
        self, qq_group_openid: str, delta: int
    ) -> dict | None:
        return await self._post("/api/bot/sync-failure", {
            "qqGroupOpenid": qq_group_openid,
            "delta": delta,
        })

    # ------------------------------------------------------------------
    # Queries
    # ------------------------------------------------------------------

    async def get_character_status(
        self, qq_openid: str, qq_group_openid: str | None = None
    ) -> dict | None:
        params: dict[str, str] = {"qqOpenid": qq_openid}
        if qq_group_openid:
            params["qqGroupOpenid"] = qq_group_openid
        return await self._get("/api/bot/character-status", params)

    async def get_binding_status(self, qq_openid: str) -> dict | None:
        return await self._get("/api/bot/binding-status", {
            "qqOpenid": qq_openid,
        })

    async def get_mission_status(self, qq_group_openid: str) -> dict | None:
        return await self._get("/api/bot/mission-status", {
            "qqGroupOpenid": qq_group_openid,
        })

    async def get_characters(
        self, qq_openid: str, qq_group_openid: str | None = None
    ) -> dict | None:
        params: dict[str, str] = {"qqOpenid": qq_openid}
        if qq_group_openid:
            params["qqGroupOpenid"] = qq_group_openid
        return await self._get("/api/bot/characters", params)

    async def select_character(
        self, qq_openid: str, character_id: int
    ) -> dict | None:
        return await self._post("/api/bot/select-character", {
            "qqOpenid": qq_openid,
            "characterId": character_id,
        })

    async def get_item_detail(
        self,
        qq_openid: str,
        qq_group_openid: str | None,
        item_name: str,
    ) -> dict | None:
        params: dict[str, str] = {
            "qqOpenid": qq_openid,
            "itemName": item_name,
        }
        if qq_group_openid:
            params["qqGroupOpenid"] = qq_group_openid
        return await self._get("/api/bot/item-detail", params)

    # ------------------------------------------------------------------
    # Unbinding
    # ------------------------------------------------------------------

    async def unbind_user(self, qq_openid: str) -> dict | None:
        return await self._post("/api/bot/unbind-user", {
            "qqOpenid": qq_openid,
        })

    async def unbind_mission(self, qq_group_openid: str) -> dict | None:
        return await self._post("/api/bot/unbind-mission", {
            "qqGroupOpenid": qq_group_openid,
        })

    # ------------------------------------------------------------------
    # Manager role check
    # ------------------------------------------------------------------

    async def check_manager_role(self, qq_openid: str) -> dict | None:
        return await self._get("/api/bot/check-manager-role", {
            "qqOpenid": qq_openid,
        })

    # ------------------------------------------------------------------
    # Mission detail / report
    # ------------------------------------------------------------------

    async def get_mission_detail(self, qq_group_openid: str) -> dict | None:
        return await self._get("/api/bot/mission-detail", {
            "qqGroupOpenid": qq_group_openid,
        })

    async def get_pending_report(
        self, qq_openid: str, qq_group_openid: str | None = None
    ) -> dict | None:
        params: dict[str, str] = {"qqOpenid": qq_openid}
        if qq_group_openid:
            params["qqGroupOpenid"] = qq_group_openid
        return await self._get("/api/bot/pending-report", params)

    async def agent_response(
        self,
        qq_openid: str,
        qq_group_openid: str | None,
        action: str,
        reason: str | None = None,
    ) -> dict | None:
        payload: dict[str, Any] = {
            "qqOpenid": qq_openid,
            "action": action,
        }
        if qq_group_openid:
            payload["qqGroupOpenid"] = qq_group_openid
        if reason:
            payload["reason"] = reason
        return await self._post("/api/bot/agent-response", payload)

    async def get_report_status(self, qq_group_openid: str) -> dict | None:
        return await self._get("/api/bot/report-status", {
            "qqGroupOpenid": qq_group_openid,
        })


# ------------------------------------------------------------------
# Module-level singleton
# ------------------------------------------------------------------

def init_client() -> WebClient | None:
    """Initialise the global WebClient from environment variables.

    Returns None if WEB_API_URL or BOT_API_KEY is not configured.
    """
    global _client
    base_url = os.environ.get("WEB_API_URL", "")
    bot_key = os.environ.get("BOT_API_KEY", "")
    if not base_url or not bot_key:
        logger.info("WEB_API_URL or BOT_API_KEY not set – web sync disabled")
        return None
    _client = WebClient(base_url, bot_key)
    logger.info("WebClient initialised: %s", base_url)
    return _client


def get_client() -> WebClient | None:
    """Return the global WebClient, or None if not initialised."""
    return _client
