from __future__ import annotations

from context.message_context import MessageContext
from commands.roll import handle_roll
from commands.post_roll import handle_post_roll
from commands.aptitude import handle_aptitude
from commands.admin import handle_admin
from commands.bind import handle_bind_user, handle_unbind_user
from commands.query import handle_query
from commands.mission import handle_mission
from commands.report import handle_report

HELP_TEXT = """\
【三角机构骰点系统 - 帮助】
(所有指令支持 / 或 . 前缀，如 /帮助)

◆ 骰点
  现实修改 <资质名>
  异常能力 <资质名>

◆ 骰后修改（骰点后5分钟内）
  增加成功 <数量>  (消耗对应资质)
  减少成功 <数量>  (消耗对应资质)

◆ 资质管理
  录入资质 <资质名><数值> ...
  例: 录入资质 专注3 气场5

◆ 任务管理
  查看任务            查看任务详情(所有人)
  开始任务 <绑定码>   绑定网页任务(管理员)
  开始任务 不使用     独立任务模式(管理员)
  结束任务            结束当前任务(管理员)
  解绑任务            解除群任务绑定(管理员)

◆ 管理员命令
  任务属性        查看混沌池/燃尽计数
  混沌增加 <N>    增加混沌池
  混沌减少 <N>    减少混沌池
  失败增加 <N>    增加燃尽计数
  失败减少 <N>    减少燃尽计数
  注册管理        注册管理员(验证网页角色)
  注册管理 不使用 注册管理员(跳过验证)
  申请管理        申请成为管理员
  同意管理        批准管理员申请

◆ 任务报告
  查看报告            查看待处理报告
  通过报告            接受评级
  申诉报告 <原因>     提出申诉

◆ 角色卡系统
  绑定 <绑定码>       绑定QQ到角色卡系统
  解绑                解除QQ绑定
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
    if ctx.content in ("帮助", "菜单", "help", "h"):
        await ctx.reply(HELP_TEXT)
        return True
    return False


HANDLERS = [
    handle_help,
    handle_unbind_user,
    handle_bind_user,
    handle_mission,
    handle_report,
    handle_query,
    handle_roll,
    handle_post_roll,
    handle_aptitude,
    handle_admin,
]


async def dispatch(ctx: MessageContext) -> None:
    # Allow optional / or . prefix on all commands
    if ctx.content.startswith(("/", ".")):
        ctx.content = ctx.content[1:].lstrip()

    for handler in HANDLERS:
        if await handler(ctx):
            return
