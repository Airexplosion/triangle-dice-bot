"""Query commands: check character status, rewards, items, binding status, character list, and switch."""

from __future__ import annotations

from api.web_client import get_client
from context.message_context import MessageContext


async def handle_query(ctx: MessageContext) -> bool:
    """Handle 查询状态/查询嘉奖/查询物品/查询绑定/查询角色/切换角色 commands."""
    content = ctx.content

    if content == "查询状态":
        return await _query_status(ctx)
    if content == "查询嘉奖":
        return await _query_rewards(ctx)
    if content == "查询角色":
        return await _query_characters(ctx)
    if content.startswith("切换角色 "):
        return await _switch_character(ctx)
    if content.startswith("查询物品 "):
        return await _query_item_detail(ctx)
    if content == "查询物品":
        return await _query_items(ctx)
    if content == "查询绑定":
        return await _query_binding(ctx)

    return False


async def _query_status(ctx: MessageContext) -> bool:
    client = get_client()
    if not client:
        await ctx.reply("角色卡系统集成未配置。")
        return True

    group_id = ctx.room_id if ctx.source_type == "group" else None
    result = await client.get_character_status(ctx.player_id, group_id)

    if not result:
        await ctx.reply("无法连接角色卡系统。")
        return True

    if not result.get("success"):
        error = result.get("error", "未知错误")
        if result.get("characterCount"):
            await ctx.reply(f"{error}\n请使用[查询角色]查看角色列表，[切换角色]选择活跃角色。")
        else:
            await ctx.reply(f"查询失败: {error}")
        return True

    char = result["character"]
    lines = [
        f"【角色状态】{char['name']}",
        f"异常: {char['anomaly']}",
        f"现实: {char['reality']}",
        f"职能: {char['competency']}",
        f"嘉奖: {char['commendations']}  处分: {char['reprimands']}",
        f"MVP: {char['mvpCount']}  观察期: {char['probationCount']}",
    ]

    manager_name = char.get("managerName")
    lines.append(f"管理员: {manager_name or '无'}")

    active_mission = char.get("activeMission")
    if active_mission:
        lines.append(f"当前任务: {active_mission.get('name', '未知')}")
    else:
        lines.append("当前任务: 未加入任务")

    items = char.get("items", [])
    if items:
        lines.append(f"已拥有物品: {len(items)}件")

    await ctx.reply("\n".join(lines))
    return True


async def _query_rewards(ctx: MessageContext) -> bool:
    client = get_client()
    if not client:
        await ctx.reply("角色卡系统集成未配置。")
        return True

    group_id = ctx.room_id if ctx.source_type == "group" else None
    result = await client.get_character_status(ctx.player_id, group_id)

    if not result or not result.get("success"):
        error = (result or {}).get("error", "无法连接角色卡系统")
        await ctx.reply(f"查询失败: {error}")
        return True

    char = result["character"]
    lines = [
        f"【嘉奖/处分】{char['name']}",
        f"嘉奖总数: {char['commendations']}",
        f"处分总数: {char['reprimands']}",
    ]
    await ctx.reply("\n".join(lines))
    return True


async def _query_items(ctx: MessageContext) -> bool:
    client = get_client()
    if not client:
        await ctx.reply("角色卡系统集成未配置。")
        return True

    group_id = ctx.room_id if ctx.source_type == "group" else None
    result = await client.get_character_status(ctx.player_id, group_id)

    if not result or not result.get("success"):
        error = (result or {}).get("error", "无法连接角色卡系统")
        await ctx.reply(f"查询失败: {error}")
        return True

    char = result["character"]
    items = char.get("items", [])
    if not items:
        await ctx.reply(f"【物品】{char['name']}\n暂无物品。")
        return True

    lines = [f"【物品】{char['name']}"]
    for i, item in enumerate(items, 1):
        name = item.get("name") or item.get("item") or "未知物品"
        lines.append(f"  {i}. {name}")
    lines.append(f"\n共 {len(items)} 件物品。使用[查询物品 <序号或物品名>]查看详情。")
    await ctx.reply("\n".join(lines))
    return True


async def _query_item_detail(ctx: MessageContext) -> bool:
    client = get_client()
    if not client:
        await ctx.reply("角色卡系统集成未配置。")
        return True

    item_name = ctx.content[len("查询物品 "):].strip()
    if not item_name:
        await ctx.reply("请指定物品名称，例如: 查询物品 急救包")
        return True

    group_id = ctx.room_id if ctx.source_type == "group" else None

    # Support numeric index: "查询物品 1" → look up item name by index
    if item_name.isdigit():
        idx = int(item_name)
        status = await client.get_character_status(ctx.player_id, group_id)
        if status and status.get("success"):
            items = status["character"].get("items", [])
            if 1 <= idx <= len(items):
                item_name = items[idx - 1].get("name", item_name)
            else:
                await ctx.reply(f"序号超出范围，当前共 {len(items)} 件物品。")
                return True

    result = await client.get_item_detail(ctx.player_id, group_id, item_name)

    if not result:
        await ctx.reply("无法连接角色卡系统。")
        return True

    if not result.get("success"):
        await ctx.reply(f"查询失败: {result.get('error', '未知错误')}")
        return True

    items = result.get("items", [])
    lines = [f"【物品详情】搜索: {item_name}"]
    for item in items:
        lines.append(f"名称: {item.get('name', '未知')}")
        effect = item.get("effect", "")
        if effect:
            lines.append(f"效果: {effect}")
        purchase = item.get("purchase", "")
        if purchase:
            lines.append(f"来源: {purchase}")
        if len(items) > 1:
            lines.append("---")

    await ctx.reply("\n".join(lines))
    return True


