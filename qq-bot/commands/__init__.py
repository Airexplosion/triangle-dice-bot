from __future__ import annotations

from context.message_context import MessageContext
from commands.roll import handle_roll
from commands.post_roll import handle_post_roll
from commands.aptitude import handle_aptitude
from commands.admin import handle_admin
from commands.bind import handle_bind_user, handle_bind_mission
from commands.query import handle_query

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

◆ 角色卡系统
  绑定 <绑定码>       绑定QQ到角色卡系统
  绑定任务 <绑定码>   群绑定到任务(管理员)
  查询状态            查看角色信息
  查询嘉奖            查看嘉奖/处分
  查询物品            查看物品列表
  查询物品 <物品名>   查看物品详情
  查询角色            查看所有角色
  切换角色 <名称/序号> 切换活跃角色
  查询绑定            查看绑定状态

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
    handle_bind_user,
    handle_bind_mission,
    handle_query,
    handle_roll,
    handle_post_roll,
    handle_aptitude,
    handle_admin,
]


async def dispatch(ctx: MessageContext) -> None:
    for handler in HANDLERS:
        if await handler(ctx):
            return
