import type { Context } from 'koishi'
import { APTITUDE_NAMES, APTITUDE_SET } from '../const'
import { calculateChaos, isTripleSublimation } from '../game/chaos'
import {
  clampD8Delta,
  countNonSuccesses,
  countSuccesses,
  d6ChaosCount,
  d6ThreeCount,
  d8ThreeCount,
  d10ChaosCount,
  d10ThreeCount,
  isD10Failure,
} from '../game/dice'
import { rawRoomIdOf, roomIdOf } from '../room'
import type { PendingRollStore } from '../service/pending'
import { getOrCreatePlayer, type RoomStore } from '../service/store'
import {
  fireConsumeAptitude,
  fireDiceRoll,
  fireSetAptitudes,
  fireSyncChaos,
  fireSyncFailure,
  syncFromWeb,
} from '../service/sync'
import type { WebClient } from '../service/web-client'
import { isMissionMember } from '../util/mission'
import { sendQQMarkdown, type QQButton } from '../util/qq-markdown'
import {
  d8DeltaButtonRows,
  d8DeltaCommandToken,
  d8DeltaOptions,
  formatDice,
  labelD8Delta,
  TRIPLE_SUBLIMATION_IMG,
} from './roll'

export interface PostRollDeps {
  rooms: RoomStore
  pending: PendingRollStore
  web: WebClient | null
  useMarkdown: boolean
}

const NON_THREE = [1, 2, 4]

/**
 * 统一判定本次骰点是否三重升华（含 d8 原始路径）。
 * 两条路径任一成立即升华：
 *   1) 燃尽后判定：currentDice 3 数 + d6 + d8Delta === 3（既有语义，含燃尽后凑成）
 *   2) d8 原始路径：仅 d8 在场时，原始 6D4 的 3 数 + d6 + d8Delta === 3（绕过燃尽）
 * 第 2 条用 d8Roll 守卫，保证无 d8 流程行为完全不变。
 */
function isTripleWithRaw(
  pending: import('../types').PendingRoll,
  dice: readonly number[],
  d8Delta: number,
): boolean {
  if (isTripleSublimation(dice, pending.d6Roll, d8Delta)) return true
  if (pending.d8Roll !== null) {
    return pending.rawThreeCount + d6ThreeCount(pending.d6Roll) + d8Delta === 3
  }
  return false
}

export function registerPostRollCommands(ctx: Context, deps: PostRollDeps): void {
  ctx
    .command('增加成功 <count:posint>', '骰后修改：增加成功（消耗资质）')
    .action(async ({ session }, count) =>
      handle(deps, session, '增加成功', count),
    )

  ctx
    .command('减少成功 <count:posint>', '骰后修改：减少成功（消耗资质）')
    .action(async ({ session }, count) =>
      handle(deps, session, '减少成功', count),
    )

  ctx
    .command('撤回骰点', '撤销本次骰点的混沌 / 失败计数 / 资质消耗')
    .action(async ({ session }) => handleUndo(deps, session))

  // ─── d8 (赞助骰) 精确增量：/d8 <delta>（加2/加1/忽略/减1/减2，自动 clamp）───
  ctx
    .command('d8 <delta:string>', '骰后：设置 d8 的 3 数增量（如 /d8 加1、/d8 减2）')
    .action(async ({ session }, delta) => handleD8Delta(deps, session, delta))

  // ─── d10 调整（±1，花 1 QA 或 3 申诫；向导）───
  ctx
    .command('d10调 [dir:string] [cost:string]', '骰后：花 1 资质 或 3 申诫调整 d10 ±1')
    .action(async ({ session }, dir, cost) =>
      handleDieAdjust(deps, session, 'd10', dir, cost),
    )
  // ─── d6 调整（设任意点数，花 1 QA / 1 任意资质 / 3 申诫；向导）───
  ctx
    .command('d6调 [val:string] [cost:string] [anyApt:string]', '骰后：花 1 资质 或 3 申诫把 d6 设成任意点数')
    .action(async ({ session }, val, cost, anyApt) =>
      handleDieAdjust(deps, session, 'd6', val, cost, anyApt),
    )
}

/** 异常能力（d6/d10）骰点调整后的成功数 + 混沌重算（三重升华/UNL3ASH 冻结 roll-time）。 */
function recomputeAnomaly(
  pending: import('../types').PendingRoll,
): { success: number; chaos: number } {
  const d6 = pending.d6Roll
  if (pending.d10Roll !== null) {
    const d10 = pending.d10Roll
    const d10Threes = d10ThreeCount(d10)
    const consumed = Math.min(pending.burnout, d10Threes)
    const after = d10Threes - consumed
    const success = isD10Failure(d10) ? 0 : after + d6ThreeCount(d6)
    const chaos = d10ChaosCount(d10) + pending.burnout + d6ChaosCount(d6)
    return { success, chaos }
  }
  // d6 模式（6D4 + d6）：三重升华冻结，故 chaos 不因新三连归零
  const success = countSuccesses(pending.currentDice) + d6ThreeCount(d6)
  const chaos = pending.lockedTriple
    ? 0
    : countNonSuccesses(pending.currentDice) + pending.unconsumedBurnout + d6ChaosCount(d6)
  return { success, chaos }
}

