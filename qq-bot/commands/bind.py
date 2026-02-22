"""Binding commands: link QQ accounts to the web Character Sheet system."""

from __future__ import annotations

import re

from api.web_client import get_client
from context.message_context import MessageContext


async def handle_bind_user(ctx: MessageContext) -> bool:
    """Handle 绑定 <code> — bind QQ openid to a web user account."""
    match = re.match(r"绑定\s+([A-Za-z0-9]+)$", ctx.content)
    if not match:
        return False

    bind_code = match.group(1).upper()
    client = get_client()

    if not client:
        await ctx.reply("角色卡系统集成未配置。")
        return True

    result = await client.bind_user(bind_code, ctx.player_id)
    if not result:
        await ctx.reply("绑定失败: 无法连接角色卡系统或绑定码无效/已过期。")
        return True

    if result.get("success"):
        name = result.get("name") or result.get("username") or "未知"
        await ctx.reply(f"绑定成功! 已关联到用户: {name}")
    else:
        error = result.get("error", "未知错误")
        await ctx.reply(f"绑定失败: {error}")

    return True


async def handle_unbind_user(ctx: MessageContext) -> bool:
    """Handle 解绑 — unbind QQ openid from web user account."""
    if ctx.content != "解绑":
        return False

    client = get_client()
    if not client:
        await ctx.reply("角色卡系统集成未配置。")
        return True

    result = await client.unbind_user(ctx.player_id)
    if not result:
        await ctx.reply("解绑失败: 无法连接角色卡系统。")
        return True

    if result.get("success"):
        await ctx.reply("已解除QQ绑定。")
    else:
        error = result.get("error", "未知错误")
        await ctx.reply(f"解绑失败: {error}")

    return True
