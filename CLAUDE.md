# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

QQ bot (三角机构骰点系统) implementing a tabletop RPG dice-rolling system for the "Triangle Institution" game. Built with Python 3 and the `botpy` QQ bot SDK. All commands and UI text are in Chinese.

## Running the Bot

```bash
pip install qq-botpy
cd qq-bot
python bot.py
```

The bot connects to the QQ gateway via WebSocket. No build step needed.

## Project Structure

All source code lives under `qq-bot/`:

```
qq-bot/
├── bot.py                    # Entry point, MyBot class, event handlers
├── config.yaml               # Bot credentials
├── commands/                  # Command handlers (dispatch chain)
│   ├── __init__.py           # Dispatcher + help text + HANDLERS list
│   ├── roll.py               # 现实修改/异常能力 dice rolling
│   ├── post_roll.py          # 增加成功/减少成功 post-roll modifications
│   ├── aptitude.py           # 录入资质 aptitude registration
│   └── admin.py              # Admin management + chaos/failure controls
├── context/
│   └── message_context.py    # MessageContext dataclass (normalizes guild/group/c2c)
├── game/
│   ├── models.py             # PlayerState, RoomState, PendingRoll dataclasses
│   ├── dice.py               # roll_6d4, apply_burnout, count_successes
│   └── chaos.py              # calculate_chaos, is_triple_sublimation
├── storage/
│   └── json_store.py         # Async JSON file store with per-room locking
└── data/rooms/               # Persisted room state JSON files (runtime data)
```

## Architecture

**Message flow:** QQ Gateway → `bot.py` (MyBot event handlers) → `MessageContext` wraps raw message → `dispatch()` iterates `HANDLERS` list → first handler returning `True` wins.

**Command dispatch:** Handlers are tried in order defined in `commands/__init__.py:HANDLERS`. Each handler returns `bool` — `True` means the command was handled, `False` means try the next handler. To add a new command, create a handler function and append it to `HANDLERS`.

**State management:**
- **Persistent state:** `RoomState` (chaos_pool, failure_count, players, admins) saved per room as JSON files via `JsonStore`. Uses `update_room(room_id, updater)` pattern with async locking for safe concurrent access.
- **In-memory state:** `PendingRoll` objects in `roll.py:pending_rolls` dict (expires after 5 minutes). Admin applications in `admin.py:_pending_applications`. Group message sequence counters in `message_context.py:_group_msg_seq`.

**Three message sources:** Guild (`on_at_message_create`), Group (`on_group_at_message_create`), C2C/DM (`on_c2c_message_create`). `MessageContext` normalizes these into a single interface. C2C has `room_id=None` and cannot use dice commands.

## Key Game Rules

- Dice system: 6D4, success = rolling a 3
- **Burnout** converts 3s to non-3s before counting successes. For 现实修改: burnout = failure_count + zero_penalty. For 异常能力: burnout = zero_penalty only.
- **Triple sublimation:** exactly 3 successes on raw dice (before burnout) → chaos contribution is 0
- **Post-roll modifications** (增加成功/减少成功) consume aptitude points and recalculate chaos, available within 5 minutes of roll
- **Nine aptitudes:** 专注、欺瞒、活力、共情、主动、坚毅、气场、专业、诡秘

## Known Issues

- Bot credentials are hardcoded in `bot.py` line 36 and `config.yaml` — should use environment variables
- No automated tests exist
- `config.yaml` is present but not actually read by the code; credentials are passed directly in `client.run()`
