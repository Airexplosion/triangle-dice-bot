import type { Context } from 'koishi'
import { APTITUDE_NAMES, APTITUDE_SET } from '../const'
import { rawRoomIdOf, roomIdOf } from '../room'
import { getOrCreatePlayer, type RoomStore } from '../service/store'
import { fireSetAptitudes } from '../service/sync'
import type { WebClient } from '../service/web-client'
import { sendQQMarkdown, type QQButton } from '../util/qq-markdown'

export interface AptitudeDeps {
  rooms: RoomStore
  web: WebClient | null
  useMarkdown: boolean
}

/** 解析 "专注3 气场5" 这种串成 [(name, value), ...]。*/
export function parseAptitudeInput(
  input: string,
): { updates: Map<string, number>; unknown: string[] } {
  const updates = new Map<string, number>()
  const unknown: string[] = []

  // 多 token 用空格 / 中文逗号 / 顿号分隔；每 token 内部资质名 + 数字
  const tokens = input.split(/[\s,，、]+/).filter(Boolean)
  const PAIR_RE = /^(.+?)(\d+)$/
  for (const tok of tokens) {
    const m = tok.match(PAIR_RE)
    if (!m) {
      unknown.push(tok)
      continue
    }
    const name = m[1]
    const value = Number.parseInt(m[2], 10)
    if (!APTITUDE_SET.has(name)) {
      unknown.push(name)
      continue
    }
    updates.set(name, value)
  }
  return { updates, unknown }
}

export function registerAptitudeCommand(ctx: Context, deps: AptitudeDeps): void {
  ctx
    .command('录入资质 <input:text>', '录入九项资质，例：录入资质 专注3 气场5')
    .action(async ({ session }, input) => {
      if (!session) return
      if (session.isDirect) {
        await reply(session, deps, '> 私聊不支持此命令。')
        return
      }
      if (!input || !input.trim()) {
        await reply(
          session,
          deps,
          [
            '**用法**　录入资质 资质数值 …',
            '',
            '> 例：录入资质 专注3 气场5',
            '',
            `九项资质：${APTITUDE_NAMES.join(' · ')}`,
          ].join('\n'),
        )
        return
      }

      const { updates, unknown } = parseAptitudeInput(input.trim())

      if (unknown.length > 0) {
        await reply(
          session,
          deps,
          [
            `> 未知资质或格式错误：${unknown.join(' / ')}`,
            '',
            `九项资质：${APTITUDE_NAMES.join(' · ')}`,
          ].join('\n'),
        )
        return
      }
      if (updates.size === 0) {
        await reply(session, deps, '> 没有可写入的资质。')
        return
      }

      const roomId = roomIdOf(session)
      const rawRoomId = rawRoomIdOf(session)
      if (!roomId || !rawRoomId) {
        await reply(session, deps, '> 无法定位房间。')
        return
      }
      const playerId = session.userId ?? 'unknown'

      let snapshot: { name: string; before: number; after: number }[] = []

      await deps.rooms.update(roomId, session.platform, rawRoomId, (room) => {
        const player = getOrCreatePlayer(room, playerId)
        snapshot = [...updates.entries()].map(([name, value]) => {
          const before = player.aptitudes[name] ?? 0
          player.aptitudes[name] = value
          return { name, before, after: value }
        })
      })

      // web 同步：把更新过的资质推到网页
      fireSetAptitudes(deps.web, session, Object.fromEntries(updates))

      const md = renderAptitudeUpdate(snapshot)
      const buttons: QQButton[][] = [
        [
          {
            label: '现实修改',
            data: '/现实修改',
            primary: true,
            type: 'input',
            enter: true,
          },
          {
            label: '异常能力',
            data: '/异常能力',
            primary: true,
            type: 'input',
            enter: true,
          },
        ],
      ]
      await reply(session, deps, md, buttons)
    })
}

function renderAptitudeUpdate(
  snapshot: { name: string; before: number; after: number }[],
): string {
  const lines: string[] = []
  lines.push('# 资质已更新')
  lines.push('')
  for (const { name, before, after } of snapshot) {
    const arrow = before === after ? `${before}` : `${before} → ${after}`
    lines.push(`**${name}**　**${arrow}**`)
  }
  return lines.join('\n')
}

async function reply(
  session: import('koishi').Session,
  deps: AptitudeDeps,
  content: string,
  buttons?: QQButton[][],
): Promise<void> {
  await sendQQMarkdown(session, content, {
    enabled: deps.useMarkdown,
    buttons,
  })
}