const COST_LABEL: Record<string, string> = {
  qa: '1 资质',
  anyqa: '1 任意资质',
  申诫: '3 申诫',
}

/**
 * d6/d10 调整向导 + 执行。
 *   d10：dir ∈ {+1,-1}，±1（[1,10] 截断，10/1 不环绕；d10=3 锁定不可调）
 *   d6 ：val ∈ {1..6}，设任意点数
 *   cost ∈ {qa, 申诫}；qa 扣该次骰点资质 1 点，申诫扣 3（网页插 -3 记录）
 * 仅重算成功数 + 混沌；三重升华 / UNL3ASH 冻结。异常能力无失败计数。
 */
async function handleDieAdjust(
  deps: PostRollDeps,
  session: import('koishi').Session | undefined,
  kind: 'd10' | 'd6',
  arg1: string | undefined,
  arg2: string | undefined,
  arg3?: string | undefined,
): Promise<void> {
  if (!session) return
  if (session.isDirect) return reply(session, deps, '> 私聊不支持骰点命令。')
  const roomId = roomIdOf(session)
  const rawRoomId = rawRoomIdOf(session)
  if (!roomId || !rawRoomId) return reply(session, deps, '> 无法定位房间。')
  const playerId = session.userId ?? 'unknown'

  const pending = deps.pending.get(roomId, playerId)
  if (!pending) {
    return reply(session, deps, '> 没有待修改的骰点结果（已过期或未骰点）。')
  }
  if (kind === 'd10' && pending.d10Roll === null) {
    return reply(session, deps, '> 本次骰点未使用 d10。')
  }
  if (kind === 'd6' && pending.d6Roll === null) {
    return reply(session, deps, '> 本次骰点未使用 d6。')
  }
  // 仅「掷出」的 3 锁定不可调整；调整出来的 3（如 4→3）仍可继续调（开发者点 3）
  if (kind === 'd10' && pending.d10Original === 3) {
    return reply(session, deps, '> d10 掷出的 3 为强制失败，规则上不可调整。')
  }

  // ── 解析 target ──
  // 注意：方向用「加 / 减」而非「+1 / -1」，因为 Koishi 把 -1 当成选项标志、解析不到位置参数。
  let target: number | null = null
  if (kind === 'd10') {
    const cur = pending.d10Roll!
    if (arg1 === '加' || arg1 === '1' || arg1 === '+1') target = Math.min(10, cur + 1)
    else if (arg1 === '减') target = Math.max(1, cur - 1)
  } else {
    const v = Number.parseInt(arg1 ?? '', 10)
    if (v >= 1 && v <= 6) target = v
  }

  // ── 向导步骤 1：选方向 / 点数 ──
  if (target === null) {
    if (kind === 'd10') {
      await reply(
        session,
        deps,
        [
          `# 调整 d10（当前 **${pending.d10Roll}**）`,
          '',
          '每次 ±1（10 与 1 不相连）。选方向 + 支付方式：',
        ].join('\n'),
        [
          [
            { label: '+1（耗1资质）', data: '/d10调 加 qa', primary: true, type: 'input', enter: true },
            { label: '−1（耗1资质）', data: '/d10调 减 qa', type: 'input', enter: true },
          ],
          [
            { label: '+1（耗3申诫）', data: '/d10调 加 申诫', type: 'input', enter: true },
            { label: '−1（耗3申诫）', data: '/d10调 减 申诫', type: 'input', enter: true },
          ],
        ],
      )
    } else {
      const grid: QQButton[][] = []
      for (let i = 1; i <= 6; i += 3) {
        grid.push(
          [i, i + 1, i + 2].map((v) => ({
            label: String(v),
            data: `/d6调 ${v}`,
            primary: v === pending.d6Roll,
            type: 'input' as const,
            enter: true,
          })),
        )
      }
      await reply(
        session,
        deps,
        [
          `# 设定 d6（当前 **${pending.d6Roll}**）`,
          '',
          '选择目标点数（花 1 资质 或 3 申诫）：',
          '> 3 → 1 个 3；6 → 2 个 3；其余 → +1 混沌',
        ].join('\n'),
        grid,
      )
    }
    return
  }

  // ── 向导步骤 2：选支付方式 ──
  //   qa    = 扣该次骰点相关资质（开发者点 4 默认）
  //   anyqa = 扣自选资质 1 点（仅 d6，需 arg3 指定资质）
  //   申诫  = 扣 3 申诫
  const cost = arg2
  if (cost !== 'qa' && cost !== '申诫' && cost !== 'anyqa') {
    const base = kind === 'd10' ? `/d10调 ${arg1}` : `/d6调 ${target}`
    const row1: QQButton[] = [
      { label: '耗 1 本项资质', data: `${base} qa`, primary: true, type: 'input', enter: true },
    ]
    // 「用 1 任意资质」仅 d6 支持（d6调 命令带第三参；d10调 不带）
    if (kind === 'd6') {
      row1.push({ label: '耗 1 任意资质', data: `${base} anyqa`, type: 'input', enter: true })
    }
    await reply(
      session,
      deps,
      [
        `# ${kind === 'd10' ? `d10 → ${target}` : `d6 → ${target}`}`,
        '',
        `加值资质：**${pending.aptitudeName}**`,
        '选择支付方式：',
      ].join('\n'),
      [
        row1,
        [
          { label: '耗 3 申诫', data: `${base} 申诫`, type: 'input', enter: true },
          { label: kind === 'd10' ? '重选方向' : '重选点数', data: kind === 'd10' ? '/d10调' : '/d6调', type: 'input', enter: true },
        ],
      ],
    )
    return
  }

  // ── anyqa：未给资质 → 弹九宫格选要消耗的资质 ──
  let payApt = pending.aptitudeName // qa 默认相关资质
  if (cost === 'anyqa') {
    const chosen = arg3
    if (!chosen || !APTITUDE_SET.has(chosen)) {
      const base = `/d6调 ${target} anyqa`
      const grid: QQButton[][] = []
      for (let i = 0; i < APTITUDE_NAMES.length; i += 3) {
        grid.push(
          APTITUDE_NAMES.slice(i, i + 3).map((name) => ({
            label: name,
            data: `${base} ${name}`,
            type: 'input' as const,
            enter: true,
          })),
        )
      }
      await reply(
        session,
        deps,
        [`# d6 → ${target}`, '', '选择要消耗 1 点的资质：'].join('\n'),
        grid,
      )
      return
    }
    payApt = chosen
  }

  // ── 申诫支付：先 await 扣减（校验余额）──
  if (cost === '申诫') {
    if (!deps.web) {
      return reply(session, deps, '> 未配置角色卡服务，无法用申诫支付。')
    }
    const groupId = rawRoomIdOf(session) ?? null
    const r = await deps.web.spendReprimands(playerId, groupId, 3, `${kind} 调整`)
    if (!r) return reply(session, deps, '> 暂时无法连接角色卡，申诫扣减失败。')
    if (!r.success) return reply(session, deps, `> ${r.error ?? '申诫不足'}`)
  }

  let outcome: DieAdjustOutcome | string | null = null

  await deps.rooms.update(roomId, session.platform, rawRoomId, (room) => {
    const player = getOrCreatePlayer(room, playerId)
    // QA 支付（qa = 相关资质；anyqa = 自选资质）
    if (cost === 'qa' || cost === 'anyqa') {
      const curQa = player.aptitudes[payApt] ?? 0
      if (curQa < 1) {
        outcome = `> 资质 **${payApt}** 不足（当前 ${curQa}，需要 1）。`
        return
      }
      player.aptitudes[payApt] = curQa - 1
      pending.consumedAptitudes[payApt] = (pending.consumedAptitudes[payApt] ?? 0) + 1
    } else {
      pending.consumedReprimands += 3
    }

    const oldChaos = pending.chaosApplied
    const oldVal = kind === 'd10' ? pending.d10Roll! : pending.d6Roll!
    if (kind === 'd10') pending.d10Roll = target
    else pending.d6Roll = target

    const { success, chaos } = recomputeAnomaly(pending)
    const isMember = isMissionMember(room, playerId)
    const chaosDiff = isMember ? chaos - oldChaos : 0
    if (isMember) room.chaosPool = Math.max(0, room.chaosPool + chaosDiff)
    pending.chaosApplied = isMember ? chaos : 0

    outcome = {
      kind,
      oldVal,
      newVal: target!,
      cost,
      success,
      chaos,
      chaosDiff,
      chaosPool: room.chaosPool,
      isMember,
      aptName: payApt,
      aptAfter: player.aptitudes[payApt] ?? 0,
    }
  })

  if (typeof outcome === 'string') {
    // QA 不足：若已扣申诫需回滚（这里 cost 必为 qa，故无需回滚申诫）
    return reply(session, deps, outcome)
  }
  if (!outcome) return
  const o = outcome as DieAdjustOutcome

  // web 同步：QA 消耗 + 混沌差值
  if (o.cost === 'qa') fireConsumeAptitude(deps.web, session, o.aptName, 1)
  if (o.isMember && o.chaosDiff !== 0) {
    fireSyncChaos(deps.web, session, o.chaosDiff, `${o.kind} 调整`)
  }

  // 调整后保留入口按钮，便于继续调整 d10 / 撤回
  // 只要原始掷骰不是 3，就可以继续调（哪怕当前被调成了 3）
  const btns: QQButton[][] = [rerollRow(pending)]
  if (o.kind === 'd10' && pending.d10Original !== 3) {
    btns.push([{ label: '继续调整 d10', data: '/d10调', type: 'input', enter: true }])
  }
  if (pending.d6Roll !== null && o.kind === 'd6') {
    btns.push([{ label: '继续调整 d6', data: '/d6调', type: 'input', enter: true }])
  }
  btns.push([{ label: '撤回本次骰点', data: '/撤回骰点', type: 'input', enter: true }])

  await reply(session, deps, renderDieAdjust(o), btns)
}

