from __future__ import annotations

import asyncio
import re

from api.mapping import web_attrs_to_bot
from api.web_client import get_client
from context.message_context import MessageContext
from game.chaos import calculate_chaos
from game.dice import apply_burnout, count_successes, count_non_successes, roll_6d4
from game.models import APTITUDE_SET, PendingRoll, RoomState
from storage.json_store import store

# In-memory pending rolls: room_id -> player_id -> PendingRoll
pending_rolls: dict[str, dict[str, PendingRoll]] = {}


def get_pending(room_id: str, player_id: str) -> PendingRoll | None:
    room_pending = pending_rolls.get(room_id)
    if not room_pending:
        return None
    pr = room_pending.get(player_id)
    if pr and pr.expired:
        del room_pending[player_id]
        return None
    return pr


def set_pending(room_id: str, pr: PendingRoll) -> None:
    if room_id not in pending_rolls:
        pending_rolls[room_id] = {}
    pending_rolls[room_id][pr.player_id] = pr


def format_dice(dice: list[int]) -> str:
    return " | ".join(str(d) for d in dice)


async def handle_roll(ctx: MessageContext) -> bool:
    """Handle 现实修改/异常能力 commands. Returns True if handled."""
    match = re.match(r"(现实修改|异常能力)\s*(\S+)", ctx.content)
    if not match:
        return False

    if not ctx.supports_dice:
        await ctx.reply("私聊不支持骰点命令。")
        return True

    trigger = match.group(1)
    apt_name = match.group(2)

    if apt_name not in APTITUDE_SET:
        await ctx.reply(f"未知资质: {apt_name}\n可用资质: {'、'.join(APTITUDE_SET)}")
        return True

    room_id = ctx.room_id
    player_id = ctx.player_id
    is_reality = trigger == "现实修改"

    # Check if user is bound and fetch web aptitudes
    client = get_client()
    web_aptitudes: dict[str, int] | None = None
    offline_mode = False

    if client and ctx.source_type == "group":
        apt_result = await client.get_aptitudes(player_id, room_id)
        if apt_result and apt_result.get("success"):
            web_aptitudes = web_attrs_to_bot(apt_result.get("attrs", {}))
        elif apt_result is not None:
            offline_mode = False
        else:
            offline_mode = True

        # 骰点前从网页同步最新混沌/燃尽值
        if not offline_mode:
            from commands.admin import _sync_from_web
            await _sync_from_web(room_id)

    result_lines: list[str] = []

    # Track chaos/failure deltas for background sync
    chaos_delta = 0
    failure_delta = 0

    async def updater(room: RoomState) -> None:
        nonlocal chaos_delta, failure_delta

        player = room.get_player(player_id)

        # Override local aptitudes with web data if available
        if web_aptitudes is not None:
            for name, val in web_aptitudes.items():
                player.aptitudes[name] = val

        apt_value = player.aptitudes.get(apt_name, 0)

        # Check mission membership for counter contribution
        is_member = room.is_mission_member(player_id)

        # Calculate burnout
        zero_penalty = 1 if apt_value == 0 else 0
        fc_before = room.failure_count
        if is_reality:
            burnout = fc_before + zero_penalty
        else:
            burnout = zero_penalty

        # Roll
        raw_dice = roll_6d4()

        # Triple sublimation: check on RAW dice (before burnout)
        raw_triple = count_successes(raw_dice) == 3

        # Apply burnout
        burned_dice, unconsumed = apply_burnout(raw_dice, burnout)
        successes = count_successes(burned_dice)

        # Calculate chaos
        if raw_triple:
            # Raw triple sublimation -> chaos = 0 regardless
            chaos = 0
        else:
            # Normal: check post-burnout dice (3 threes -> 0, otherwise normal calc)
            chaos = calculate_chaos(burned_dice, unconsumed)

        # Failure check (reality modification only)
        failure_incremented = False

        if is_member:
            if is_reality and successes == 0:
                room.failure_count += 1
                failure_incremented = True
                failure_delta = 1

            # Apply chaos to pool
            room.chaos_pool += chaos
            chaos_delta = chaos
        else:
            # Observer mode: dice roll normally but don't affect counters
            chaos = 0

        # Create pending roll
        pr = PendingRoll(
            player_id=player_id,
            trigger=trigger,
            aptitude_name=apt_name,
            current_dice=list(burned_dice),
            chaos_applied=chaos,
            failure_incremented=failure_incremented,
            unconsumed_burnout=unconsumed,
        )
        set_pending(room_id, pr)

        # Format output
        mode_tag = " (离线模式)" if offline_mode else ""
        observer_tag = " (观察模式)" if not is_member else ""
        result_lines.append(f"【{trigger} - {apt_name}({apt_value})】骰点结果{mode_tag}{observer_tag}")
        result_lines.append(f"6D4 = [{format_dice(raw_dice)}]")

        if burnout > 0 or is_reality:
            burnout_parts = []
            if is_reality:
                burnout_parts.append(f"失败计数{fc_before}")
            burnout_parts.append(f"资质补正{zero_penalty}")
            result_lines.append(f"燃尽: {burnout} ({' + '.join(burnout_parts)})")

        if burnout > 0:
            converted = burnout - unconsumed
            result_lines.append(
                f"燃尽后: [{format_dice(burned_dice)}] (转换了{converted}个3)"
            )

        result_lines.append(f"成功数: {successes}")

        if not is_member:
            result_lines.append("(观察模式: 不影响混沌池和失败计数)")
        elif raw_triple:
            # Raw dice triggered triple sublimation
            result_lines.append("★ 三重升华 ★ 本次混沌: 0")
        elif count_successes(burned_dice) == 3:
            # Post-burnout has 3 threes: chaos=0 but no triple sublimation display
            result_lines.append("本次混沌: 0 (燃尽后恰好3个3)")
        else:
            chaos_detail = f"{count_non_successes(burned_dice)}非3"
            if unconsumed > 0:
                chaos_detail += f" + {unconsumed}未消耗燃尽"
            result_lines.append(f"本次混沌: {chaos} ({chaos_detail})")

        result_lines.append(f"混沌池: {room.chaos_pool} (+{chaos})")

        if is_reality:
            if failure_incremented:
                result_lines.append(
                    f"判定: 失败 (现实修改失败计数+1，当前: {room.failure_count})"
                )
            else:
                result_lines.append("判定: 成功")

    await store.update_room(room_id, updater)
    await ctx.reply("\n".join(result_lines))

    # Background sync to web (non-blocking)
    if client and ctx.source_type == "group" and not offline_mode:
        async def _sync():
            if chaos_delta != 0:
                await client.sync_chaos(room_id, chaos_delta, f"{trigger} {apt_name}")
            if failure_delta != 0:
                await client.sync_failure(room_id, failure_delta)
        asyncio.create_task(_sync())

    return True
