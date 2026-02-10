from __future__ import annotations

import re
from dataclasses import dataclass

from botpy.message import C2CMessage, GroupMessage, Message

# Global msg_seq counter per group to avoid dedup errors (40054005)
_group_msg_seq: dict[str, int] = {}


def _next_seq(group_openid: str) -> int:
    seq = _group_msg_seq.get(group_openid, 0) + 1
    _group_msg_seq[group_openid] = seq
    return seq


@dataclass
class MessageContext:
    room_id: str | None
    player_id: str
    content: str
    source_type: str  # "guild", "group", "c2c"
    roles: list[str]
    raw_message: Message | GroupMessage | C2CMessage

    @property
    def is_admin_by_role(self) -> bool:
        return "2" in self.roles or "4" in self.roles

    @property
    def supports_dice(self) -> bool:
        return self.room_id is not None

    async def reply(self, text: str) -> None:
        msg = self.raw_message
        if isinstance(msg, Message):
            await msg.reply(content=text)
        elif isinstance(msg, GroupMessage):
            seq = _next_seq(msg.group_openid)
            await msg.reply(content=text, msg_seq=seq)
        elif isinstance(msg, C2CMessage):
            await msg.reply(content=text)

    @staticmethod
    def from_guild(message: Message) -> MessageContext:
        content = message.content.strip()
        content = re.sub(r"<@!\d+>\s*", "", content).strip()
        roles = []
        if hasattr(message, "member") and message.member and hasattr(message.member, "roles"):
            roles = message.member.roles or []
        return MessageContext(
            room_id=message.channel_id,
            player_id=message.author.id,
            content=content,
            source_type="guild",
            roles=roles,
            raw_message=message,
        )

    @staticmethod
    def from_group(message: GroupMessage) -> MessageContext:
        content = message.content.strip()
        member_openid = ""
        if hasattr(message, "author") and hasattr(message.author, "member_openid"):
            member_openid = message.author.member_openid
        return MessageContext(
            room_id=message.group_openid,
            player_id=member_openid,
            content=content,
            source_type="group",
            roles=[],
            raw_message=message,
        )

    @staticmethod
    def from_c2c(message: C2CMessage) -> MessageContext:
        content = message.content.strip()
        user_openid = ""
        if hasattr(message, "author") and hasattr(message.author, "user_openid"):
            user_openid = message.author.user_openid
        return MessageContext(
            room_id=None,
            player_id=user_openid,
            content=content,
            source_type="c2c",
            roles=[],
            raw_message=message,
        )