interface DieAdjustOutcome {
  kind: 'd10' | 'd6'
  oldVal: number
  newVal: number
  cost: 'qa' | 'anyqa' | '申诫'
  success: number
  chaos: number
  chaosDiff: number
  chaosPool: number
  isMember: boolean
  aptName: string
  aptAfter: number
}

function renderDieAdjust(o: DieAdjustOutcome): string {
  const lines: string[] = []
  const die = o.kind === 'd10' ? '10 面骰' : '6 面骰'
  lines.push(`# 调整 ${die}：${o.oldVal} → **${o.newVal}**`)
  lines.push('')
  lines.push(`支付　**${COST_LABEL[o.cost]}**`)
  if (o.cost === 'qa' || o.cost === 'anyqa') {
    lines.push(`资质 **${o.aptName}** 当前 **${o.aptAfter}**`)
  }
  lines.push('')
  lines.push(`成功数　**${o.success}**`)
  if (o.isMember) {
    const sign = o.chaosDiff >= 0 ? '+' : ''
    lines.push(`本次混沌　**${o.chaos}**（差值 ${sign}${o.chaosDiff}）`)
    lines.push(`混沌池　**${o.chaosPool}**`)
  } else {
    lines.push('> 观察模式：本次调整不影响混沌池')
  }
  lines.push('')
  lines.push('> 三重升华 / UNL3ASH 按掷骰时结果锁定，调整不影响')
  return lines.join('\n')
}

