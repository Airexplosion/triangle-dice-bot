# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

三角机构骰点系统 — QQ Bot implementing a TRPG dice-rolling system for the "Triangle Agency" (三角机构) game. Built with Python 3 and the `botpy` QQ bot SDK. All commands and UI text are in Chinese.

Total codebase: ~920 lines across 10 source files.

## Running the Bot

```bash
pip install qq-botpy python-dotenv
python bot.py
```

Credentials loaded from `.env` file (`BOT_APPID`, `BOT_SECRET`). See `.env.example`. The `config.yaml` file exists but is **not used** by the code.

## Architecture

### Message Flow

```
QQ Gateway (WebSocket)
  → bot.py: MyBot event handlers (3 sources)
    → MessageContext.from_guild/from_group/from_c2c (normalizes message)
      → dispatch() iterates HANDLERS list
        → first handler returning True wins (short-circuit)
```

### Three Message Sources

| Source | Event | room_id | Admin Detection |
|--------|-------|---------|-----------------|
| Guild | `on_at_message_create` | `channel_id` | Role "2" or "4" in `member.roles` |
| Group | `on_group_at_message_create` | `group_openid` | Stored in `room.admins` list |
| C2C/DM | `on_c2c_message_create` | `None` | N/A (dice commands disabled) |

Guild messages have `<@!user_id>` mention prefix stripped by `MessageContext.from_guild()` via regex.

Group messages use an incrementing `_group_msg_seq` counter per `group_openid` to avoid QQ dedup error `40054005`.

### Command Dispatch

Handlers in `commands/__init__.py:HANDLERS` are tried in order:

```python
HANDLERS = [handle_help, handle_roll, handle_post_roll, handle_aptitude, handle_admin]
```

Each handler is `async def handler(ctx: MessageContext) -> bool`. Return `True` = handled, `False` = pass to next. Unmatched messages are silently ignored.

**To add a new command:** Create handler function, append to `HANDLERS` list.

### State Management

**Persistent state** (`storage/json_store.py`):
- `RoomState` saved per room as `data/rooms/{room_id}.json`
- Concurrent-safe via `update_room(room_id, updater)` with async per-room `asyncio.Lock`
- Atomic writes: write to temp file, then `os.replace()` into final path
- I/O runs in executor (`loop.run_in_executor`) to avoid blocking the event loop
- The `updater` callback can be sync or async (auto-detected via `asyncio.iscoroutine`)

**In-memory state** (no persistence, lost on restart):
- `roll.py:pending_rolls` — `Dict[room_id, Dict[player_id, PendingRoll]]`, TTL 300s (5 min)
- `admin.py:_pending_applications` — `Dict[room_id, applicant_player_id]`, no TTL
- `message_context.py:_group_msg_seq` — `Dict[group_openid, int]`, session lifetime

### Data Models (`game/models.py`)

```
RoomState
├── room_id: str
├── chaos_pool: int
├── failure_count: int
├── players: Dict[player_id, PlayerState]
│   └── PlayerState
│       ├── player_id: str
│       └── aptitudes: Dict[aptitude_name, int]  (9 aptitudes, default 0)
└── admins: List[player_id]

PendingRoll (in-memory only, 5 min TTL)
├── player_id, trigger, aptitude_name
├── current_dice: List[int]  (6 values, 1-4)
├── chaos_applied: int
├── failure_incremented: bool
├── unconsumed_burnout: int
└── created_at: float (time.time)
```

## Game Rules Implementation

### Dice Mechanics (`game/dice.py`)

- `roll_6d4()` → 6 random ints 1-4
- Success = rolling a **3**
- `apply_burnout(dice, n)` → converts first `n` 3s to random non-3 (1/2/4), returns `(new_dice, unconsumed_count)`
- `count_successes(dice)` / `count_non_successes(dice)` → count 3s / non-3s

### Two Roll Types (`commands/roll.py`)

