from __future__ import annotations

from context.message_context import MessageContext
from commands.roll import handle_roll
from commands.post_roll import handle_post_roll
from commands.aptitude import handle_aptitude
from commands.admin import handle_admin

HELP_TEXT = """\
【三角机构骰点系统 - 帮助】

◆ 骰点
  现实修改 <资质名>
  异常能力 <资质名>

◆ 骰后修改（骰点后5分钟内）
  增加成功 <数量>  (消耗对应资质)
  减少成功 <数量>  (消耗对应资质)

◆ 资质管理
  录入资质 <资质名><数值> ...
  例: 录入资质 专注3 气场5

◆ 管理员命令
  任务属性        查看混沌池/失败计数
  混沌增加 <N>    增加混沌池
  混沌减少 <N>    减少混沌池
  失败增加 <N>    增加失败计数
  失败减少 <N>    减少失败计数
  注册管理        群聊注册管理员(首人)
  申请管理        申请成为管理员
  同意管理        批准管理员申请

◆ 九种资质
  专注 欺瞒 活力 共情 主动
  坚毅 气场 专业 诡秘\
"""


async def handle_help(ctx: MessageContext) -> bool:
    if ctx.content in ("帮助", "菜单", "help"):
        await ctx.reply(HELP_TEXT)
        return True
    return False


HANDLERS = [
    handle_help,
    handle_roll,
    handle_post_roll,
    handle_aptitude,
    handle_admin,
]


async def dispatch(ctx: MessageContext) -> None:
    for handler in HANDLERS:
        if await handler(ctx):
            return
