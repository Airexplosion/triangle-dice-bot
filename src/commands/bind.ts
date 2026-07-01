import type { Context, Session } from 'koishi'
import type { WebClient } from '../service/web-client'
import {
  NETWORK_ERROR_BLOCK,
  NO_QQ_ID,
  NO_WEB_CONFIG_BLOCK,
} from '../util/messages'
import { sendQQMarkdown, type QQButton } from '../util/qq-markdown'
import { makeWrap } from '../util/safe-action'

export interface BindDeps {
  web: WebClient | null
  useMarkdown: boolean
}

export function registerBindCommands(ctx: Context, deps: BindDeps): void {
  const wrap = makeWrap(ctx, deps.useMarkdown)

  ctx.command('绑定 <code:string>', '绑定 QQ 到角色卡系统').action(
    wrap(async ({ session }, code) => {
      if (!session) return
      if (!deps.web) return reply(session, deps, NO_WEB_CONFIG_BLOCK)
      const qqOpenid = session.userId
      if (!qqOpenid) return reply(session, deps, NO_QQ_ID)
      if (!code) {
        return reply(
          session,
          deps,
          [
            '# 绑定 QQ 到角色卡',
            '',
            '**用法**　绑定 你的8位绑定码',
            '',
            '**绑定码在哪获取**',
            '1. 在角色卡网页登录',
            '2. 个人中心 → 生成绑定码',
            '3. 复制 8 位字符（10 分钟内有效）',
          ].join('\n'),
        )
      }

      const r = await deps.web.bindUser(code.trim(), qqOpenid)
      if (!r) return reply(session, deps, NETWORK_ERROR_BLOCK)
      if (!r.success) {
        return reply(
          session,
          deps,
          [
            '# 绑定失败',
            '',
            `原因：${r.error ?? '未知（可能绑定码错或已过期）'}`,
            '',
            '> 绑定码 10 分钟内有效，过期请去网页重新生成。',
          ].join('\n'),
        )
      }
      const buttons: QQButton[][] = [
        [
          { label: '现实修改', data: '/现实修改', primary: true, type: 'input', enter: true },
          { label: '异常能力', data: '/异常能力', primary: true, type: 'input', enter: true },
        ],
        [
          { label: '角色状态', data: '/查询状态', type: 'input', enter: true },
          { label: '切换角色', data: '/查询角色', type: 'input', enter: true },
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
    }),
  )

  ctx.command('解绑 [confirm:string]', '解除 QQ 绑定').action(
    wrap(async ({ session }, confirm) => {
      if (!session) return
      if (!deps.web) return reply(session, deps, NO_WEB_CONFIG_BLOCK)
      const qqOpenid = session.userId
      if (!qqOpenid) return reply(session, deps, NO_QQ_ID)

      if (confirm?.trim() !== '确认') {
        return reply(
          session,
          deps,
          '# 确认解除绑定？\n\n解除后机器人将无法读取你的角色卡，网页数据不会被删除。',
          [[
            { label: '确认解除绑定', data: '/解绑 确认', type: 'input', enter: true },
            { label: '取消', data: '/查询绑定', primary: true, type: 'input', enter: true },
          ]],
        )
      }

      const r = await deps.web.unbindUser(qqOpenid)
      if (!r) return reply(session, deps, NETWORK_ERROR_BLOCK)
      if (!r.success) {
        return reply(
          session,
          deps,
          '> 解绑失败：可能当前 QQ 未绑定任何账号。先用 `查询绑定` 看一下状态。',
        )
      }
      await reply(session, deps, '> 已解除 QQ 绑定。', [
        [{ label: '重新填写绑定码', data: '绑定 ', type: 'input' }],
      ])
    }),
  )

  ctx.command('查询绑定', '查看当前 QQ 绑定状态').action(
    wrap(async ({ session }) => {
      if (!session) return
      if (!deps.web) return reply(session, deps, NO_WEB_CONFIG_BLOCK)
      const qqOpenid = session.userId
      if (!qqOpenid) return reply(session, deps, NO_QQ_ID)

      const r = await deps.web.getBindingStatus(qqOpenid)
      if (!r) return reply(session, deps, NETWORK_ERROR_BLOCK)
      if (!r.bound) {
        const buttons: QQButton[][] = [
          [{ label: '我已生成绑定码', data: '绑定 ', type: 'input' }],
        ]
        return reply(
          session,
          deps,
          [
            '# 当前 QQ 未绑定',
            '',
            '**绑定步骤**',
            '1. 在角色卡网页登录 → 个人中心 → 生成 8 位绑定码',
            '2. 在 QQ 群里发：`绑定 你的8位绑定码`',
          ].join('\n'),
          buttons,
        )
      }
      await reply(
        session,
        deps,
        ['# 绑定状态', '', `账号　**${r.name ?? r.username ?? '已绑定'}**`].join(
          '\n',
        ),
        [
          [
            { label: '角色状态', data: '/查询状态', primary: true, type: 'input', enter: true },
            { label: '切换角色', data: '/查询角色', type: 'input', enter: true },
          ],
          [
            { label: '操作菜单', data: '/菜单', type: 'input', enter: true },
            { label: '解除绑定', data: '/解绑', type: 'input', enter: true },
          ],
        ],
      )
    }),
  )
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
