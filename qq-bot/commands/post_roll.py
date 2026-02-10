from __future__ import annotations

import asyncio
import random
import re

from api.web_client import get_client
from context.message_context import MessageContext
from game.chaos import calculate_chaos
from game.dice import count_successes
from game.models import RoomState
from commands.roll import format_dice, get_pending, set_pending
from storage.json_store import store


async def handle_post_roll(ctx: MessageContext) -> bool:
    """Handle 增加成功/减少成功 commands. Returns True if handled."""
    match = re.match(r"(增加成功|减少成功)\s*(\d+)", ctx.content)
    if not match:
        return False

    if not ctx.supports_dice:
        await ctx.reply("私聊不支持骰点命令。")
        return True

    action = match.group(1)
    n = int(match.group(2))
    if n <= 0:
        await ctx.reply("数量必须大于0。")
        return True

    room_id = ctx.room_id
    player_id = ctx.player_id
    is_increase = action == "增加成功"

    pr = get_pending(room_id, player_id)
    if not pr:
        await ctx.reply("没有待修改的骰点结果（可能已过期或未骰点）。")
        return True

    result_lines: list[str] = []

    # Track sync data
    chaos_diff_sync = 0
    failure_delta_sync = 0
    apt_consumed_name = ""
    apt_consumed_n = 0

    async def updater(room: RoomState) -> None:
        nonlocal chaos_diff_sync, failure_delta_sync, apt_consumed_name, apt_consumed_n

        player = room.get_player(player_id)
        apt_name = pr.aptitude_name
        apt_value = player.aptitudes.get(apt_name, 0)

        if apt_value < n:
            result_lines.append(f"资质 {apt_name} 不足: 当前{apt_value}，需要{n}")
            return

        old_successes = count_successes(pr.current_dice)
        old_chaos = pr.chaos_applied
        dice = list(pr.current_dice)

        if is_increase:
            # Convert n non-3s to 3
            indices = [i for i, d in enumerate(dice) if d != 3]
            if len(indices) < n:
                result_lines.append(f"只有{len(indices)}个非3骰子可以转换。")
                return
            for i in indices[:n]:
                dice[i] = 3
        else:
            # Convert n 3s to random non-3
            indices = [i for i, d in enumerate(dice) if d == 3]
            if len(indices) < n:
                result_lines.append(f"只有{len(indices)}个3可以转换。")
                return
            non_three = [1, 2, 4]
            for i in indices[:n]:
                dice[i] = random.choice(non_three)

        new_successes = count_successes(dice)
        # Recalculate chaos with original unconsumed burnout
        new_chaos = calculate_chaos(dice, pr.unconsumed_burnout)
        chaos_diff = new_chaos - old_chaos

        # Adjust chaos pool
        room.chaos_pool = max(0, room.chaos_pool + chaos_diff)
        chaos_diff_sync = chaos_diff

        # Failure count adjustments (reality modification only)
        if pr.trigger == "现实修改":
            if pr.failure_incremented and new_successes > 0:
                room.failure_count = max(0, room.failure_count - 1)
                pr.failure_incremented = False
                failure_delta_sync = -1
                result_lines.append("(成功数恢复，撤销失败计数+1)")
            elif not pr.failure_incremented and old_successes > 0 and new_successes == 0:
                room.failure_count += 1
                pr.failure_incremented = True
                failure_delta_sync = 1
                result_lines.append("(成功数归零，失败计数+1)")

        # Deduct aptitude
        player.aptitudes[apt_name] = apt_value - n
        apt_consumed_name = apt_name
        apt_consumed_n = n

        # Update pending roll
        pr.current_dice = dice
        pr.chaos_applied = new_chaos
        set_pending(room_id, pr)

        result_lines.insert(0, f"【{action} {n} - {apt_name}({apt_value}→{apt_value - n})】")
        result_lines.append(f"骰子: [{format_dice(dice)}]")
        result_lines.append(f"成功数: {old_successes} → {new_successes}")
        result_lines.append(f"本次混沌: {old_chaos} → {new_chaos} (差值: {chaos_diff:+d})")
        result_lines.append(f"混沌池: {room.chaos_pool}")

    await store.update_room(room_id, updater)
    await ctx.reply("\n".join(result_lines))

    # Background sync to web (non-blocking)
    client = get_client()
    if client and ctx.source_type == "group" and apt_consumed_n > 0:
        async def _sync():
            await client.consume_aptitude(player_id, room_id, apt_consumed_name, apt_consumed_n)
            if chaos_diff_sync != 0:
                await client.sync_chaos(room_id, chaos_diff_sync, f"骰后修改 {apt_consumed_name}")
            if failure_delta_sync != 0:
                await client.sync_failure(room_id, failure_delta_sync)
        asyncio.create_task(_sync())

    return True
