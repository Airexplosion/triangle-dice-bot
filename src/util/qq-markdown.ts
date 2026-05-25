import type { Session } from 'koishi'

/**
 * 一个按钮。type=command 表示点击后自动以点击者身份发送 data 文本（被机器人接住），
 * type=link 表示点击跳转 URL。
 */
export interface QQButton {
  /** 按钮 id（可选；type=callback 时用于回调识别）*/
  id?: string
  /** 按钮显示的文字 */
  label: string
  /**
   * 'callback'（默认） — type=1，点击后 QQ 把按钮 data 透传到机器人，
   *                     由插件 ctx.on('interaction/button') handler 处理（不在群里显示用户消息）
   * 'input'           — type=2，点击把 data 填到输入框（带 enter:false），等用户编辑发送
   * 'link'            — type=0，点击跳 URL
   */
  type?: 'callback' | 'input' | 'link'
  /** callback 时是命令文本（在 interaction handler 里 session.execute）；
   *  input 时是输入框预填文本；link 时是 URL */
  data: string
  /** primary=true 用蓝底高亮按钮 */
  primary?: boolean
}

export interface SendQQMarkdownOptions {
  /** 总开关；false 时所有平台一律 fallback session.send */
  enabled?: boolean
  /** 二维数组：每个内层数组是一行按钮（一行最多 5，最多 5 行） */
  buttons?: QQButton[][]
}

/**
 * 在 QQ 适配器下发送原生 Markdown（可附 keyboard 按钮），其它平台 fallback 普通 send。
 *
 * 背景：
 *   @satorijs/adapter-qq (4.7) 的 MessageEncoder 没暴露 markdown element，
 *   普通 `<text>` 内容会作为 plain text 发出 (msg_type=0)；
 *   `<button>` 虽然认但内容会被 escapeMarkdown 转义。
 *
 *   要让原生 markdown + keyboard 一起发出去，最稳的做法是直接调 bot.internal API
 *   构造 raw payload（绕开 encoder）。
 *
 * 私域机器人 + QQ 开放平台「原生 markdown」权限开通后，content 可任意填。
 *
 * 本函数仅用于 reply（被动消息）：依赖 session.messageId 作为 msg_id；
 * msg_seq 在 session 上自递增。主动消息（不基于命令触发）不要走这里。
 */
/**
 * 模块级 msg_seq 计数器（per msg_id）。
 * QQ 服务端要求同一 msg_id 多次回复时 msg_seq 必须递增。
 * Map 永远不清理也无所谓——5 分钟后 msg_id 过期，新 msg_id 进来时无 entry，从 1 开始。
 * 极端情况（机器人长期跑、缓存大）时可加 LRU；当前规模无关紧要。
 */
const msgSeqCounter = new Map<string, number>()

export function nextMsgSeqFor(key: string): number {
  const next = (msgSeqCounter.get(key) ?? 0) + 1
  msgSeqCounter.set(key, next)
  return next
}

/** 仅供测试用：重置内部计数器，避免测试间互相干扰。*/
export function __resetMsgSeqCounterForTesting(): void {
  msgSeqCounter.clear()
}

/**
 * 在 reply 顶部添加触发者标识行。
 * QQ 群 markdown at 语法（依官方文档）：<qqbot-at-user id="openid" />
 * 之前用 uin= 失败，改 id= 重试。仍失败则 fallback 短码。
 */
function renderTriggerLine(session: Session): string | null {
  if (session.isDirect) return null
  const userId = session.userId
  if (!userId) return null

  if (session.platform === 'qq') {
    if (isQQGuildChannel(session)) {
      return `> 触发者　<@!${userId}>`
    }
    return `> 触发者　<qqbot-at-user id="${userId}" />`
  }
  return `> 触发者　#${shortUserCode(userId)}`
}

function shortUserCode(userId: string): string {
  return userId.slice(-6).toUpperCase()
}

