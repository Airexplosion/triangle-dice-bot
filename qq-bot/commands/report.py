"""Report review commands: view, accept, and appeal mission reports from Bot."""

from __future__ import annotations

from api.web_client import get_client
from context.message_context import MessageContext


async def handle_report(ctx: MessageContext) -> bool:
    """Handle report review commands. Returns True if handled."""
    content = ctx.content

    if content == "查看报告":
        return await _handle_view_report(ctx)

    if content == "通过报告":
        return await _handle_accept_report(ctx)

    if content.startswith("申诉报告"):
        return await _handle_appeal_report(ctx)

    return False


async def _handle_view_report(ctx: MessageContext) -> bool:
    client = get_client()
    if not client:
        await ctx.reply("角色卡系统集成未配置。")
        return True

    group_id = ctx.room_id if ctx.source_type == "group" else None
    result = await client.get_pending_report(ctx.player_id, group_id)

    if not result:
        await ctx.reply("无法连接角色卡系统。")
        return True

    if not result.get("success"):
        await ctx.reply(f"查询失败: {result.get('error', '未知错误')}")
        return True

    report = result.get("report")
    if not report:
        await ctx.reply(result.get("message", "当前没有待处理的报告。"))
        return True

    lines = [
        f"【任务报告】{report['missionName']}",
        f"评级: {report['rating']}",
    ]

    rewards = report.get("myRewards", {})
    reward_lines = []
    commend = rewards.get("commend", 0)
    reprimand = rewards.get("reprimand", 0)
    if commend:
        reward_lines.append(f"  嘉奖 {'+' if commend > 0 else ''}{commend}")
    if reprimand:
        reward_lines.append(f"  申诫 {'+' if reprimand > 0 else ''}{reprimand}")
    if rewards.get("mvp"):
        reward_lines.append("  获得MVP")
    if rewards.get("probation"):
        reward_lines.append("  进入查看期")

    if reward_lines:
        lines.append("您的奖惩:")
        lines.extend(reward_lines)
    else:
        lines.append("您的奖惩: 无")

    status_map = {
        "pending": "待确认",
        "accepted": "已接受",
        "appealing": "申诉中",
        "not_participant": "非参与者",
    }
    my_status = report.get("myStatus", "pending")
    lines.append(f"状态: {status_map.get(my_status, my_status)}")

    all_resp = report.get("allResponses", {})
    lines.append(f"进度: {all_resp.get('accepted', 0)}/{all_resp.get('total', 0)} 已确认")
    if all_resp.get("appealing", 0) > 0:
        lines.append(f"  申诉中: {all_resp['appealing']}人")
    if all_resp.get("pending", 0) > 0:
        lines.append(f"  待确认: {all_resp['pending']}人")

    if my_status == "pending":
        lines.append("\n使用「通过报告」接受或「申诉报告 <原因>」提出异议。")

    await ctx.reply("\n".join(lines))
    return True


async def _handle_accept_report(ctx: MessageContext) -> bool:
    client = get_client()
    if not client:
        await ctx.reply("角色卡系统集成未配置。")
        return True

    group_id = ctx.room_id if ctx.source_type == "group" else None
    result = await client.agent_response(ctx.player_id, group_id, "accept")

    if not result:
        await ctx.reply("无法连接角色卡系统。")
        return True

    if not result.get("success"):
        await ctx.reply(f"操作失败: {result.get('error', '未知错误')}")
        return True

    if result.get("autoFinalized"):
        await ctx.reply("已接受评级。所有特工已确认，奖惩已自动结算!")
    else:
        await ctx.reply("已接受评级，等待其他特工响应。")

    return True


async def _handle_appeal_report(ctx: MessageContext) -> bool:
    client = get_client()
    if not client:
        await ctx.reply("角色卡系统集成未配置。")
        return True

    reason = ctx.content[len("申诉报告"):].strip()
    if not reason:
        await ctx.reply("请提供申诉理由，例如: 申诉报告 评级不合理，我的表现应该更高")
        return True

    group_id = ctx.room_id if ctx.source_type == "group" else None
    result = await client.agent_response(ctx.player_id, group_id, "appeal", reason)

    if not result:
        await ctx.reply("无法连接角色卡系统。")
        return True

    if not result.get("success"):
        await ctx.reply(f"操作失败: {result.get('error', '未知错误')}")
        return True

    await ctx.reply("申诉已提交，请等待经理处理。")
    return True
