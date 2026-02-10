from __future__ import annotations

import asyncio
import re

from api.web_client import get_client
from context.message_context import MessageContext
from game.models import RoomState
from storage.json_store import store

# In-memory pending admin applications: room_id -> player_id
_pending_applications: dict[str, str] = {}


async def _check_admin(ctx: MessageContext) -> bool:
    """Check if user is admin. Returns True if admin."""
    if ctx.source_type == "guild":
        return ctx.is_admin_by_role

    if ctx.source_type == "group":
        room = await store.load_room(ctx.room_id)
        return ctx.player_id in room.admins

    return False


async def handle_admin(ctx: MessageContext) -> bool:
    """Handle admin commands. Returns True if handled."""
    content = ctx.content

    if content == "注册管理":
        return await _handle_register_admin(ctx)

    if content == "申请管理":
        return await _handle_apply_admin(ctx)

    if content == "同意管理":
        return await _handle_approve_admin(ctx)

    if content == "任务属性":
        return await _handle_task_attrs(ctx)

    chaos_match = re.match(r"混沌(增加|减少)\s*(\d+)", content)
    if chaos_match:
        return await _handle_chaos_modify(ctx, chaos_match)

    failure_match = re.match(r"失败(增加|减少)\s*(\d+)", content)
    if failure_match:
        return await _handle_failure_modify(ctx, failure_match)

    return False


async def _handle_register_admin(ctx: MessageContext) -> bool:
    if not ctx.supports_dice:
        await ctx.reply("私聊不支持此命令。")
        return True

    if ctx.source_type == "guild":
        await ctx.reply("频道中管理员由角色决定，无需注册。")
        return True

    room_id = ctx.room_id
    player_id = ctx.player_id
    result_lines: list[str] = []

    def updater(room: RoomState) -> None:
        if not room.admins:
            room.admins.append(player_id)
            result_lines.append("已注册为本群管理员。")
        elif player_id in room.admins:
            result_lines.append("你已经是管理员了。")
        else:
            result_lines.append("本群已有管理员，请使用「申请管理」命令申请。")

    await store.update_room(room_id, updater)
    await ctx.reply("\n".join(result_lines))
    return True


async def _handle_apply_admin(ctx: MessageContext) -> bool:
    if not ctx.supports_dice:
        await ctx.reply("私聊不支持此命令。")
        return True

    if ctx.source_type == "guild":
        await ctx.reply("频道中管理员由角色决定，无需申请。")
        return True

    room = await store.load_room(ctx.room_id)

    if not room.admins:
        await ctx.reply("本群暂无管理员，请直接使用「注册管理」。")
        return True

    if ctx.player_id in room.admins:
        await ctx.reply("你已经是管理员了。")
        return True

    _pending_applications[ctx.room_id] = ctx.player_id
    await ctx.reply("已提交管理员申请，请现有管理员发送「同意管理」批准。")
    return True


async def _handle_approve_admin(ctx: MessageContext) -> bool:
    if not ctx.supports_dice:
        await ctx.reply("私聊不支持此命令。")
        return True

    if not await _check_admin(ctx):
        await ctx.reply("需要管理员权限。")
        return True

    room_id = ctx.room_id
    target_id = _pending_applications.get(room_id)

    if not target_id:
        await ctx.reply("当前没有待批准的管理员申请。")
        return True

    result_lines: list[str] = []

    def updater(room: RoomState) -> None:
        if target_id in room.admins:
            result_lines.append("该用户已经是管理员了。")
        else:
            room.admins.append(target_id)
            result_lines.append("已批准，新管理员已添加。")

    await store.update_room(room_id, updater)
    del _pending_applications[room_id]
    await ctx.reply("\n".join(result_lines))
    return True


async def _handle_task_attrs(ctx: MessageContext) -> bool:
    if not ctx.supports_dice:
        await ctx.reply("私聊不支持此命令。")
        return True

    if not await _check_admin(ctx):
        await ctx.reply("需要管理员权限。")
        return True

    room = await store.load_room(ctx.room_id)
    lines = [
        "【任务属性】",
        f"混沌池: {room.chaos_pool}",
        f"失败计数: {room.failure_count}",
    ]
    await ctx.reply("\n".join(lines))
    return True


async def _handle_chaos_modify(ctx: MessageContext, match: re.Match) -> bool:
    if not ctx.supports_dice:
        await ctx.reply("私聊不支持此命令。")
        return True

    if not await _check_admin(ctx):
        await ctx.reply("需要管理员权限。")
        return True

    action = match.group(1)
    n = int(match.group(2))
    room_id = ctx.room_id
    result_lines: list[str] = []
    sync_delta = 0

    def updater(room: RoomState) -> None:
        nonlocal sync_delta
        old = room.chaos_pool
        if action == "增加":
            room.chaos_pool += n
            sync_delta = n
        else:
            room.chaos_pool = max(0, room.chaos_pool - n)
            sync_delta = room.chaos_pool - old
        result_lines.append(f"混沌池: {old} → {room.chaos_pool}")

    await store.update_room(room_id, updater)
    await ctx.reply("\n".join(result_lines))

    # Background sync
    client = get_client()
    if client and ctx.source_type == "group" and sync_delta != 0:
        asyncio.create_task(client.sync_chaos(room_id, sync_delta, f"管理员手动{action}"))

    return True


async def _handle_failure_modify(ctx: MessageContext, match: re.Match) -> bool:
    if not ctx.supports_dice:
        await ctx.reply("私聊不支持此命令。")
        return True

    if not await _check_admin(ctx):
        await ctx.reply("需要管理员权限。")
        return True

    action = match.group(1)
    n = int(match.group(2))
    room_id = ctx.room_id
    result_lines: list[str] = []
    sync_delta = 0

    def updater(room: RoomState) -> None:
        nonlocal sync_delta
        old = room.failure_count
        if action == "增加":
            room.failure_count += n
            sync_delta = n
        else:
            room.failure_count = max(0, room.failure_count - n)
            sync_delta = room.failure_count - old
        result_lines.append(f"失败计数: {old} → {room.failure_count}")

    await store.update_room(room_id, updater)
    await ctx.reply("\n".join(result_lines))

    # Background sync
    client = get_client()
    if client and ctx.source_type == "group" and sync_delta != 0:
        asyncio.create_task(client.sync_failure(room_id, sync_delta))

    return True