async def _query_characters(ctx: MessageContext) -> bool:
    client = get_client()
    if not client:
        await ctx.reply("角色卡系统集成未配置。")
        return True

    group_id = ctx.room_id if ctx.source_type == "group" else None
    result = await client.get_characters(ctx.player_id, group_id)

    if not result:
        await ctx.reply("无法连接角色卡系统。")
        return True

    if not result.get("success"):
        await ctx.reply(f"查询失败: {result.get('error', '未知错误')}")
        return True

    characters = result.get("characters", [])
    if not characters:
        await ctx.reply("你还没有创建角色。")
        return True

    lines = ["【角色列表】"]
    for i, char in enumerate(characters, 1):
        markers = []
        if char.get("isActive"):
            markers.append("当前")
        if char.get("isMissionMember"):
            markers.append("任务中")
        if char.get("missionName"):
            markers.append(f"📋{char['missionName']}")
        suffix = f" [{'/'.join(markers)}]" if markers else ""
        lines.append(f"  {i}. {char['name']}{suffix}")
        manager = char.get("managerName")
        manager_tag = f" 管理:{manager}" if manager else ""
        lines.append(f"     异常:{char['anomaly']} 现实:{char['reality']} 职能:{char['competency']}{manager_tag}")

    lines.append(f"\n使用[切换角色 <序号或名称>]切换活跃角色。")
    await ctx.reply("\n".join(lines))
    return True


async def _switch_character(ctx: MessageContext) -> bool:
    client = get_client()
    if not client:
        await ctx.reply("角色卡系统集成未配置。")
        return True

    target = ctx.content[len("切换角色 "):].strip()
    if not target:
        await ctx.reply("请指定角色序号或名称，例如: 切换角色 1")
        return True

    # First get character list to resolve by index or name
    group_id = ctx.room_id if ctx.source_type == "group" else None
    char_result = await client.get_characters(ctx.player_id, group_id)

    if not char_result or not char_result.get("success"):
        error = (char_result or {}).get("error", "无法连接角色卡系统")
        await ctx.reply(f"查询失败: {error}")
        return True

    characters = char_result.get("characters", [])
    if not characters:
        await ctx.reply("你还没有创建角色。")
        return True

    # Try to match by index
    character_id = None
    character_name = None
    try:
        idx = int(target)
        if 1 <= idx <= len(characters):
            character_id = characters[idx - 1]["id"]
            character_name = characters[idx - 1]["name"]
    except ValueError:
        pass

    # Try to match by name
    if character_id is None:
        for char in characters:
            if char["name"] == target:
                character_id = char["id"]
                character_name = char["name"]
                break

    # Fuzzy match by name
    if character_id is None:
        target_lower = target.lower()
        for char in characters:
            if target_lower in char["name"].lower():
                character_id = char["id"]
                character_name = char["name"]
                break

    if character_id is None:
        await ctx.reply(f"未找到匹配的角色: {target}\n请使用[查询角色]查看角色列表。")
        return True

    result = await client.select_character(ctx.player_id, character_id)
    if not result or not result.get("success"):
        error = (result or {}).get("error", "切换失败")
        await ctx.reply(f"切换失败: {error}")
        return True

    await ctx.reply(f"已切换活跃角色为: {result.get('characterName', character_name)}")
    return True


async def _query_binding(ctx: MessageContext) -> bool:
    client = get_client()
    if not client:
        await ctx.reply("角色卡系统集成未配置。")
        return True

    lines = ["【绑定状态】"]

    # User binding
    user_status = await client.get_binding_status(ctx.player_id)
    if user_status and user_status.get("success"):
        if user_status.get("bound"):
            name = user_status.get("name") or user_status.get("username") or "未知"
            lines.append(f"QQ绑定: 已绑定 ({name})")
        else:
            lines.append("QQ绑定: 未绑定")
    else:
        lines.append("QQ绑定: 查询失败")

    # Mission binding (group only)
    if ctx.source_type == "group" and ctx.room_id:
        mission_status = await client.get_mission_status(ctx.room_id)
        if mission_status and mission_status.get("success"):
            if mission_status.get("bound"):
                mname = mission_status.get("missionName") or "未知"
                lines.append(f"群任务绑定: {mname}")
            else:
                lines.append("群任务绑定: 未绑定")
        else:
            lines.append("群任务绑定: 查询失败")

    await ctx.reply("\n".join(lines))
    return True
