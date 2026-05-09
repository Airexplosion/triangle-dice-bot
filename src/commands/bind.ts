import type { Context, Session } from 'koishi'
import type { WebClient } from '../service/web-client'
import { sendQQMarkdown, type QQButton } from '../util/qq-markdown'

export interface BindDeps {
  web: WebClient | null
  useMarkdown: boolean
}

export function registerBindCommands(ctx: Context, deps: BindDeps): void {
  ctx
    .command('绑定 <code:string>', '绑定 QQ 到角色卡系统')
    .action(async ({ session }, code) => {
      if (!session) return
      if (!deps.web) {
        return reply(session, deps, '> 未配置角色卡服务，无法绑定。')
      }
      const qqOpenid = session.userId
      if (!qqOpenid) return reply(session, deps, '> 无法获取 QQ 标识。')
      if (!code) {
        return reply(
          session,
          deps,
          '**用法**　绑定 绑定码\n\n> 在角色卡网页生成的 8 位绑定码',
        )
      }

      const r = await deps.web.bindUser(code.trim(), qqOpenid)
      if (!r) {
        return reply(session, deps, '> 暂时无法连接角色卡系统，稍后重试。')
      }
      if (!r.success) {
        return reply(session, deps, `> 绑定失败：${r.error ?? '未知原因'}`)
      }
      const buttons: QQButton[][] = [
        [
          { label: '查询状态', data: '查询状态' },
          { label: '查询角色', data: '查询角色' },
        ],
      ]
      await reply(
        session,
        deps,
        [
          '# 绑定成功',
          '',
          `账号　**${r.name ?? r.username ?? '已绑定'}**`,
        ].join('\n'),
        buttons,
      )
    })

  ctx.command('解绑', '解除 QQ 绑定').action(async ({ session }) => {
    if (!session) return
    if (!deps.web) return reply(session, deps, '> 未配置角色卡服务。')
    const qqOpenid = session.userId
    if (!qqOpenid) return reply(session, deps, '> 无法获取 QQ 标识。')

    const r = await deps.web.unbindUser(qqOpenid)
    if (!r) return reply(session, deps, '> 暂时无法连接角色卡系统，稍后重试。')
    if (!r.success) return reply(session, deps, '> 解绑失败。')
    await reply(session, deps, '> 已解除 QQ 绑定。')
  })

  ctx
    .command('查询绑定', '查看当前 QQ 绑定状态')
    .action(async ({ session }) => {
      if (!session) return
      if (!deps.web) return reply(session, deps, '> 未配置角色卡服务。')
      const qqOpenid = session.userId
      if (!qqOpenid) return reply(session, deps, '> 无法获取 QQ 标识。')

      const r = await deps.web.getBindingStatus(qqOpenid)
      if (!r) return reply(session, deps, '> 暂时无法连接角色卡系统，稍后重试。')
      if (!r.bound) {
        const buttons: QQButton[][] = [
          [{ label: '绑定', data: '绑定 ', type: 'input' }],
        ]
        return reply(
          session,
          deps,
          '> 当前 QQ 未绑定任何账号。请先在网页生成绑定码。',
          buttons,
        )
      }
      await reply(
        session,
        deps,
        ['# 绑定状态', '', `账号　**${r.name ?? r.username ?? '已绑定'}**`].join(
          '\n',
        ),
      )
    })
}

async function reply(
  session: Session,
  deps: BindDeps,
  content: string,
  buttons?: QQButton[][],
): Promise<void> {
  await sendQQMarkdown(session, content, {
    enabled: deps.useMarkdown,
    buttons,
  })
}