/**
 * 设置 d8 的"3 数增量"（带符号，自动 clamp 到 [-max,+max]）。
 * 重算总成功 / 混沌 / 现实修改失败标志（含三重升华），把差值写回房间池与 web。
 */
async function handleD8Delta(
  deps: PostRollDeps,
  session: import('koishi').Session | undefined,
  deltaArg: string | undefined,
): Promise<void> {
  if (!session) return
  if (session.isDirect) return reply(session, deps, '> 私聊不支持骰点命令。')

  const roomId = roomIdOf(session)
  const rawRoomId = rawRoomIdOf(session)
  if (!roomId || !rawRoomId) return reply(session, deps, '> 无法定位房间。')
  const playerId = session.userId ?? 'unknown'

  const pending = deps.pending.get(roomId, playerId)
  if (!pending) {
    return reply(session, deps, '> 没有待修改的骰点结果（已过期或未骰点）。')
  }
  if (pending.d8Roll === null) {
    return reply(session, deps, '> 本次骰点未使用 d8（赞助骰）。')
  }
  if (d8ThreeCount(pending.d8Roll) === 0) {
    return reply(
      session,
      deps,
      `> d8 = ${pending.d8Roll} 没有 3 可计入或减去（仅 d8 = 3 / 6 有效）。`,
    )
  }

  const requested = parseD8DeltaArg(deltaArg)
  if (requested === null) {
    const opts = d8DeltaOptions(pending.d8Roll).map((v) => `/d8 ${d8DeltaCommandToken(v)}`).join('　')
    return reply(session, deps, `> 用法：\`/d8 加N/减N/忽略\`\n> 可选：${opts}`)
  }
  const newDelta = clampD8Delta(pending.d8Roll, requested)

  if (pending.d8Delta === newDelta) {
    return reply(session, deps, `> d8 当前已是 **${labelD8Delta(newDelta)}**。`)
  }

  await syncFromWeb(deps.web, deps.rooms, session)

  let outcome: D8DeltaOutcome | null = null

  await deps.rooms.update(roomId, session.platform, rawRoomId, (room) => {
    const dice = pending.currentDice
    const oldDelta = pending.d8Delta
    const oldTriple = isTripleWithRaw(pending, dice, oldDelta)
    const oldSuccesses = oldTriple
      ? 3
      : countSuccesses(dice) + d6ThreeCount(pending.d6Roll) + oldDelta
    const oldChaos = pending.chaosApplied

    pending.d8Delta = newDelta

    const triple = isTripleWithRaw(pending, dice, newDelta)
    const newSuccesses = triple
      ? 3
      : countSuccesses(dice) + d6ThreeCount(pending.d6Roll) + newDelta
    const newChaos = triple
      ? 0
      : calculateChaos(dice, pending.unconsumedBurnout, pending.d6Roll, newDelta)
    const isMember = isMissionMember(room, playerId)
    const chaosDiff = isMember ? newChaos - oldChaos : 0

    if (isMember) {
      room.chaosPool = Math.max(0, room.chaosPool + chaosDiff)
    }

    let failureNote: string | null = null
    let failureDelta = 0
    if (pending.trigger === '现实修改' && isMember) {
      if (pending.failureIncremented && newSuccesses > 0) {
        room.failureCount = Math.max(0, room.failureCount - 1)
        pending.failureIncremented = false
        failureNote = '成功数恢复，撤销失败计数 +1'
        failureDelta = -1
      } else if (
        !pending.failureIncremented &&
        oldSuccesses > 0 &&
        newSuccesses === 0
      ) {
        room.failureCount += 1
        pending.failureIncremented = true
        failureNote = '成功数归零，失败计数 +1'
        failureDelta = 1
      }
    }

    pending.chaosApplied = isMember ? newChaos : 0

    outcome = {
      oldDelta,
      newDelta,
      d8Roll: pending.d8Roll!,
      dice: [...dice],
      triple,
      isMember,
      oldSuccesses,
      newSuccesses,
      oldChaos,
      newChaos,
      chaosDiff,
      chaosPool: room.chaosPool,
      failureNote,
      failureDelta,
      failureCount: room.failureCount,
    }
  })

  if (!outcome) return
  const o = outcome as D8DeltaOutcome

  // 同步 web：混沌差值 + 失败差值（仅 mission 成员）
  if (o.isMember) {
    if (o.chaosDiff !== 0) {
      fireSyncChaos(deps.web, session, o.chaosDiff, `d8 ${labelD8Delta(o.newDelta)}`)
    }
    if (o.failureDelta !== 0) {
      fireSyncFailure(deps.web, session, o.failureDelta)
    }
  }

  const btns: QQButton[][] = [rerollRow(pending)]
  const adjustRow: QQButton[] = [
    { label: '成功 +1', data: '/增加成功 1', type: 'input', enter: true },
    { label: '成功 -1', data: '/减少成功 1', type: 'input', enter: true },
  ]
  if (pending.d6Roll !== null) {
    adjustRow.push({ label: '调整 d6', data: '/d6调', type: 'input', enter: true })
  }
  btns.push(adjustRow)
  btns.push(...d8DeltaButtonRows(o.d8Roll, o.newDelta))
  btns.push([{ label: '撤回本次骰点', data: '/撤回骰点', type: 'input', enter: true }])

  await reply(session, deps, renderD8DeltaChange(o), btns)
}

