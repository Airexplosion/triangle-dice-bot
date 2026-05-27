import type { Context } from 'koishi'
import { APTITUDE_NAMES, APTITUDE_SET } from '../const'
import { calculateChaos, isTripleSublimation, isUnleashActivated } from '../game/chaos'
import {
  applyBurnout,
  countNonSuccesses,
  countSuccesses,
  d6ChaosCount,
  d6ThreeCount,
  roll6d4,
  rollD6,
} from '../game/dice'
import { rawRoomIdOf, roomIdOf } from '../room'
import type { PendingRoll } from '../types'
import { sendQQMarkdown, type QQButton } from '../util/qq-markdown'
import { getOrCreatePlayer, type RoomStore } from '../service/store'
import type { PendingRollStore } from '../service/pending'
import { fireDiceRoll, fireSyncChaos, fireSyncFailure, syncFromWeb } from '../service/sync'
import type { WebClient } from '../service/web-client'
import { isMissionMember } from '../util/mission'

/** 从高墙文件名提取代码前缀，匹配 web 端 getFileCode：
 *    "U2.md" → "U2"，"U2 规则破坏者.md" → "U2"，大小写归一。 */
function fileCode(filename: string): string {
  return filename.replace(/\.md$/i, '').split(' ')[0].toUpperCase()
}

/** 该 QQ 用户绑定的角色是否解锁了 U2（规则破坏者，d6 异常能力骰）。
 *  web 不可用 / 未绑卡 / 网络失败 → 一律 false（安静降级，不打扰用户）。 */
async function isU2Unlocked(
  ctx: Context,
  deps: RollDeps,
  session: import('koishi').Session,
): Promise<boolean> {
  if (!deps.web || !session.userId) return false
  try {
    const groupId = session.isDirect ? undefined : rawRoomIdOf(session) ?? undefined
    const r = await deps.web.getCharacterHighWalls(session.userId, groupId)
    if (!r?.success || !r.highWalls) return false
    return r.highWalls.some((w) => fileCode(w.filename) === 'U2')
  } catch (e) {
    ctx.logger('triangle').warn('isU2Unlocked failed: %s', (e as Error).message ?? e)
    return false
  }
}

export interface RollDeps {
  rooms: RoomStore
  pending: PendingRollStore
  web: WebClient | null
  useMarkdown: boolean
}

/** 三重升华专属横幅图（横向 banner 版，725x182，~4:1）*/
const TRIPLE_SUBLIMATION_IMG =
  'https://tr.kaigua.vip/assets/images/triple-sublimation-banner.png'

export function registerRollCommands(ctx: Context, deps: RollDeps): void {
  ctx
    .command('现实修改 <aptitude:string>', '使用现实修改触发骰点')
    .action(async ({ session }, aptitude) => handle(ctx, deps, session, '现实修改', aptitude))

  ctx
    .command('异常能力 <aptitude:string> [d6mode:string]', '使用异常能力触发骰点')
    .action(async ({ session }, aptitude, d6mode) => {
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
            buttons.push([{ label: '异常', data: '/异常能力 __GRID__', type: 'input', enter: true }])
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
      // d6mode：'d6' = 加 6 面骰，'nod6' = 显式不用（跳过提示），其它/缺省 = 看 U2 解锁状态决定
      let useD6 = d6mode === 'd6'
      const explicitD6 = d6mode === 'd6' || d6mode === 'nod6'
      if (aptitude && APTITUDE_SET.has(aptitude) && !explicitD6 && !session.isDirect) {
        if (await isU2Unlocked(ctx, deps, session)) {
          await reply(
            session,
            deps,
            [
              `# 异常能力 · ${aptitude}`,
              '',
              '> 你已解锁 **U2 · 规则破坏者**',
              '本次投骰是否加入额外的 **6 面骰**？',
              '',
              '> 1/2/4/5 → +1 混沌　3 → 算 1 个 3　6 → 算 2 个 3',
            ].join('\n'),
            [
              [
                { label: '用 6 面骰', data: `/异常能力 ${aptitude} d6`, primary: true, type: 'input', enter: true },
                { label: '不用', data: `/异常能力 ${aptitude} nod6`, type: 'input', enter: true },
              ],
            ],
          )
          return
        }
      }
      return handle(ctx, deps, session, '异常能力', aptitude, useD6)
    })
}

