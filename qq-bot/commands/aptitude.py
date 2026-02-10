from __future__ import annotations

import re

from context.message_context import MessageContext
from game.models import APTITUDE_SET, RoomState
from storage.json_store import store


async def handle_aptitude(ctx: MessageContext) -> bool:
    """Handle 录入资质 command. Returns True if handled."""
    if not ctx.content.startswith("录入资质"):
        return False

    if not ctx.supports_dice:
        await ctx.reply("私聊不支持此命令。")
        return True

    body = ctx.content[len("录入资质"):].strip()
    if not body:
        await ctx.reply("用法: 录入资质 专注3 气场5")
        return True

    pairs = re.findall(r"(\S+?)(\d+)", body)
    if not pairs:
        await ctx.reply("格式错误。用法: 录入资质 专注3 气场5")
        return True

    updates: dict[str, int] = {}
    unknown: list[str] = []
    for name, val in pairs:
        if name in APTITUDE_SET:
            updates[name] = int(val)
        else:
            unknown.append(name)

    if unknown:
        await ctx.reply(f"未知资质: {'、'.join(unknown)}\n可用: {'、'.join(APTITUDE_SET)}")
        return True

    room_id = ctx.room_id
    player_id = ctx.player_id
    result_lines: list[str] = []

    def updater(room: RoomState) -> None:
        player = room.get_player(player_id)
        for name, val in updates.items():
            player.aptitudes[name] = val
        parts = [f"{n}{v}" for n, v in updates.items()]
        result_lines.append(f"资质已更新: {' '.join(parts)}")

    await store.update_room(room_id, updater)
    await ctx.reply("\n".join(result_lines))
    return True