interface D8DeltaOutcome {
  oldDelta: number
  newDelta: number
  d8Roll: number
  /** 当前 d4 工作骰（燃尽 / 增减成功 后） */
  dice: number[]
  triple: boolean
  isMember: boolean
  oldSuccesses: number
  newSuccesses: number
  oldChaos: number
  newChaos: number
  chaosDiff: number
  chaosPool: number
  failureNote: string | null
  failureDelta: number
  failureCount: number
}

function renderD8DeltaChange(o: D8DeltaOutcome): string {
  const lines: string[] = []
  lines.push(`# d8 处理：${labelD8Delta(o.oldDelta)} → **${labelD8Delta(o.newDelta)}**`)
  if (o.triple) {
    lines.push('')
    lines.push(`![三重升华 #500px #126px](${TRIPLE_SUBLIMATION_IMG})`)
  }
  lines.push('')
  // 最终骰：六颗 d4 + d8 用括号，如 3 · 2 · 1 · 2 · 3 · 2（3）
  lines.push(`最终骰　**${o.dice.join(' · ')}（${o.d8Roll}）**`)
  lines.push('')
  lines.push(`最终成功数　**${o.newSuccesses}**${o.triple ? '　★ 三重升华 ★' : ''}（${o.oldSuccesses} → ${o.newSuccesses}）`)
  if (o.isMember) {
    const sign = o.chaosDiff >= 0 ? '+' : ''
    if (o.triple) {
      lines.push(`本次混沌　${o.oldChaos} → **0**　★ 三重升华 ★（差值 ${sign}${o.chaosDiff}）`)
    } else {
      lines.push(`本次混沌　${o.oldChaos} → **${o.newChaos}**（差值 ${sign}${o.chaosDiff}）`)
    }
    lines.push(`混沌池　**${o.chaosPool}**`)
    if (o.failureNote) {
      lines.push('')
      lines.push(`> ${o.failureNote}（当前失败计数 ${o.failureCount}）`)
    }
  } else {
    if (o.triple) lines.push('> ★ 三重升华 ★（观察模式，不影响混沌池）')
    else lines.push('> 观察模式：本次切换不影响混沌池 / 失败计数')
  }
  return lines.join('\n')
}