type Trigger = '现实修改' | '异常能力'

async function handle(
  ctx: Context,
  deps: RollDeps,
  session: import('koishi').Session | undefined,
  trigger: Trigger,
  aptName: string | undefined,
  /** 仅 trigger='异常能力' 时有意义。U2 解锁后用户选择是否加 d6。*/
  useD6: boolean = false,
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
    // d6（规则破坏者）：仅 异常能力 + U2 解锁 + 用户选择"用 6 面骰"时摇
    const d6Roll: number | null = trigger === '异常能力' && useD6 ? rollD6() : null
    const rawTriple = isTripleSublimation(rawDice, d6Roll)
    const unleash = isUnleashActivated(rawDice, d6Roll)
    const burned = applyBurnout(rawDice, burnout)
    // 显示 / 业务用的总成功数 = d4 成功 + d6 等效 3 数贡献
    const successes = countSuccesses(burned.dice) + d6ThreeCount(d6Roll)

    const chaosCalc = rawTriple
      ? 0
      : calculateChaos(burned.dice, burned.unconsumed, d6Roll)
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
      d6Roll,
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
      d6Roll,
      unleash,
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
  /** d4 成功数 + d6 等效 3 数贡献（已含 d6） */
  successes: number
  chaos: number
  chaosPool: number
  failureCount: number
  failureIncremented: boolean
  fcBefore: number
  zeroPenalty: number
  isReality: boolean
  isMember: boolean
  /** 规则破坏者：null = 未投，1-6 = 本次摇出的 d6 */
  d6Roll: number | null
  /** UNL3ASH：原始（d4 + d6）总 3 数 ≥ 7，在任何后修改前判定 */
  unleash: boolean
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
  // 三重升华专属横幅图：标题正下方
  if (r.rawTriple) {
    lines.push('')
    lines.push(`![三重升华 #500px #126px](${TRIPLE_SUBLIMATION_IMG})`)
  }
  if (!r.isMember) {
    lines.push('')
    lines.push('> 观察模式：本次骰点不影响混沌池 / 失败计数')
  }
  lines.push('')
  lines.push(`资质值　**${r.aptValue}**`)
  lines.push('')
  lines.push(`原始骰　**${formatDice(r.rawDice)}**`)
  if (r.d6Roll !== null) {
    const d6Add = d6ThreeCount(r.d6Roll)
    const d6Chaos = d6ChaosCount(r.d6Roll)
    let note: string
    if (d6Add === 2) note = '算 2 个 3'
    else if (d6Add === 1) note = '算 1 个 3'
    else note = `+${d6Chaos} 混沌`
    lines.push(`6 面骰　**${r.d6Roll}**（${note}）`)
  }

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
  } else if (r.chaos === 0) {
    lines.push('本次混沌　**0**（燃尽后达成三重升华）')
  } else {
    const detail: string[] = [`${countNonSuccesses(r.burnedDice)} 非 3`]
    if (r.unconsumed > 0) detail.push(`${r.unconsumed} 未消耗燃尽`)
    const d6Chaos = d6ChaosCount(r.d6Roll)
    if (d6Chaos > 0) detail.push(`6 面骰 +${d6Chaos}`)
    lines.push(`本次混沌　**+${r.chaos}**（${detail.join(' + ')}）`)
  }

  if (r.unleash) {
    lines.push('')
    lines.push('> ★★★ **UNL3ASH 已激活** ★★★')
    lines.push('> 一次掷骰中达成 7 个 3，触发 UNL3ASH。具体效果以经理处置。')
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
      { label: '成功+1', data: '/增加成功 1', primary: true, type: 'input', enter: true },
      { label: '成功-1', data: '/减少成功 1', type: 'input', enter: true },
    ],
    [
      { label: '撤回', data: '/撤回骰点', type: 'input', enter: true },
      {
        label: `再投 ${r.aptName}`,
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
