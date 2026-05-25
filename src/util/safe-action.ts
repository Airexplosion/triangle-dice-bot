import type { Argv, Context, Session } from 'koishi'
import { sendQQMarkdown } from './qq-markdown'

/**
 * 创建一个用于包装命令 action 的 wrap 工厂。
 *
 * 每个 register*Commands 顶部用：
 *   const wrap = makeWrap(ctx, deps.useMarkdown)
 *   ctx.command(...).action(wrap(async ({session}, args) => { ... }))
 *
 * 作用：
 *   - catch action 内部任何未捕获异常
 *   - 详细错误记到 logger（含 stack）
 *   - 给用户一段「具体错误线索 + 引导」，避免出现 Koishi 默认的"发生未知错误"
 */
export function makeWrap(ctx: Context, useMarkdown: boolean) {
  return function wrap<TArgs extends unknown[]>(
    handler: (argv: Argv, ...args: TArgs) => Promise<unknown>,
  ): (argv: Argv, ...args: TArgs) => Promise<void> {
    return async (argv, ...args) => {
      try {
        await handler(argv, ...args)
      } catch (e) {
        ctx
          .logger('triangle')
          .warn(
            'action error: cmd=%s args=%j stack=%s',
            argv.command?.displayName ?? argv.command?.name ?? '?',
            args,
            (e as Error)?.stack ?? String(e),
          )
        if (argv.session) {
          await reportError(argv.session, useMarkdown, e)
        }
      }
    }
  }
}

async function reportError(
  session: Session,
  useMarkdown: boolean,
  e: unknown,
): Promise<void> {
  const friendly = mapErrorMessage(e)
  await sendQQMarkdown(session, friendly, { enabled: useMarkdown })
}

/**
 * 把异常 / 错误响应翻译成中文友好提示。
 * 识别得越多越好——能给用户具体的引导，而不是一句"出错"。
 */
function mapErrorMessage(e: unknown): string {
  const err = e as {
    message?: string
    response?: { status?: number; data?: unknown }
  }
  const msg = err.message ?? ''
  const body = err.response?.data
  const bodyStr =
    body && typeof body === 'object' ? JSON.stringify(body) : String(body ?? '')

  // QQ 服务端常见 code
  if (/40034102/.test(bodyStr) || /主动消息失败/.test(bodyStr)) {
    return [
      '> **回复失败**　QQ 拒绝了本次回复',
      '',
      '可能原因：上次 @ 机器人已超过 5 分钟，被动消息凭证过期。',
      '',
      '请重新 @ 机器人发一次命令（或先发个 `帮助`）再试。',
    ].join('\n')
  }
  if (/40034025/.test(bodyStr) || /event_id\s*无效/.test(bodyStr)) {
    return [
      '> **回复失败**　按钮回调凭证已过期',
      '',
      '请重新 @ 机器人发一次命令再试。',
    ].join('\n')
  }
  if (/40034005/.test(bodyStr)) {
    return '> **回复失败**　消息序列号冲突（5 分钟内重试同一条命令请间隔几秒）'
  }
  if (/304002|敏感|内容/.test(bodyStr)) {
    return '> **回复失败**　回复内容触发了 QQ 安全审核，请稍后再试或换个写法。'
  }
  if (/304023/.test(bodyStr)) {
    return '> **审核中**　QQ 服务端正在审核本条消息，稍候片刻'
  }

  // 通用 HTTP 错误
  const status = err.response?.status
  if (status === 401 || status === 403) {
    return [
      '> **未授权**　角色卡服务拒绝了请求',
      '',
      '可能是 Bot-Key 配错或对应账号没有权限。请联系经理排查。',
    ].join('\n')
  }
  if (status && status >= 500) {
    return '> **角色卡服务异常**　稍后重试，问题持续请联系经理'
  }
  if (/ETIMEDOUT|ECONNREFUSED|ENOTFOUND|timeout/i.test(msg)) {
    return '> **连接超时**　暂时无法连接角色卡服务，稍后重试'
  }

  // 兜底：把 message 透出，至少告诉用户具体在哪
  return [
    '> **命令执行出错**',
    '',
    `错误信息：${msg.slice(0, 200) || '未知'}`,
    '',
    '若反复出现，请把命令名和此错误反馈给开发者。',
  ].join('\n')
}