async function handleUndo(
  deps: PostRollDeps,
  session: import('koishi').Session | undefined,
): Promise<void> {
  if (!session) return
  if (session.isDirect) return reply(session, deps, '> 私聊不支持骰点命令。')

  const roomId = roomIdOf(session)
  const rawRoomId = rawRoomIdOf(session)
  if (!roomId || !rawRoomId) return reply(session, deps, '> 无法定位房间。')
  const playerId = session.userId ?? 'unknown'

  const pending = deps.pending.get(roomId, playerId)
  if (!pending) {
    return reply(session, deps, '> 没有可撤回的骰点（已过期或未骰点）。')
  }

  const summary = {
    chaosBack: 0,
    failureBack: 0,
    aptBack: {} as Record<string, number>,
    aptNewValues: {} as Record<string, number>,
  }
  const reprimandsBack = pending.consumedReprimands

  await deps.rooms.update(roomId, session.platform, rawRoomId, (room) => {
    const player = getOrCreatePlayer(room, playerId)
    // 退混沌
    const before = room.chaosPool
    room.chaosPool = Math.max(0, room.chaosPool - pending.chaosApplied)
    summary.chaosBack = before - room.chaosPool

    // 退失败计数
    if (pending.failureIncremented) {
      const fcBefore = room.failureCount
      room.failureCount = Math.max(0, room.failureCount - 1)
      summary.failureBack = fcBefore - room.failureCount
    }

    // 退资质（按 pending.consumedAptitudes）
    for (const [name, n] of Object.entries(pending.consumedAptitudes)) {
      if (n <= 0) continue
      player.aptitudes[name] = (player.aptitudes[name] ?? 0) + n
      summary.aptBack[name] = n
      summary.aptNewValues[name] = player.aptitudes[name]
    }
  })

  // 删除 pending
  deps.pending.delete(roomId, playerId)

  // web sync：混沌负增量、失败负增量、资质 setAptitudes 推绝对值
  if (summary.chaosBack > 0) {
    fireSyncChaos(deps.web, session, -summary.chaosBack, '撤回骰点')
  }
  if (summary.failureBack > 0) {
    fireSyncFailure(deps.web, session, -summary.failureBack)
  }
  if (Object.keys(summary.aptNewValues).length > 0) {
    fireSetAptitudes(deps.web, session, summary.aptNewValues)
  }
  // 退还申诫（spend 负数 = 退还），fire-and-forget
  if (reprimandsBack > 0 && deps.web) {
    const groupId = rawRoomIdOf(session) ?? null
    void deps.web.spendReprimands(playerId, groupId, -reprimandsBack, '撤回骰点退还')
  }

  // reply
  const lines: string[] = ['# 骰点已撤回', '']
  lines.push(`混沌池　**-${summary.chaosBack}**`)
  if (summary.failureBack > 0) {
    lines.push(`失败计数　**-${summary.failureBack}**`)
  }
  for (const [name, n] of Object.entries(summary.aptBack)) {
    lines.push(`资质 **${name}**　退还 **+${n}**`)
  }
  if (reprimandsBack > 0) {
    lines.push(`申诫　退还 **+${reprimandsBack}**`)
  }
  await reply(session, deps, lines.join('\n'))
}

type Action = '增加成功' | '减少成功'

