"""Binding commands: link QQ accounts and groups to the web Character Sheet system."""

from __future__ import annotations

import re

from api.web_client import get_client
from commands.admin import _check_admin
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


async def handle_bind_mission(ctx: MessageContext) -> bool:
    """Handle 绑定任务 <code> — bind QQ group to a web mission. Group only, admin required."""
    match = re.match(r"绑定任务\s+([A-Za-z0-9]+)$", ctx.content)
    if not match:
        return False

    if ctx.source_type != "group":
        await ctx.reply("绑定任务命令仅限群聊使用。")
        return True

    if not await _check_admin(ctx):
        await ctx.reply("需要管理员权限。")
        return True

    bind_code = match.group(1).upper()
    client = get_client()

    if not client:
        await ctx.reply("角色卡系统集成未配置。")
        return True

    result = await client.bind_mission(bind_code, ctx.room_id)
    if not result:
        await ctx.reply("绑定失败: 无法连接角色卡系统或绑定码无效/已过期。")
        return True

    if result.get("success"):
        mission_name = result.get("missionName") or "未知任务"
        await ctx.reply(f"群绑定成功! 已关联到任务: {mission_name}")
    else:
        error = result.get("error", "未知错误")
        await ctx.reply(f"绑定失败: {error}")

    return True
