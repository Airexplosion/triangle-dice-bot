import os
import sys

import botpy
from botpy.message import C2CMessage, GroupMessage, Message

sys.path.insert(0, os.path.dirname(__file__))

from commands import dispatch
from context.message_context import MessageContext


class MyBot(botpy.Client):
    async def on_ready(self):
        botpy.logger.info("Bot is ready!")

    async def on_at_message_create(self, message: Message):
        ctx = MessageContext.from_guild(message)
        await dispatch(ctx)

    async def on_group_at_message_create(self, message: GroupMessage):
        ctx = MessageContext.from_group(message)
        await dispatch(ctx)

    async def on_c2c_message_create(self, message: C2CMessage):
        ctx = MessageContext.from_c2c(message)
        await dispatch(ctx)


if __name__ == "__main__":
    appid = os.environ.get("BOT_APPID")
    secret = os.environ.get("BOT_SECRET")

    if not appid or not secret:
        raise RuntimeError("请设置环境变量 BOT_APPID 和 BOT_SECRET")

    intents = botpy.Intents(
        public_guild_messages=True,
        public_messages=True,
    )
    client = MyBot(intents=intents)
    client.run(appid=appid, secret=secret)