async function handle(
  deps: PostRollDeps,
  session: import('koishi').Session | undefined,
  action: Action,
  n: number | undefined,
): Promise<void> {
  if (!session) return
  if (session.isDirect) {
    await reply(session, deps, '> 私聊不支持骰后修改。')
    return
  }
  if (!n || n <= 0) {
    await reply(session, deps, `> 用法：\`${action} <数量>\`（数量 ≥ 1）`)
    return
  }

  const roomId = roomIdOf(session)
  const rawRoomId = rawRoomIdOf(session)
  if (!roomId || !rawRoomId) {
    await reply(session, deps, '> 无法定位房间。')
    return
  }
  const playerId = session.userId ?? 'unknown'

  const pending = deps.pending.get(roomId, playerId)
  if (!pending) {
    await reply(session, deps, '> 没有待修改的骰点结果（可能已过期或未骰点）。')
    return
  }

  // 检定：d20 不可通过增/减成功调整（规则书明示）
  if (pending.trigger === '检定') {
    await reply(
      session,
      deps,
      '> 检定（d20）结果不可用 **增加成功 / 减少成功** 调整。如需撤销请用「撤回骰点」。',
    )
    return
  }

  // d10 模式：没有 d4 池可改，按规则 d10 面只能用 QA / 申诫 调整（不走 bot）
  if (pending.d10Roll !== null) {
    await reply(
      session,
      deps,
      '> d10 模式下不支持 **增加成功 / 减少成功**。\n> 请用 资质 / 申诫调整 d10 面。',
    )
    return
  }

  // 修改前从 web 拉最新混沌/燃尽
  await syncFromWeb(deps.web, deps.rooms, session)

  let outcome: PostRollOutcome | string | null = null

  await deps.rooms.update(roomId, session.platform, rawRoomId, (room) => {
    const player = getOrCreatePlayer(room, playerId)
    const aptName = pending.aptitudeName
    const aptValue = player.aptitudes[aptName] ?? 0

    if (aptValue < n) {
      outcome = `> 资质 **${aptName}** 不足：当前 ${aptValue}，需要 ${n}`
      return
    }

    const oldDice = pending.currentDice
    // 总成功数 = d4 + d6 + d8 当前增量贡献（三重升华时记 3）
    const oldSuccesses = isTripleWithRaw(pending, oldDice, pending.d8Delta)
      ? 3
      : countSuccesses(oldDice) + d6ThreeCount(pending.d6Roll) + pending.d8Delta
    const oldChaos = pending.chaosApplied
    const dice = [...oldDice]

    if (action === '增加成功') {
      const indices = oldDice
        .map((d, i) => (d !== 3 ? i : -1))
        .filter((i) => i >= 0)
      if (indices.length < n) {
        outcome = `> 只有 ${indices.length} 个非 3 骰子可以转换。`
        return
      }
      for (const i of indices.slice(0, n)) dice[i] = 3
    } else {
      const indices = oldDice
        .map((d, i) => (d === 3 ? i : -1))
        .filter((i) => i >= 0)
      if (indices.length < n) {
        outcome = `> 只有 ${indices.length} 个 3 可以转换。`
        return
      }
      for (const i of indices.slice(0, n)) {
        dice[i] = NON_THREE[Math.floor(Math.random() * NON_THREE.length)]
      }
    }

    // 后修改重算时把 d6 / d8 都带上（自身不在 d4 池里，但贡献的 3 数 / 混沌仍参与判定）
    const newTriple = isTripleWithRaw(pending, dice, pending.d8Delta)
    const newSuccesses = newTriple
      ? 3
      : countSuccesses(dice) + d6ThreeCount(pending.d6Roll) + pending.d8Delta
    const newChaos = newTriple
      ? 0
      : calculateChaos(
          dice,
          pending.unconsumedBurnout,
          pending.d6Roll,
          pending.d8Delta,
        )
    const isMember = isMissionMember(room, playerId)
    // 观察模式：不影响混沌池/失败计数；chaosDiff 仅用于显示
    const chaosDiff = isMember ? newChaos - oldChaos : 0

    if (isMember) {
      room.chaosPool = Math.max(0, room.chaosPool + chaosDiff)
    }

    let failureNote: string | null = null
    if (pending.trigger === '现实修改' && isMember) {
      if (pending.failureIncremented && newSuccesses > 0) {
        room.failureCount = Math.max(0, room.failureCount - 1)
        pending.failureIncremented = false
        failureNote = '成功数恢复，撤销失败计数 +1'
      } else if (
        !pending.failureIncremented &&
        oldSuccesses > 0 &&
        newSuccesses === 0
      ) {
        room.failureCount += 1
        pending.failureIncremented = true
        failureNote = '成功数归零，失败计数 +1'
      }
    }

    // 扣资质 + 更新 pending（含撤回追踪）
    player.aptitudes[aptName] = aptValue - n
    pending.consumedAptitudes[aptName] = (pending.consumedAptitudes[aptName] ?? 0) + n
    pending.currentDice = dice
    pending.chaosApplied = isMember ? newChaos : 0

    outcome = {
      action,
      n,
      aptName,
      isMember,
      aptValueBefore: aptValue,
      aptValueAfter: aptValue - n,
      newDice: dice,
      oldSuccesses,
      newSuccesses,
      oldChaos,
      newChaos,
      chaosDiff,
      chaosPool: room.chaosPool,
      failureNote,
      failureCount: room.failureCount,
      pendingRemainingThrees: countSuccesses(dice),
      pendingRemainingNonThrees: 6 - countSuccesses(dice),
    }
  })

  if (typeof outcome === 'string') {
    await reply(session, deps, outcome)
    return
  }
  if (outcome === null) return

  const o = outcome as PostRollOutcome
  // web 同步：资质消耗即便是观察模式也应同步（资质实际扣了）；混沌/失败仅 member 同步
  fireConsumeAptitude(deps.web, session, o.aptName, o.n)
  if (o.isMember) {
    fireSyncChaos(deps.web, session, o.chaosDiff, `骰后修改 ${o.aptName}`)
    if (o.failureNote === '成功数恢复，撤销失败计数 +1') {
      fireSyncFailure(deps.web, session, -1)
    } else if (o.failureNote === '成功数归零，失败计数 +1') {
      fireSyncFailure(deps.web, session, 1)
    }
  }
  // 把修正后的骰子结果再推一次到 web 画板
  fireDiceRoll(
    deps.web,
    session,
    `骰后修改 ${o.aptName}`,
    `${o.newSuccesses}个3`,
    o.newDice,
    'check',
  )

  const md = renderPostRoll(o)
  const buttons = renderPostRollButtons(o, pending)
  await reply(session, deps, md, buttons)
}