| | 现实修改 (Reality Mod) | 异常能力 (Abnormal Ability) |
|---|---|---|
| Burnout | `failure_count + zero_penalty` | `zero_penalty` only |
| On 0 successes | `failure_count += 1` | No effect |

`zero_penalty` = 1 if aptitude value is 0, else 0.

### Chaos Calculation (`game/chaos.py`)

1. Check **triple sublimation** on raw dice (before burnout): exactly 3 successes → chaos = 0
2. Otherwise: `chaos = count_non_successes(burned_dice) + unconsumed_burnout`
3. Post-burnout triple sublimation (exactly 3 threes after burnout) also gives chaos = 0 but without the ★ marker

### Post-Roll Modifications (`commands/post_roll.py`)

Available within 5 minutes of a roll. Costs aptitude points.

- **增加成功 N**: Convert N non-3s → 3 (picks first N non-3 indices)
- **减少成功 N**: Convert N 3s → random non-3 (picks first N indices with value 3)

After modification:
- Recalculates chaos using `calculate_chaos(new_dice, original_unconsumed_burnout)`
- Adjusts `chaos_pool` by the difference (`new_chaos - old_chaos`)
- For 现实修改: can undo/redo `failure_count` change based on whether successes go to/from zero

### Admin System (`commands/admin.py`)

**Guild:** Admin determined by `member.roles` containing "2" or "4".

**Group:** Registration flow:
1. `注册管理` — First person becomes admin (only when `room.admins` is empty)
2. `申请管理` — Request admin (stored in `_pending_applications[room_id]`)
3. `同意管理` — Current admin approves pending application

Admin commands: `任务属性`, `混沌增加/减少 N`, `失败增加/减少 N`.

All admin-gated commands call `_check_admin(ctx)` which branches on `source_type` (guild → role check, group → admins list check).

## All Commands Reference

| Command | Handler | Requires Admin | Requires Room |
|---------|---------|---------------|---------------|
| `帮助` / `菜单` / `help` | `handle_help` | No | No |
| `现实修改 <资质名>` | `handle_roll` | No | Yes |
| `异常能力 <资质名>` | `handle_roll` | No | Yes |
| `增加成功 <N>` | `handle_post_roll` | No | Yes |
| `减少成功 <N>` | `handle_post_roll` | No | Yes |
| `录入资质 <资质名><数值> ...` | `handle_aptitude` | No | Yes |
| `任务属性` | `handle_admin` | Yes | Yes |
| `混沌增加 <N>` | `handle_admin` | Yes | Yes |
| `混沌减少 <N>` | `handle_admin` | Yes | Yes |
| `失败增加 <N>` | `handle_admin` | Yes | Yes |
| `失败减少 <N>` | `handle_admin` | Yes | Yes |
| `注册管理` | `handle_admin` | No | Yes (group only) |
| `申请管理` | `handle_admin` | No | Yes (group only) |
| `同意管理` | `handle_admin` | Yes | Yes (group only) |

## Nine Aptitudes

```
专注、欺瞒、活力、共情、主动、坚毅、气场、专业、诡秘
```

Defined in `game/models.py:APTITUDE_NAMES` (list) and `APTITUDE_SET` (frozenset for O(1) lookup).

## Key Implementation Details

- `MessageContext.reply()` dispatches differently per source type: guild/c2c use `msg.reply(content=text)`, group adds `msg_seq=_next_seq(group_openid)`
- `JsonStore` is a module-level singleton: `store = JsonStore()`, imported directly from `storage.json_store`
- Room ID sanitization: `/` and `\` replaced with `_` for filesystem safety in `JsonStore._path()`
- The `updater` pattern in `update_room` mutates `RoomState` in-place inside the lock, then auto-saves. Result lines are collected via closure over a `result_lines: list[str]` variable
- `PendingRoll.expired` property checks `time.time() - created_at > 300`. Cleanup is lazy (checked on access via `get_pending()`)
