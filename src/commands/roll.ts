import type { Context } from 'koishi'
import { APTITUDE_NAMES, APTITUDE_SET } from '../const'
import { calculateChaos, isTripleSublimation } from '../game/chaos'
import { applyBurnout, countNonSuccesses, countSuccesses, roll6d4 } from '../game/dice'
import { rawRoomIdOf, roomIdOf } from '../room'
import type { PendingRoll } from '../types'
import { sendQQMarkdown, type QQButton } from '../util/qq-markdown'
import { getOrCreatePlayer, type RoomStore } from '../service/store'
import type { PendingRollStore } from '../service/pending'
import { fireDiceRoll, fireSyncChaos, fireSyncFailure, syncFromWeb } from '../service/sync'
import type { WebClient } from '../service/web-client'
import { isMissionMember } from '../util/mission'

export interface RollDeps {
  rooms: RoomStore
  pending: PendingRollStore
  web: WebClient | null
  useMarkdown: boolean
}

export function registerRollCommands(ctx: Context, deps: RollDeps): void {
  ctx
    .command('现实修改 <aptitude:string>', '使用现实修改触发骰点')
    .action(async ({ session }, aptitude) => handle(ctx, deps, session, '现实修改', aptitude))

  ctx
    .command('异常能力 <aptitude:string>', '使用异常能力触发骰点')
    .action(async ({ session }, aptitude) => {
      if (!session) return
      // 不带参数：优先读角色异常能力列表，渲染"XX：资质"按钮 + 一个"常规异常"fallback
      if (!aptitude && !session.isDirect && deps.web && session.userId) {
        const rawRoomId = rawRoomIdOf(session)
        const resp = await deps.web.getCharacterAnomalies(session.userId, rawRoomId ?? undefined)
        if (resp?.success && resp.anomalies?.length) {
          const valid = resp.anomalies.filter((a) => !!a.qualName)
          if (valid.length) {
            const buttons: QQButton[][] = []
            for (let i = 0; i < valid.length; i += 2) {
              buttons.push(
                valid.slice(i, i + 2).map((a) => ({
                  label: `${a.name}：${a.qualName!}`,
                  // 直接复用 6D4 路径：input+enter "/异常能力 <资质>"
                  data: `/异常能力 ${a.qualName!}`,
                  type: 'input' as const,
                  enter: true,
                })),
              )
            }
            buttons.push([{ label: '常规异常', data: '/异常能力 __GRID__', type: 'input', enter: true }])
            const head = resp.characterName
              ? `# 异常能力（${resp.characterName}）\n\n点击触发：`
              : '# 异常能力\n\n点击触发：'
            await reply(session, deps, head, buttons)
            return
          }
        }
        // 没绑卡 / 没异常 / 全部 qualName=null → 退回 9 资质九宫格
      }
      // "常规异常"按钮：显式落到九宫格
      if (aptitude === '__GRID__') {
        await reply(session, deps, `# 异常能力\n\n请选择资质：`, buildAptitudeGrid('异常能力'))
        return
      }
      return handle(ctx, deps, session, '异常能力', aptitude)
    })
}

type Trigger = '现实修改' | '异常能力'

