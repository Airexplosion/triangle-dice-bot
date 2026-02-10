from __future__ import annotations

import time
from dataclasses import dataclass, field

APTITUDE_NAMES = [
    "专注", "欺瞒", "活力", "共情",
    "主动", "坚毅", "气场", "专业", "诡秘",
]

APTITUDE_SET = frozenset(APTITUDE_NAMES)


@dataclass
class PlayerState:
    player_id: str
    aptitudes: dict[str, int] = field(default_factory=lambda: {n: 0 for n in APTITUDE_NAMES})

    def to_dict(self) -> dict:
        return {
            "player_id": self.player_id,
            "aptitudes": dict(self.aptitudes),
        }

    @staticmethod
    def from_dict(data: dict) -> PlayerState:
        apt = {n: 0 for n in APTITUDE_NAMES}
        apt.update(data.get("aptitudes", {}))
        return PlayerState(
            player_id=data["player_id"],
            aptitudes=apt,
        )


@dataclass
class RoomState:
    room_id: str
    chaos_pool: int = 0
    failure_count: int = 0
    players: dict[str, PlayerState] = field(default_factory=dict)
    admins: list[str] = field(default_factory=list)

    def get_player(self, player_id: str) -> PlayerState:
        if player_id not in self.players:
            self.players[player_id] = PlayerState(player_id=player_id)
        return self.players[player_id]

    def to_dict(self) -> dict:
        return {
            "room_id": self.room_id,
            "chaos_pool": self.chaos_pool,
            "failure_count": self.failure_count,
            "players": {pid: p.to_dict() for pid, p in self.players.items()},
            "admins": list(self.admins),
        }

    @staticmethod
    def from_dict(data: dict) -> RoomState:
        players = {}
        for pid, pdata in data.get("players", {}).items():
            players[pid] = PlayerState.from_dict(pdata)
        return RoomState(
            room_id=data["room_id"],
            chaos_pool=data.get("chaos_pool", 0),
            failure_count=data.get("failure_count", 0),
            players=players,
            admins=data.get("admins", []),
        )


PENDING_ROLL_TTL = 300  # 5 minutes


@dataclass
class PendingRoll:
    player_id: str
    trigger: str
    aptitude_name: str
    current_dice: list[int]
    chaos_applied: int
    failure_incremented: bool
    unconsumed_burnout: int = 0
    created_at: float = field(default_factory=time.time)

    @property
    def expired(self) -> bool:
        return time.time() - self.created_at > PENDING_ROLL_TTL

    @property
    def successes(self) -> int:
        return sum(1 for d in self.current_dice if d == 3)