export async function sendQQMarkdown(
  session: Session,
  content: string,
  optionsOrEnabled: boolean | SendQQMarkdownOptions = true,
): Promise<void> {
  const options: SendQQMarkdownOptions =
    typeof optionsOrEnabled === 'boolean'
      ? { enabled: optionsOrEnabled }
      : optionsOrEnabled
  const enabled = options.enabled ?? true
  if (!content) return

  // 自动在 reply 顶部加触发者短码（多人使用时区分谁发的）。
  // 私聊不加；其它场景一律加。命令层不需要管这事。
  const triggerLine = renderTriggerLine(session)
  const body = triggerLine ? `${triggerLine}\n${content}` : content

  // 总开关关闭：所有平台一律走 session.send（纯文本渲染）
  if (!enabled) {
    await session.send(body)
    return
  }

  // 非 QQ 适配器：直接发文本，让该平台原生渲染 markdown
  if (session.platform !== 'qq') {
    await session.send(body)
    return
  }

  // QQ 适配器：绕开 encoder 走 internal
  const bot = session.bot as unknown as QQBotInternalShim
  if (!bot?.internal) {
    // 防御：如果 internal 不可用，退化为普通 send（QQ 端会变纯文本）
    await session.send(body)
    return
  }

  const channelId = session.channelId
  if (!channelId) {
    // 没有 channelId 无法走 internal，退化
    await session.send(body)
    return
  }

  // msg_seq 必须按 msg_id 全局递增（per-session 计数会被 callback 后新 session 撞回 1）
  const msgSeq = nextMsgSeqFor(session.messageId ?? `__channel:${channelId}`)

  const keyboard = buildKeyboard(options.buttons)

  // 频道：ChannelRequest，无 msg_type，markdown 字段直送
  // 群 / 私聊：Request，msg_type=2 (MARKDOWN)
  if (isQQGuildChannel(session)) {
    await bot.internal.sendMessage(channelId, {
      content: ' ',
      markdown: { content: body },
      msg_id: session.messageId,
      keyboard,
    })
    return
  }

  const payload: QQMarkdownRequest = {
    msg_type: 2,
    content: ' ',
    markdown: { content: body },
    msg_seq: msgSeq,
    keyboard,
  }
  if (session.messageId) payload.msg_id = session.messageId

  try {
    if (session.isDirect) {
      await bot.internal.sendPrivateMessage(channelId, payload)
    } else {
      await bot.internal.sendMessage(channelId, payload)
    }
  } catch (e) {
    const err = e as { response?: { status?: number; data?: unknown }; message?: string }
    const ctxApp = (session as unknown as { app?: { logger?: (n: string) => { warn: (m: string, ...a: unknown[]) => void } } }).app
    ctxApp?.logger?.('triangle:qq-md').warn(
      'send-md failed: status=%s body=%j msg=%s — fallback to plain text',
      err.response?.status,
      err.response?.data,
      err.message,
    )
    // 降级 1：尝试用 satori 普通 send 发 plain text（不带 markdown / 按钮）
    try {
      await session.send(body)
      return
    } catch (e2) {
      // 降级 2：失败原因附进日志即可，不再抛出（避免 Koishi 显示"发生未知错误"）
      ctxApp?.logger?.('triangle:qq-md').warn(
        'plain fallback also failed: %s',
        (e2 as Error)?.message ?? e2,
      )
    }
  }
}

function buildKeyboard(rows?: QQButton[][]): QQKeyboard | undefined {
  if (!rows?.length) return undefined
  return {
    content: {
      rows: rows.map((row) => ({
        buttons: row.map((btn) => {
          const kind = btn.type ?? 'callback'
          const actionType: 0 | 1 | 2 = kind === 'link' ? 0 : kind === 'input' ? 2 : 1
          return {
            id: btn.id ?? `btn-${Math.random().toString(36).slice(2, 10)}`,
            render_data: {
              label: btn.label,
              visited_label: btn.label,
              style: btn.primary ? 1 : 0,
            },
            action: {
              type: actionType,
              permission: { type: 2 }, // 所有人可点
              data: btn.data,
              // input 模式必须显式 enter:false 让 QQ 不直接发，留到输入框
              ...(actionType === 2 ? { enter: false } : {}),
            },
          }
        }),
      })),
    },
  }
}

/**
 * 判断 QQ session 是否来自频道（guild channel），而非 QQ 群或私聊。
 * 频道场景 messageId 通常包含频道格式，且有独立 channel 概念。
 *
 * NOTE：adapter-qq 区分频道/群的方式在不同版本可能不同；目前用 channelId 与 guildId
 * 是否相等近似判断（频道下二者不同，群下相同）。后续若实测有偏差，调整本函数即可。
 */
function isQQGuildChannel(session: Session): boolean {
  if (session.isDirect) return false
  return Boolean(
    session.channelId &&
      session.guildId &&
      session.channelId !== session.guildId,
  )
}

// adapter-qq 的 internal 没导出公共类型，这里只声明本工具用到的方法签名。
interface QQBotInternalShim {
  internal: {
    sendMessage(
      channelId: string,
      data: QQMarkdownRequest | QQGuildMarkdownRequest,
    ): Promise<unknown>
    sendPrivateMessage(
      channelId: string,
      data: QQMarkdownRequest,
    ): Promise<unknown>
  }
}

interface QQMarkdownRequest {
  msg_type: 2
  content?: string
  markdown: { content: string }
  msg_id?: string
  msg_seq?: number
  keyboard?: QQKeyboard
}

interface QQGuildMarkdownRequest {
  content?: string
  markdown: { content: string }
  msg_id?: string
  keyboard?: QQKeyboard
}

interface QQKeyboard {
  content: {
    rows: Array<{
      buttons: Array<{
        id?: string
        render_data: { label: string; visited_label: string; style: 0 | 1 }
        action: {
          type: 0 | 1 | 2
          permission: { type: 0 | 1 | 2 | 3; specify_user_ids?: string[]; specify_role_ids?: string[] }
          data: string
          enter?: boolean
        }
      }>
    }>
  }
}
