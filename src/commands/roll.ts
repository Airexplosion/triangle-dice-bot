import type { Context } from 'koishi'
import { APTITUDE_NAMES, APTITUDE_SET } from '../const'
import { calculateChaos, isTripleSublimation, isUnleashActivated } from '../game/chaos'
import {
  applyBurnout,
  countNonSuccesses,
  countSuccesses,
  d6ChaosCount,
  d6ThreeCount,
  d10ChaosCount,
  d10ThreeCount,
  isD10Failure,
  roll6d4,
  rollD6,
  rollD10,
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

/** 该 QQ 用户绑定的角色解锁了哪些"额外骰"高墙。
 *  web 不可用 / 未绑卡 / 网络失败 → 一律全 false（安静降级，不打扰用户）。 */
async function getDiceUnlocks(
  ctx: Context,
  deps: RollDeps,
  session: import('koishi').Session,
): Promise<{ u2: boolean; n1: boolean }> {
  if (!deps.web || !session.userId) return { u2: false, n1: false }
  try {
    const groupId = session.isDirect ? undefined : rawRoomIdOf(session) ?? undefined
    const r = await deps.web.getCharacterHighWalls(session.userId, groupId)
    if (!r?.success || !r.highWalls) return { u2: false, n1: false }
    const codes = new Set(r.highWalls.map((w) => fileCode(w.filename)))
    return { u2: codes.has('U2'), n1: codes.has('N1') }
  } catch (e) {
    ctx.logger('triangle').warn('getDiceUnlocks failed: %s', (e as Error).message ?? e)
    return { u2: false, n1: false }
  }
}

/**
 * diceMode 解析：
 *   'd4'           — 6 颗 d4（默认/不带额外骰）
 *   'd6'           — 6 颗 d4 + 1 颗 d6
 *   'd10'          — 仅 1 颗 d10（取代 6D4）
 *   'd10d6'        — 1 颗 d10 + 1 颗 d6（取代 6D4）
 *   'nod6'         — 旧 alias，同 'd4'（避免破坏 U2 早期发出的按钮）
 *   其它 / 未给    — 调用方负责决定要不要弹选项面板
 */
const EXPLICIT_DICE_MODES = new Set(['d4', 'd6', 'd10', 'd10d6', 'nod6'])
interface DiceChoice {
  useD6: boolean
  useD10: boolean
}
function parseDiceMode(mode: string | undefined): DiceChoice | null {
  if (!mode || !EXPLICIT_DICE_MODES.has(mode)) return null
  return {
    useD6: mode === 'd6' || mode === 'd10d6',
    useD10: mode === 'd10' || mode === 'd10d6',
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
    .command('异常能力 <aptitude:string> [diceMode:string]', '使用异常能力触发骰点')
    .action(async ({ session }, aptitude, diceMode) => {
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
      // diceMode 已显式给出 → 直接走骰
      const explicit = parseDiceMode(diceMode)
      if (explicit) {
        return handle(ctx, deps, session, '异常能力', aptitude, explicit)
      }
      // 否则按 U2 / N1 解锁状态弹"选骰面板"
      if (aptitude && APTITUDE_SET.has(aptitude) && !session.isDirect) {
        const unlocks = await getDiceUnlocks(ctx, deps, session)
        if (unlocks.u2 || unlocks.n1) {
          await replyDiceChoicePanel(session, deps, aptitude, unlocks)
          return
        }
      }
      return handle(ctx, deps, session, '异常能力', aptitude, { useD6: false, useD10: false })
    })
}

/**
 * 弹"骰子选择面板"。根据解锁情况显示不同组合的按钮：
 *   - 仅 U2 → [用 6 面骰] [不用]                （兼容之前 UX）
 *   - 仅 N1 → [用 10 面骰] [不用]
 *   - 都解锁 → 四按钮二乘二网格：[仅 d4] [+ d6] / [d10] [d10 + d6]
 */
async function replyDiceChoicePanel(
  session: import('koishi').Session,
  deps: RollDeps,
  aptitude: string,
  unlocks: { u2: boolean; n1: boolean },
): Promise<void> {
  const cmd = (mode: string) => `/异常能力 ${aptitude} ${mode}`
  const head = [`# 异常能力 · ${aptitude}`]
  const buttons: QQButton[][] = []

  if (unlocks.u2 && unlocks.n1) {
    head.push('', '> 你已解锁 **N1 · 十面骰** 与 **U2 · 规则破坏者**')
    head.push('选择本次投骰使用的骰子组合：')
    head.push('')
    head.push('> d4：6 颗四面骰（原版）')
    head.push('> + d6：6 颗 d4 加 1 颗 d6')
    head.push('> d10：1 颗 d10 代替 6 颗 d4')
    head.push('> d10+d6：d10 + 1 颗 d6')
    buttons.push([
      { label: '仅 d4', data: cmd('d4'), type: 'input', enter: true },
      { label: '+ d6', data: cmd('d6'), type: 'input', enter: true },
    ])
    buttons.push([
      { label: 'd10', data: cmd('d10'), primary: true, type: 'input', enter: true },
      { label: 'd10 + d6', data: cmd('d10d6'), primary: true, type: 'input', enter: true },
    ])
  } else if (unlocks.n1) {
    head.push('', '> 你已解锁 **N1 · 十面骰**')
    head.push('本次投骰是否用 **10 面骰**（取代 6 颗 d4）？')
    head.push('')
    head.push('> N 面 → N 个 3 + N 点混沌　3 = 直接失败，禁三重升华')
    buttons.push([
      { label: '用 10 面骰', data: cmd('d10'), primary: true, type: 'input', enter: true },
      { label: '不用', data: cmd('d4'), type: 'input', enter: true },
    ])
  } else {
    // 仅 U2
    head.push('', '> 你已解锁 **U2 · 规则破坏者**')
    head.push('本次投骰是否加入额外的 **6 面骰**？')
    head.push('')
    head.push('> 1/2/4/5 → +1 混沌　3 → 算 1 个 3　6 → 算 2 个 3')
    buttons.push([
      { label: '用 6 面骰', data: cmd('d6'), primary: true, type: 'input', enter: true },
      { label: '不用', data: cmd('d4'), type: 'input', enter: true },
    ])
  }
  await reply(session, deps, head.join('\n'), buttons)
}

type Trigger = '现实修改' | '异常能力'

async function handle(
  ctx: Context,
  deps: RollDeps,
  session: import('koishi').Session | undefined,
  trigger: Trigger,
  aptName: string | undefined,
  /** 仅 trigger='异常能力' 时有意义。U2 / N1 解锁后由用户在面板上选择。 */
  diceChoice: DiceChoice = { useD6: false, useD10: false },
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

    // d6 / d10 仅在 异常能力 + 用户选择时摇
    const d6Roll: number | null =
      trigger === '异常能力' && diceChoice.useD6 ? rollD6() : null
    const d10Roll: number | null =
      trigger === '异常能力' && diceChoice.useD10 ? rollD10() : null
    const useD10 = d10Roll !== null
    const d10Failure = isD10Failure(d10Roll)

    let rawDice: number[]
    let burnedDice: number[]
    let unconsumed: number
    let rawTriple: boolean
    let successes: number
    let chaosCalc: number
    let unleash: boolean
    // d10 模式下记录燃尽后剩多少个 3（用于显示）
    let d10ThreesAfterBurnout = 0

    if (useD10) {
      // ─── d10 模式：取代 6D4 ───
      // 规则：d10 创造 N 个 3 + N 点混沌；d10=3 直接失败；不可达成三重升华；
      //       燃尽像通常一样减少 3 数并增加混沌（最终：d10 混沌 = d10 面值 + 燃尽量）
      rawDice = []
      burnedDice = []
      rawTriple = false
      const d10ThreesRaw = d10ThreeCount(d10Roll) // d10=3 → 0
      const consumed = Math.min(burnout, d10ThreesRaw)
      d10ThreesAfterBurnout = d10ThreesRaw - consumed
      unconsumed = burnout - consumed
      // 失败覆盖：d10=3 → 任何其他骰子结果都视为 0 成功
      successes = d10Failure ? 0 : d10ThreesAfterBurnout + d6ThreeCount(d6Roll)
      // 混沌：d10 面值 + 燃尽全量 + d6 混沌
      chaosCalc = d10ChaosCount(d10Roll) + burnout + d6ChaosCount(d6Roll)
      unleash = isUnleashActivated(rawDice, d6Roll, d10Roll)
    } else {
      // ─── 常规模式：6D4 (+ d6) ───
      rawDice = roll6d4()
      rawTriple = isTripleSublimation(rawDice, d6Roll)
      const burned = applyBurnout(rawDice, burnout)
      burnedDice = burned.dice
      unconsumed = burned.unconsumed
      successes = countSuccesses(burned.dice) + d6ThreeCount(d6Roll)
      chaosCalc = rawTriple
        ? 0
        : calculateChaos(burned.dice, burned.unconsumed, d6Roll)
      unleash = isUnleashActivated(rawDice, d6Roll, null)
    }

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
      currentDice: useD10 ? [] : [...burnedDice],
      chaosApplied,
      failureIncremented,
      unconsumedBurnout: unconsumed,
      createdAt: Date.now(),
      consumedAptitudes: {},
      d6Roll,
      d10Roll,
    }
    deps.pending.set(roomId, playerId, pendingRoll)

    result = {
      trigger,
      aptName,
      aptValue,
      rawDice,
      rawTriple,
      burnout,
      burnedDice,
      unconsumed,
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
      d10Roll,
      d10ThreesAfterBurnout,
      d10Failure,
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
  /** d10 模式下为 [] */
  rawDice: number[]
  /** d4 模式：raw 即 3 个 3；d10 模式恒为 false */
  rawTriple: boolean
  burnout: number
  /** d10 模式下为 [] */
  burnedDice: number[]
  unconsumed: number
  /** d4 / d6 / d10 综合后的总成功数（已扣 d10=3 失败 override） */
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
  /** "无名"骰：null = 未投，1-10 = 本次摇出的 d10 */
  d10Roll: number | null
  /** d10 模式燃尽后剩多少个 3（仅 d10 模式有意义） */
  d10ThreesAfterBurnout: number
  /** d10=3 强制失败 */
  d10Failure: boolean
  /** UNL3ASH：原始（d4 + d6 + d10）总 3 数 ≥ 7，在任何后修改前判定 */
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
  // 三重升华专属横幅图：标题正下方（d10 模式不可三重升华，rawTriple 恒 false，自然不显示）
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

  if (r.d10Roll !== null) {
    // ─── d10 模式渲染 ───
    if (r.d10Failure) {
      lines.push(`10 面骰　**${r.d10Roll}**　★ 直接失败 ★（+3 混沌）`)
    } else {
      const n = d10ThreeCount(r.d10Roll)
      lines.push(`10 面骰　**${r.d10Roll}**（${n} 个 3 + ${d10ChaosCount(r.d10Roll)} 混沌）`)
    }
    if (r.d6Roll !== null) {
      lines.push(renderD6Line(r.d6Roll))
    }
    if (r.burnout > 0) {
      const parts: string[] = []
      if (r.isReality) parts.push(`失败计数 ${r.fcBefore}`)
      parts.push(`资质补正 ${r.zeroPenalty}`)
      lines.push(`燃尽　**${r.burnout}**（${parts.join(' + ')}）`)
      const consumed = r.burnout - r.unconsumed
      if (!r.d10Failure && consumed > 0) {
        lines.push(`燃尽后 10 面骰　**${r.d10ThreesAfterBurnout} 个 3**（转换 ${consumed} 个 3）`)
      } else if (r.unconsumed > 0) {
        lines.push(`未消耗燃尽 **${r.unconsumed}** → +${r.unconsumed} 混沌`)
      }
    }
    lines.push('')
    lines.push(`成功数　**${r.successes}**`)
    const chaosParts: string[] = [`10 面骰 ${d10ChaosCount(r.d10Roll)}`]
    if (r.burnout > 0) chaosParts.push(`燃尽 ${r.burnout}`)
    const d6Chaos = d6ChaosCount(r.d6Roll)
    if (d6Chaos > 0) chaosParts.push(`6 面骰 +${d6Chaos}`)
    lines.push(`本次混沌　**+${r.chaos}**（${chaosParts.join(' + ')}）`)
  } else {
    // ─── 6D4 (+ d6) 模式渲染 ───
    lines.push(`原始骰　**${formatDice(r.rawDice)}**`)
    if (r.d6Roll !== null) lines.push(renderD6Line(r.d6Roll))

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
  }

  if (r.unleash) {
    lines.push('')
    lines.push('> ★★★ **UNL3ASH 已激活** ★★★')
    lines.push('> 一次掷骰中恰好掷出 7 个 3，触发 UNL3ASH。具体效果以经理处置。')
  }

  if (r.isMember) {
    lines.push(`混沌池　**${r.chaosPool}**（+${r.chaos}）`)
  } else {
    lines.push(`混沌池　**${r.chaosPool}**（无变动）`)
  }

  if (r.d10Failure) {
    lines.push('')
    lines.push('> 判定：**失败**（d10=3 强制失败）')
  } else if (r.isReality && r.isMember) {
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

function renderD6Line(d6: number): string {
  const add = d6ThreeCount(d6)
  if (add === 2) return `6 面骰　**${d6}**（算 2 个 3）`
  if (add === 1) return `6 面骰　**${d6}**（算 1 个 3）`
  return `6 面骰　**${d6}**（+${d6ChaosCount(d6)} 混沌）`
}

function renderRollButtons(r: RollResult): QQButton[][] {
  // d10 模式没有 d4 池，"增/减成功"按钮不适用，只留撤回 + 再投
  if (r.d10Roll !== null) {
    return [
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
