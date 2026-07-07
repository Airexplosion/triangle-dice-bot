import type { Context, Session } from 'koishi'
import { rawRoomIdOf } from '../room'
import type { WeatherCard, WebClient } from '../service/web-client'
import {
  NETWORK_ERROR_BLOCK,
  NO_QQ_ID,
  NO_WEB_CONFIG_BLOCK,
} from '../util/messages'
import { sendQQMarkdown, type QQButton } from '../util/qq-markdown'
import { makeWrap } from '../util/safe-action'

export interface WeatherDeps {
  web: WebClient | null
  useMarkdown: boolean
}

export function registerWeatherCommands(ctx: Context, deps: WeatherDeps): void {
  const wrap = makeWrap(ctx, deps.useMarkdown)

  ctx
    .command('骰天气 [pickIdx:number]', '骰 1D20 天气（abc 组需再挑一张）')
    .action(
      wrap(async ({ session }, pickIdx) => {
        if (!session) return
        if (session.isDirect) return reply(session, deps, '> 私聊不支持天气骰点。')
        if (!deps.web) return reply(session, deps, NO_WEB_CONFIG_BLOCK)
        const rawRoomId = rawRoomIdOf(session)
        if (!rawRoomId) return reply(session, deps, '> 无法定位群号。')
        const qqOpenid = session.userId ?? undefined

        const idx = typeof pickIdx === 'number' && pickIdx >= 0 && pickIdx <= 2 ? pickIdx : undefined
        const r = await deps.web.rollWeather(rawRoomId, qqOpenid, idx)
        if (!r) return reply(session, deps, NETWORK_ERROR_BLOCK)
        if (!r.success) return reply(session, deps, `> ${r.error ?? '骰天气失败'}`)

        if (r.action === 'pending' && r.options?.length) {
          // abc 组：弹按钮让 GM 挑
          const buttons: QQButton[][] = [
            r.options.map((_c, i) => ({
              label: r.options![i].id.slice(-1).toUpperCase() + '　' + truncateTitle(r.options![i].title),
              data: `骰天气 ${i}`,
              type: 'input' as const,
              enter: true,
            })),
          ]
          const optionsBlock = r.options
            .map(
              (c, i) =>
                `**${String.fromCharCode(65 + i)}. ${c.title}** \`${c.id}\`\n> ${c.text}`,
            )
            .join('\n\n')
          return reply(
            session,
            deps,
            [
              `# 骰出第 ${r.group} 组`,
              '',
              optionsBlock,
              '',
              '点下方按钮任选一张：',
            ].join('\n'),
            buttons,
          )
        }

        if (r.action === 'added' && r.card) {
          return reply(
            session,
            deps,
            [
              `# 骰天气：第 ${r.group} 组`,
              '',
              `**${r.card.title}** \`${r.card.id}\``,
              '',
              `> ${r.card.text}`,
              '',
              '已同步到网页画板，玩家端可见。',
            ].join('\n'),
          )
        }

        return reply(session, deps, '> 骰点未返回结果。')
      }),
    )

  ctx
    .command('查天气', '查看当前生效的天气卡')
    .alias('当前天气')
    .action(
      wrap(async ({ session }) => {
        if (!session) return
        if (session.isDirect) return reply(session, deps, '> 私聊不支持。')
        if (!deps.web) return reply(session, deps, NO_WEB_CONFIG_BLOCK)
        const rawRoomId = rawRoomIdOf(session)
        if (!rawRoomId) return reply(session, deps, '> 无法定位群号。')

        const r = await deps.web.getCurrentWeather(rawRoomId)
        if (!r) return reply(session, deps, NETWORK_ERROR_BLOCK)
        if (!r.success) return reply(session, deps, `> ${r.error ?? '查询失败'}`)

        const cards = r.weather ?? []
        if (!cards.length) {
          return reply(session, deps, '# 当前无生效天气\n\n用 `骰天气` 骰一张。')
        }
        const body = cards
          .map((c) => `**${c.title}** \`${c.id}\`\n> ${c.text}`)
          .join('\n\n')
        return reply(session, deps, [`# 当前生效天气（${cards.length}）`, '', body].join('\n'))
      }),
    )
}

function truncateTitle(t: string): string {
  return t.length > 6 ? t.slice(0, 6) + '…' : t
}

async function reply(
  session: Session,
  deps: WeatherDeps,
  content: string,
  buttons?: QQButton[][],
): Promise<void> {
  await sendQQMarkdown(session, content, {
    enabled: deps.useMarkdown,
    buttons,
  })
  // 让 NO_QQ_ID 保留 import 以后可能用到（暂未使用）
  void NO_QQ_ID
}
