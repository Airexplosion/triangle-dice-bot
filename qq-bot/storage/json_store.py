from __future__ import annotations

import asyncio
import json
import os
import tempfile

from game.models import RoomState

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "rooms")


class JsonStore:
    def __init__(self) -> None:
        self._locks: dict[str, asyncio.Lock] = {}
        os.makedirs(DATA_DIR, exist_ok=True)

    def _get_lock(self, room_id: str) -> asyncio.Lock:
        if room_id not in self._locks:
            self._locks[room_id] = asyncio.Lock()
        return self._locks[room_id]

    def _path(self, room_id: str) -> str:
        safe_name = room_id.replace("/", "_").replace("\\", "_")
        return os.path.join(DATA_DIR, f"{safe_name}.json")

    async def load_room(self, room_id: str) -> RoomState:
        path = self._path(room_id)
        if os.path.exists(path):
            loop = asyncio.get_running_loop()
            data = await loop.run_in_executor(None, self._read_file, path)
            return RoomState.from_dict(data)
        return RoomState(room_id=room_id)

    async def save_room(self, room: RoomState) -> None:
        path = self._path(room.room_id)
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, self._write_file, path, room.to_dict())

    async def update_room(self, room_id: str, updater) -> RoomState:
        lock = self._get_lock(room_id)
        async with lock:
            room = await self.load_room(room_id)
            result = updater(room)
            if asyncio.iscoroutine(result):
                result = await result
            await self.save_room(room)
            return room

    @staticmethod
    def _read_file(path: str) -> dict:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)

    @staticmethod
    def _write_file(path: str, data: dict) -> None:
        dir_name = os.path.dirname(path)
        fd, tmp_path = tempfile.mkstemp(dir=dir_name, suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            os.replace(tmp_path, path)
        except Exception:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
            raise


store = JsonStore()