async function handle(
  ctx: Context,
  deps: RollDeps,
  session: import('koishi').Session | undefined,
  trigger: Trigger,
  aptName: string | undefined,
): Promise<void> {
  if (!session) return

  if (session.isDirect) {
    await reply(session, deps, '> 私聊不支持骰点命令。')
    return
  }
  if (!aptName) {
    // 不带资质名 → 给九宫格按钮，让玩家点选
    await reply(
      session,
      deps,
      `# ${trigger}\n\n请选择资质：`,
      buildAptitudeGrid(trigger),
    )
    return
  }
  if (!APTITUDE_SET.has(aptName)) {
    await reply(
      session,
      deps,
      `> 未知资质 **${aptName}**\n请从下方选择：`,
      buildAptitudeGrid(trigger),
    )
    return
  }

  const roomId = roomIdOf(session)
  const rawRoomId = rawRoomIdOf(session)
  if (!roomId || !rawRoomId) {
    await reply(session, deps, '> 无法定位房间。')
    return
  }

  const playerId = session.userId ?? 'unknown'
  const isReality = trigger === '现实修改'

  // 骰点前先从 web 同步：1) 群任务的最新混沌/燃尽，2) 玩家的最新资质
  await syncFromWeb(deps.web, deps.rooms, session)
  let webAptitudes: Record<string, number> | null = null
  if (deps.web && playerId) {
    const apt = await deps.web.getAptitudes(playerId, rawRoomId)
    if (apt?.success && apt.attrs) {
      webAptitudes = mapWebAttrsToAptitudes(apt.attrs)
      ctx.logger('triangle').info(
        'roll: web 资质拉取成功 player=%s apt=%j',
        playerId.slice(-6),
        webAptitudes,
      )
    } else {
      ctx.logger('triangle').warn(
        'roll: web 资质拉取失败 player=%s success=%s error=%s',
        playerId.slice(-6),
        apt?.success ?? 'null',
        apt?.error ?? 'connection failed',
      )
    }
  }

  // 单次 RMW：在 update 闭包里读取 player + 触发骰点 + 写回 chaos/failure
  let result: RollResult | null = null

  await deps.rooms.update(roomId, session.platform, rawRoomId, (room) => {
    const player = getOrCreatePlayer(room, playerId)
    if (webAptitudes) {
      for (const [k, v] of Object.entries(webAptitudes)) {
        if (typeof v === 'number') player.aptitudes[k] = v
      }
    }
    const aptValue = player.aptitudes[aptName] ?? 0
    const zeroPenalty = aptValue === 0 ? 1 : 0
    const fcBefore = room.failureCount
    const burnout = isReality ? fcBefore + zeroPenalty : zeroPenalty

    const rawDice = roll6d4()
    const rawTriple = isTripleSublimation(rawDice)
    const burned = applyBurnout(rawDice, burnout)
    const successes = countSuccesses(burned.dice)

    const chaosCalc = rawTriple ? 0 : calculateChaos(burned.dice, burned.unconsumed)
    const isMember = isMissionMember(room, playerId)

    // 观察模式：骰子照算，但不影响混沌池 / 失败计数
    const chaosApplied = isMember ? chaosCalc : 0
    let failureIncremented = false

    if (isMember) {
      room.chaosPool += chaosApplied
      if (isReality && successes === 0) {
        room.failureCount += 1
        failureIncremented = true
      }
    }

    const pendingRoll: PendingRoll = {
      playerId,
      trigger,
      aptitudeName: aptName,
      currentDice: [...burned.dice],
      chaosApplied,
      failureIncremented,
      unconsumedBurnout: burned.unconsumed,
      createdAt: Date.now(),
      consumedAptitudes: {},
    }
    deps.pending.set(roomId, playerId, pendingRoll)

    result = {
      trigger,
      aptName,
      aptValue,
      rawDice,
      rawTriple,
      burnout,
      burnedDice: burned.dice,
      unconsumed: burned.unconsumed,
      successes,
      // 显示用的"本次混沌"：观察模式仍用计算值（让玩家看到自己骰出来多少），但 chaosApplied=0
      chaos: chaosCalc,
      chaosPool: room.chaosPool,
      failureCount: room.failureCount,
      failureIncremented,
      fcBefore,
      zeroPenalty,
      isReality,
      isMember,
    }
  })

  if (!result) return

  // 骰点后台同步 web：仅当玩家是任务成员时才推混沌/失败到 web
  const r = result as RollResult
  if (r.isMember) {
    fireSyncChaos(deps.web, session, r.chaos, `${r.trigger} ${r.aptName}`)
    if (r.failureIncremented) fireSyncFailure(deps.web, session, 1)
  }
  // 把骰子结果推到 web 画板（mission-panel / sheet-v2 通过 socket 收到）
  fireDiceRoll(
    deps.web,
    session,
    `${r.trigger} ${r.aptName}`,
    `${r.successes}个3`,
    r.burnedDice,
    'check',
  )

  const md = renderRollResult(r)
  const buttons = renderRollButtons(r)
  await reply(session, deps, md, buttons)
}

interface RollResult {
  trigger: Trigger
  aptName: string
  aptValue: number
  rawDice: number[]
  rawTriple: boolean
  burnout: number
  burnedDice: number[]
  unconsumed: number
  successes: number
  chaos: number
  chaosPool: number
  failureCount: number
  failureIncremented: boolean
  fcBefore: number
  zeroPenalty: number
  isReality: boolean
  isMember: boolean
}

export function formatDice(dice: readonly number[]): string {
  return dice.join(' · ')
}