interface PostRollOutcome {
  action: Action
  n: number
  aptName: string
  isMember: boolean
  aptValueBefore: number
  aptValueAfter: number
  newDice: number[]
  oldSuccesses: number
  newSuccesses: number
  oldChaos: number
  newChaos: number
  chaosDiff: number
  chaosPool: number
  failureNote: string | null
  failureCount: number
  pendingRemainingThrees: number
  pendingRemainingNonThrees: number
}

function renderPostRoll(o: PostRollOutcome): string {
  const lines: string[] = []
  lines.push(`# ${o.action} ${o.n} · ${o.aptName}`)
  if (!o.isMember) {
    lines.push('')
    lines.push('> 观察模式：本次修改不影响混沌池 / 失败计数')
  }
  lines.push('')
  lines.push(
    `资质 **${o.aptName}**　**${o.aptValueBefore} → ${o.aptValueAfter}**`,
  )
  lines.push('')
  lines.push(`骰子　**${formatDice(o.newDice)}**`)
  lines.push('')
  lines.push(`成功数　**${o.oldSuccesses} → ${o.newSuccesses}**`)
  if (o.isMember) {
    const sign = o.chaosDiff >= 0 ? '+' : ''
    lines.push(
      `本次混沌　${o.oldChaos} → **${o.newChaos}**（差值 ${sign}${o.chaosDiff}）`,
    )
    lines.push(`混沌池　**${o.chaosPool}**`)
    if (o.failureNote) {
      lines.push('')
      lines.push(`> ${o.failureNote}（当前失败计数 ${o.failureCount}）`)
    }
  }
  return lines.join('\n')
}

function renderPostRollButtons(
  o: PostRollOutcome,
  pending: import('../types').PendingRoll,
): QQButton[][] {
  const buttons: QQButton[][] = [rerollRow(pending)]
  const row: QQButton[] = []
  if (o.pendingRemainingNonThrees > 0) {
    row.push({ label: '成功 +1', data: '/增加成功 1', type: 'input', enter: true })
  }
  if (o.pendingRemainingThrees > 0) {
    row.push({ label: '成功 -1', data: '/减少成功 1', type: 'input', enter: true })
  }
  if (pending.d6Roll !== null) row.push({ label: '调整 d6', data: '/d6调', type: 'input', enter: true })
  if (row.length > 0) buttons.push(row)
  if (pending.d8Roll !== null) {
    buttons.push(...d8DeltaButtonRows(pending.d8Roll, pending.d8Delta))
  }
  buttons.push([{ label: '撤回本次骰点', data: '/撤回骰点', type: 'input', enter: true }])
  return buttons
}

/** 解析不会被 Koishi 当成选项的 d8 参数；纯数字正值保留兼容。 */
export function parseD8DeltaArg(value: string | undefined): number | null {
  const token = (value ?? '').trim()
  if (token === '忽略' || token === '0') return 0
  let match = token.match(/^加([12])$/)
  if (match) return Number.parseInt(match[1], 10)
  match = token.match(/^减([12])$/)
  if (match) return -Number.parseInt(match[1], 10)
  if (/^\+?[12]$/.test(token)) return Number.parseInt(token, 10)
  // 兼容直接调用和旧链接；QQ/Koishi 文字命令里的负号仍可能先被框架吃掉。
  if (/^-[12]$/.test(token)) return Number.parseInt(token, 10)
  return null
}

function rerollRow(pending: import('../types').PendingRoll): QQButton[] {
  const apt = pending.aptitudeName
  return [
    {
      label: `再投·${apt.length > 6 ? `${apt.slice(0, 6)}…` : apt}`,
      data: `/${pending.trigger} ${apt}`,
      primary: true,
      type: 'input',
      enter: true,
    },
    { label: '更换资质', data: `/${pending.trigger}`, type: 'input', enter: true },
  ]
}

async function reply(
  session: import('koishi').Session,
  deps: PostRollDeps,
  content: string,
  buttons?: QQButton[][],
): Promise<void> {
  await sendQQMarkdown(session, content, {
    enabled: deps.useMarkdown,
    buttons,
  })
}
