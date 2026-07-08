import type { Context } from 'koishi'
import { APTITUDE_NAMES, APTITUDE_SET } from '../const'
import { rawRoomIdOf, roomIdOf } from '../room'
import { getOrCreatePlayer, type RoomStore } from '../service/store'
import type { AptitudeOperation, WebClient } from '../service/web-client'
import { sendQQMarkdown, type QQButton } from '../util/qq-markdown'

export interface AptitudeDeps {
  rooms: RoomStore
  web: WebClient | null
  useMarkdown: boolean
}

export interface ParsedAptitudeInput {
  operations: AptitudeOperation[]
  unknown: string[]
}

/**
 * Koishi 会把位置参数中的 -1 当成命令选项。命令分发前先把符号写法转换为中文加减，
 * 同时兼容输入法常见的 Unicode 正负号。
 */
export function normalizeAptitudeCommandContent(content: string): string {
  if (!/^[\s/.。]*录入资质/.test(content)) return content
  return content
    .replace(/[−－﹣]/g, '-')
    .replace(/[＋﹢]/g, '+')
    .replace(/-(?=\s*\d)/g, '减')
    .replace(/\+(?=\s*\d)/g, '加')
}

/** 解析绝对赋值、+/- 增量和上限操作。 */
export function parseAptitudeInput(
  input: string,
): ParsedAptitudeInput {
  const operations: AptitudeOperation[] = []
  const unknown: string[] = []

  const normalized = input
    .replace(/[−－﹣]/g, '-')
    .replace(/[＋﹢]/g, '+')
  const tokens = normalized.split(/[\s,，、]+/).filter(Boolean)

  for (let index = 0; index < tokens.length; index++) {
    const original = tokens[index]
    const name = APTITUDE_NAMES.find((candidate) => original.startsWith(candidate))
    if (!name) {
      unknown.push(original)
      continue
    }

    let field: 'current' | 'max' = 'current'
    let amountText = original.slice(name.length)
    if (amountText.startsWith('上限')) {
      field = 'max'
      amountText = amountText.slice(2)
    } else if (amountText.startsWith('当前')) {
      amountText = amountText.slice(2)
    }

    if (!amountText) {
      const fieldToken = tokens[index + 1]
      if (fieldToken === '上限' || fieldToken === '当前') {
        field = fieldToken === '上限' ? 'max' : 'current'
        index++
      }
      const nextToken = tokens[index + 1] ?? ''
      if (nextToken && APTITUDE_NAMES.some((candidate) => nextToken.startsWith(candidate))) {
        unknown.push(original)
        continue
      }
      amountText = nextToken
      if (amountText) index++
    }

    const amount = parseAmount(amountText)
    if (!amount || !APTITUDE_SET.has(name)) {
      unknown.push(original + (amountText && original === name ? ` ${amountText}` : ''))
      continue
    }
    operations.push({ name, field, mode: amount.mode, value: amount.value })
  }
  return { operations, unknown }
}

function parseAmount(text: string): { mode: 'set' | 'delta'; value: number } | null {
  const compact = text.replace(/\s+/g, '')
  let match = compact.match(/^(?:加|\+)(\d+)$/)
  if (match) return { mode: 'delta', value: Number.parseInt(match[1], 10) }
  match = compact.match(/^(?:减|-)(\d+)$/)
  if (match) return { mode: 'delta', value: -Number.parseInt(match[1], 10) }
  match = compact.match(/^(\d+)$/)
  if (match) return { mode: 'set', value: Number.parseInt(match[1], 10) }
  return null
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

      const { operations, unknown } = parseAptitudeInput(input.trim())

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
      if (operations.length === 0) {
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

      let snapshot: AptitudeSnapshot[] = []
      let usedWeb = false

      if (deps.web) {
        const webResult = await deps.web.updateAptitudes(playerId, rawRoomId, operations)
        if (!webResult) {
          await reply(session, deps, '> 角色卡服务器暂时无法连接，资质未修改。')
          return
        }
        if (webResult.success && webResult.results) {
          usedWeb = true
          snapshot = webResult.results.map((result) => ({
            name: result.operation.name,
            field: result.operation.field,
            before: result.before,
            after: result.after,
          }))
          await deps.rooms.update(roomId, session.platform, rawRoomId, (room) => {
            const player = getOrCreatePlayer(room, playerId)
            for (const result of webResult.results ?? []) {
              player.aptitudes[result.operation.name] = result.after.current
            }
          })
        } else if (!/未绑定QQ|没有角色/.test(webResult.error ?? '')) {
          await reply(session, deps, `> ${webResult.error ?? '资质修改失败'}`)
          return
        }
      }

      if (!usedWeb) {
        if (operations.some((operation) => operation.field === 'max')) {
          await reply(session, deps, '> 修改资质上限需要先绑定网页角色卡。')
          return
        }
        let validationError = ''
        await deps.rooms.update(roomId, session.platform, rawRoomId, (room) => {
          const player = getOrCreatePlayer(room, playerId)
          const pendingValues = { ...player.aptitudes }
          const simulated = operations.map((operation) => {
            const before = pendingValues[operation.name] ?? 0
            const after = operation.mode === 'delta' ? before + operation.value : operation.value
            if (after < 0 || after > 9) validationError = `${operation.name} 当前值必须在 0～9 之间。`
            pendingValues[operation.name] = after
            return { operation, before, after }
          })
          if (validationError) return
          snapshot = simulated.map(({ operation, before, after }) => {
            player.aptitudes[operation.name] = after
            return {
              name: operation.name,
              field: 'current' as const,
              before: { current: before, max: null },
              after: { current: after, max: null },
            }
          })
        })
        if (validationError) {
          await reply(session, deps, `> ${validationError}`)
          return
        }
      }

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
  snapshot: AptitudeSnapshot[],
): string {
  const lines: string[] = []
  lines.push('# 资质已更新')
  lines.push('')
  for (const { name, field, before, after } of snapshot) {
    if (field === 'max') {
      lines.push(`**${name}**　上限 **${before.max} → ${after.max}**　当前 **${after.current}**`)
    } else if (after.max === null) {
      lines.push(`**${name}**　当前 **${before.current} → ${after.current}**`)
    } else {
      lines.push(`**${name}**　当前 **${before.current} → ${after.current}**　上限 **${after.max}**`)
    }
  }
  return lines.join('\n')
}

interface AptitudeSnapshot {
  name: string
  field: 'current' | 'max'
  before: { current: number; max: number | null }
  after: { current: number; max: number | null }
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