/** 九宫格资质按钮（3x3），每个 callback 触发对应触发器 + 资质的骰点。*/
function buildAptitudeGrid(trigger: Trigger): QQButton[][] {
  const rows: QQButton[][] = []
  for (let i = 0; i < APTITUDE_NAMES.length; i += 3) {
    rows.push(
      APTITUDE_NAMES.slice(i, i + 3).map((name) => ({
        label: name,
        data: `/${trigger} ${name}`,
        type: 'input' as const,
        enter: true,
      })),
    )
  }
  return rows
}

/**
 * Web 资质格式 → Bot 资质格式。
 * Web: \{ "专注": \{ v: "8/10", current: 8, max: 10, m: [...] \} \}
 * Bot: \{ "专注": 8 \}
 */
function mapWebAttrsToAptitudes(
  attrs: Record<string, unknown>,
): Record<string, number> {
  const result: Record<string, number> = {}
  for (const [name, entry] of Object.entries(attrs)) {
    if (!APTITUDE_SET.has(name)) continue
    if (typeof entry === 'object' && entry !== null && 'current' in entry) {
      const cur = (entry as { current: unknown }).current
      if (typeof cur === 'number') result[name] = cur
      else if (typeof cur === 'string') result[name] = Number.parseInt(cur, 10) || 0
    } else if (typeof entry === 'number') {
      result[name] = entry
    }
  }
  return result
}

function renderRollResult(r: RollResult): string {
  const lines: string[] = []
  lines.push(`# ${r.trigger} · ${r.aptName}`)
  if (!r.isMember) {
    lines.push('')
    lines.push('> 观察模式：本次骰点不影响混沌池 / 失败计数')
  }
  lines.push('')
  lines.push(`资质值　**${r.aptValue}**`)
  lines.push('')
  lines.push(`原始骰　**${formatDice(r.rawDice)}**`)

  if (r.burnout > 0 || r.isReality) {
    const parts: string[] = []
    if (r.isReality) parts.push(`失败计数 ${r.fcBefore}`)
    parts.push(`资质补正 ${r.zeroPenalty}`)
    lines.push(`燃尽　**${r.burnout}**（${parts.join(' + ')}）`)
  }

  if (r.burnout > 0) {
    const converted = r.burnout - r.unconsumed
    lines.push(`燃尽后　**${formatDice(r.burnedDice)}**（转换 ${converted} 个 3）`)
  }

  lines.push('')
  lines.push(`成功数　**${r.successes}**`)

  if (r.rawTriple) {
    lines.push('本次混沌　**0**　★ 三重升华 ★')
  } else if (countSuccesses(r.burnedDice) === 3) {
    lines.push('本次混沌　**0**（燃尽后恰好 3 个 3）')
  } else {
    const detail: string[] = [`${countNonSuccesses(r.burnedDice)} 非 3`]
    if (r.unconsumed > 0) detail.push(`${r.unconsumed} 未消耗燃尽`)
    lines.push(`本次混沌　**+${r.chaos}**（${detail.join(' + ')}）`)
  }

  if (r.isMember) {
    lines.push(`混沌池　**${r.chaosPool}**（+${r.chaos}）`)
  } else {
    lines.push(`混沌池　**${r.chaosPool}**（无变动）`)
  }

  if (r.isReality && r.isMember) {
    lines.push('')
    if (r.failureIncremented) {
      lines.push(`> 判定：**失败**，失败计数 +1（当前 ${r.failureCount}）`)
    } else {
      lines.push('> 判定：**成功**')
    }
  } else if (r.isReality) {
    lines.push('')
    lines.push(r.successes > 0 ? '> 判定：**成功**（观察模式）' : '> 判定：**失败**（观察模式，不计入）')
  }

  return lines.join('\n')
}

function renderRollButtons(r: RollResult): QQButton[][] {
  return [
    [
      { label: '增加成功 1', data: '/增加成功 1', primary: true, type: 'input', enter: true },
      { label: '减少成功 1', data: '/减少成功 1', type: 'input', enter: true },
    ],
    [
      { label: '撤回骰点', data: '/撤回骰点', type: 'input', enter: true },
      {
        label: `再投 ${r.trigger} ${r.aptName}`,
        data: `/${r.trigger} ${r.aptName}`,
        type: 'input',
        enter: true,
      },
    ],
  ]
}

async function reply(
  session: import('koishi').Session,
  deps: RollDeps,
  content: string,
  buttons?: QQButton[][],
): Promise<void> {
  await sendQQMarkdown(session, content, {
    enabled: deps.useMarkdown,
    buttons,
  })
}
