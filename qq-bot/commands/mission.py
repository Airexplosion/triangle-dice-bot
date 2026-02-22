"""Mission lifecycle commands: start, end, and view missions."""

from __future__ import annotations

import asyncio
import re

from api.web_client import get_client
from commands.admin import _check_admin
from context.message_context import MessageContext
from game.models import RoomState
from storage.json_store import store


async def handle_mission(ctx: MessageContext) -> bool:
    """Handle mission lifecycle commands. Returns True if handled."""
    content = ctx.content

    if content.startswith("开始任务"):
        return await _handle_start_mission(ctx)

    if content == "结束任务":
        return await _handle_end_mission(ctx)

    if content.startswith("解绑任务"):
        return await _handle_unbind_mission(ctx)

    if content == "查看任务":
        return await _handle_view_mission(ctx)

    return False


async def _handle_start_mission(ctx: MessageContext) -> bool:
    if not ctx.supports_dice:
        await ctx.reply("私聊不支持此命令。")
        return True

    if not await _check_admin(ctx):
        await ctx.reply("需要管理员权限。")
        return True

    room_id = ctx.room_id
    content = ctx.content.strip()

    # Check if mission is already active
    room = await store.load_room(room_id)
    if room.mission_active:
        name = room.mission_name or "独立任务"
        await ctx.reply(f"当前已有进行中的任务: {name}\n请先使用「结束任务」结束当前任务。")
        return True

    # Parse argument
    arg = content[len("开始任务"):].strip()

    if arg == "不使用":
        # Independent mode: all players contribute to counters
        result_lines: list[str] = []

        def updater(r: RoomState) -> None:
            r.mission_active = True
            r.mission_id = None
            r.mission_name = None
            r.mission_members = []
            r.chaos_pool = 0
            r.failure_count = 0
            result_lines.append("已开始独立任务。")
            result_lines.append("所有成员骰点均影响混沌池和失败计数。")
            result_lines.append("混沌池和失败计数已清零。")

        await store.update_room(room_id, updater)
        await ctx.reply("\n".join(result_lines))
        return True

    if not arg:
        await ctx.reply("用法:\n  开始任务 <绑定码>  绑定网页任务\n  开始任务 不使用    独立任务模式")
        return True

    # Web-bound mode: bind mission via code
    client = get_client()
    if not client:
        await ctx.reply("角色卡系统集成未配置，请使用「开始任务 不使用」。")
        return True

    bind_code = arg.upper()
    bind_result = await client.bind_mission(bind_code, room_id)

    if not bind_result:
        await ctx.reply("无法连接角色卡系统，请稍后重试。")
        return True

    if not bind_result.get("success"):
        error = bind_result.get("error", "绑定失败")
        await ctx.reply(f"任务绑定失败: {error}")
        return True

    mission_id = bind_result.get("missionId")
    mission_name = bind_result.get("missionName") or "未知任务"

    # Fetch mission detail to get member list
    detail = await client.get_mission_detail(room_id)
    member_openids: list[str] = []
    member_count = 0
    bound_count = 0
    initial_chaos = 0
    initial_failure = 0

    if detail and detail.get("success"):
        mission_data = detail.get("mission", {})
        members = mission_data.get("members", [])
        member_count = len(members)
        for m in members:
            openid = m.get("qqOpenid")
            if openid:
                member_openids.append(openid)
                bound_count += 1
        initial_chaos = mission_data.get("chaosValue", 0)
        initial_failure = mission_data.get("failureCount", 0)

    result_lines = []

    def updater(r: RoomState) -> None:
        r.mission_active = True
        r.mission_id = str(mission_id) if mission_id else None
        r.mission_name = mission_name
        r.mission_members = list(member_openids)
        r.chaos_pool = initial_chaos
        r.failure_count = initial_failure
        result_lines.append(f"已绑定任务: {mission_name}")
        result_lines.append(f"任务成员: {member_count}人 (已绑QQ: {bound_count}人)")
        if member_openids:
            result_lines.append("仅任务成员骰点影响混沌池和失败计数。")
        else:
            result_lines.append("暂无成员绑定QQ，所有人骰点均计入。")
        if initial_chaos or initial_failure:
            result_lines.append(f"同步数值: 混沌池={initial_chaos}, 失败计数={initial_failure}")

    await store.update_room(room_id, updater)
    await ctx.reply("\n".join(result_lines))
    return True


async def _handle_end_mission(ctx: MessageContext) -> bool:
    if not ctx.supports_dice:
        await ctx.reply("私聊不支持此命令。")
        return True

    if not await _check_admin(ctx):
        await ctx.reply("需要管理员权限。")
        return True

    room_id = ctx.room_id
    room = await store.load_room(room_id)

    if not room.mission_active:
        await ctx.reply("当前没有进行中的任务。")
        return True

    # If web-bound, check report status
    if room.mission_id:
        client = get_client()
        if client:
            report_result = await client.get_report_status(room_id)
            if report_result and report_result.get("success"):
                if report_result.get("hasReport") and not report_result.get("allAccepted"):
                    pending = report_result.get("pendingCount", 0)
                    appealing = report_result.get("appealingCount", 0)
                    accepted = report_result.get("acceptedCount", 0)
                    lines = [
                        "无法结束任务: 有未确认的任务报告。",
                        f"  待确认: {pending}人",
                        f"  已接受: {accepted}人",
                    ]
                    if appealing > 0:
                        lines.append(f"  申诉中: {appealing}人")
                    lines.append("请等待所有特工确认报告后再结束任务。")
                    await ctx.reply("\n".join(lines))
                    return True

    mission_name = room.mission_name or "独立任务"
    result_lines: list[str] = []

    def updater(r: RoomState) -> None:
        r.chaos_pool = 0
        r.failure_count = 0
        r.mission_active = False
        r.mission_id = None
        r.mission_name = None
        r.mission_members = []
        result_lines.append(f"任务「{mission_name}」已结束。")
        result_lines.append("混沌池和失败计数已清零。")

    await store.update_room(room_id, updater)
    await ctx.reply("\n".join(result_lines))
    return True


