import { Context, Schema } from 'koishi'
import { registerCommands } from './commands'
import { PendingAdminApplications, PendingRollStore } from './service/pending'
import { defineModel, RoomStore } from './service/store'
import { WebClient } from './service/web-client'

export const name = 'triangle-dice'

export const inject = ['database', 'http']

export const usage = `
三角机构骰点系统（移植自 Python 版 triangle-dice-bot）。

P1 当前阶段：插件骨架 + 数据模型 + 游戏规则纯函数。命令已全部注册但大多返回 [Px 待实现]。
- 骰点 / 资质 / 骰后修改 → P2 实装
- 管理员鉴权 / 注册管理 → P3 实装
- 角色卡绑定 / 任务 / 报告 → P4 实装

迁移工具：\`triangle-migrate-json <旧 data/rooms 目录>\` 一次性把 Python 版 JSON 导入 DB。
`

export interface Config {
  webApiBase: string
  webApiKey: string
  useMarkdown: boolean
}

export const Config: Schema<Config> = Schema.object({
  webApiBase: Schema.string()
    .description('角色卡 Web API 基础 URL，例 https://your-server/')
    .default(''),
  webApiKey: Schema.string()
    .role('secret')
    .description('Bot-Key（对应服务端 .env 的 BOT_API_KEY）')
    .default(''),
  useMarkdown: Schema.boolean()
    .description('在 QQ 适配器下用原生 Markdown 渲染回复（私域机器人 + 已开通 markdown 权限）。关闭则全部走纯文本。')
    .default(true),
})

export function apply(ctx: Context, config: Config): void {
  defineModel(ctx)

  const rooms = new RoomStore(ctx)
  const pending = new PendingRollStore()
  const pendingAdmin = new PendingAdminApplications()

  const web =
    config.webApiBase && config.webApiKey
      ? new WebClient(ctx, config.webApiBase, config.webApiKey)
      : null

  if (!web) {
    ctx.logger('triangle').info(
      'webApiBase 或 webApiKey 未配置 → 角色卡相关命令将不可用（P4 命令）',
    )
  }

  registerCommands(ctx, {
    rooms,
    pending,
    pendingAdmin,
    web,
    useMarkdown: config.useMarkdown,
  })

  // ─────────────────────────────────────────────────────────────────────
  // QQ callback button 凭证缓存
  //   QQ 群消息 API 不接受 event_id 作被动凭证（实测 code:40034025 拒收）。
  //   退而求其次：缓存每个 channel 最近一条 @bot 消息的 msg_id（5 分钟有效），
  //   interaction handler 用它当 msg_id 发回复——只要按钮点击在 5 分钟内就 work。
  // ─────────────────────────────────────────────────────────────────────
  const lastMessageIdByChannel = new Map<string, { id: string; ts: number }>()
  const MSG_ID_TTL = 5 * 60 * 1000

  ctx.on('message', (session) => {
    if (session.platform === 'qq' && session.messageId && session.channelId && !session.isDirect) {
      lastMessageIdByChannel.set(session.channelId, {
        id: session.messageId,
        ts: Date.now(),
      })
    }
  })

  // QQ keyboard callback (type=1) 按钮 → satori 转成 interaction/button session
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(ctx as any).on('interaction/button', async (session: import('koishi').Session) => {
    const buttonData = (session as unknown as { event?: { button?: { data?: string } } })
      .event?.button?.data
    if (!buttonData) {
      ctx.logger('triangle').warn('interaction/button without button.data')
      return
    }

    // 注入最近的 msg_id 作被动凭证（QQ event_id 字段在群消息不被支持）
    const channelId = session.channelId
    if (channelId) {
      const cached = lastMessageIdByChannel.get(channelId)
      if (cached && Date.now() - cached.ts < MSG_ID_TTL) {
        ;(session as unknown as { messageId: string }).messageId = cached.id
      } else {
        ctx.logger('triangle').warn(
          '无可用 msg_id 凭证（5 分钟内此频道无消息），interaction 回复可能发不出去',
        )
      }
    }

    ctx.logger('triangle').info('interaction → execute: %s (msg_id=%s)', buttonData, session.messageId)
    try {
      await session.execute(buttonData)
    } catch (e) {
      ctx.logger('triangle').warn('interaction execute failed: %s', e)
    }
  })

  ctx.on('dispose', () => {
    pending.dispose()
  })
}