async def _handle_view_mission(ctx: MessageContext) -> bool:
    if not ctx.supports_dice:
        await ctx.reply("私聊不支持此命令。")
        return True

    room = await store.load_room(ctx.room_id)

    # 先尝试从网页获取（群已绑定任务时可用）
    client = get_client()
    if client and ctx.source_type == "group":
        detail = await client.get_mission_detail(ctx.room_id)
        if detail and detail.get("success") and detail.get("mission"):
            m = detail["mission"]
            mission_type_map = {"containment": "收容", "sweep": "扫荡"}
            status_map = {"active": "进行中", "archived": "已归档"}
            lines = [
                f"【任务信息】{m['name']}",
                f"类型: {mission_type_map.get(m.get('missionType'), m.get('missionType') or '未指定')}",
                f"状态: {status_map.get(m.get('status'), m.get('status', '未知'))}",
                f"创建者: {m.get('creatorName', '未知')}",
            ]
            if m.get("description"):
                desc = m["description"]
                if len(desc) > 200:
                    desc = desc[:200] + "..."
                lines.append(f"简介: {desc}")

            lines.append(f"混沌池: {m.get('chaosValue', 0)}")
            lines.append(f"燃尽计数: {m.get('failureCount', 0)}")
            lines.append(f"散逸端: {m.get('scatterValue', 0)}")

            members = m.get("members", [])
            if members:
                lines.append(f"\n成员 ({len(members)}人):")
                for i, mem in enumerate(members, 1):
                    qq_tag = " [QQ已绑]" if mem.get("qqOpenid") else ""
                    lines.append(f"  {i}. {mem['characterName']}{qq_tag}")

            optional_tasks = m.get("optionalTasks", [])
            if optional_tasks:
                lines.append(f"\n可选任务 ({len(optional_tasks)}):")
                for i, ot in enumerate(optional_tasks, 1):
                    if isinstance(ot, dict):
                        lines.append(f"  {i}. {ot.get('title', '未知')}")
                    else:
                        lines.append(f"  {i}. {ot}")

            await ctx.reply("\n".join(lines))
            return True

    # 本地任务模式
    if not room.mission_active:
        await ctx.reply("当前没有进行中的任务，且该群未绑定网页任务。")
        return True

    lines = [
        f"【任务信息】{room.mission_name or '独立模式'}",
        f"混沌池: {room.chaos_pool}",
        f"燃尽计数: {room.failure_count}",
        f"散逸端: {room.scatter_value}",
    ]
    if room.mission_members:
        lines.append(f"任务成员: {len(room.mission_members)}人")
    else:
        lines.append("任务成员: 所有人")
    await ctx.reply("\n".join(lines))
    return True


async def _handle_unbind_mission(ctx: MessageContext) -> bool:
    if not ctx.supports_dice:
        await ctx.reply("私聊不支持此命令。")
        return True

    if ctx.source_type != "group":
        await ctx.reply("解绑任务命令仅限群聊使用。")
        return True

    if not await _check_admin(ctx):
        await ctx.reply("需要管理员权限。")
        return True

    client = get_client()
    if not client:
        await ctx.reply("角色卡系统集成未配置。")
        return True

    confirmed = ctx.content.strip().endswith("确认")

    # Check mission status before unbinding
    if not confirmed:
        detail = await client.get_mission_detail(ctx.room_id)
        if detail and detail.get("success") and detail.get("mission"):
            mission = detail["mission"]
            status = mission.get("status", "")
            if status != "archived":
                status_label = {"active": "进行中"}.get(status, status or "未知")
                await ctx.reply(
                    f"当前任务「{mission.get('name', '未知')}」状态为: {status_label}\n"
                    f"任务尚未归档，确定要解绑吗？\n"
                    f"请发送「解绑任务 确认」确认解绑。"
                )
                return True

    result = await client.unbind_mission(ctx.room_id)
    if not result:
        await ctx.reply("解绑失败: 无法连接角色卡系统。")
        return True

    if result.get("success"):
        # Clear local mission state
        def updater(r: RoomState) -> None:
            r.mission_active = False
            r.mission_id = None
            r.mission_name = None
            r.mission_members = []
            r.chaos_pool = 0
            r.failure_count = 0

        await store.update_room(ctx.room_id, updater)
        await ctx.reply("已解除群任务绑定，本地任务状态已清除。")
    else:
        error = result.get("error", "未知错误")
        await ctx.reply(f"解绑失败: {error}")

    return True
