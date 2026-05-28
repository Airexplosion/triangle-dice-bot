import type { Context } from 'koishi'
import { calculateChaos, isTripleSublimation } from '../game/chaos'
import {
  clampD8Delta,
  countSuccesses,
  d6ThreeCount,
  d8ThreeCount,
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

  // ─── d8 (赞助骰) 精确增量：/d8 <delta>（+2/+1/0/-1/-2，自动 clamp）───
  ctx
    .command('d8 <delta:string>', '骰后：设置 d8 的 3 数增量（如 /d8 1、/d8 -2）')
    .action(async ({ session }, delta) => handleD8Delta(deps, session, delta))
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

  const requested = Number.parseInt((deltaArg ?? '').trim(), 10)
  if (Number.isNaN(requested)) {
    const opts = d8DeltaOptions(pending.d8Roll).map((v) => `/d8 ${v}`).join('　')
    return reply(session, deps, `> 用法：\`/d8 <增量>\`\n> 可选：${opts}`)
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

  // 按钮：保留增量调整（每行最多 3 个）+ 撤回，方便继续微调
  const btns: QQButton[][] = [...d8DeltaButtonRows(o.d8Roll, o.newDelta)]
  btns.push([{ label: '撤回', data: '/撤回骰点', type: 'input', enter: true }])

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

  // reply
  const lines: string[] = ['# 骰点已撤回', '']
  lines.push(`混沌池　**-${summary.chaosBack}**`)
  if (summary.failureBack > 0) {
    lines.push(`失败计数　**-${summary.failureBack}**`)
  }
  for (const [name, n] of Object.entries(summary.aptBack)) {
    lines.push(`资质 **${name}**　退还 **+${n}**`)
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
      '> d10 模式下不支持 **增加成功 / 减少成功**。\n> 请用 QA / 申诫调整 d10 面（机制不在 bot 内）。',
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
  const buttons = renderPostRollButtons(o)
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

function renderPostRollButtons(o: PostRollOutcome): QQButton[][] {
  const buttons: QQButton[][] = []
  const row: QQButton[] = []
  if (o.pendingRemainingNonThrees > 0) {
    row.push({ label: '成功+1', data: '/增加成功 1', primary: true, type: 'input', enter: true })
  }
  if (o.pendingRemainingThrees > 0) {
    row.push({ label: '成功-1', data: '/减少成功 1', type: 'input', enter: true })
  }
  if (row.length > 0) buttons.push(row)
  buttons.push([{ label: '撤回', data: '/撤回骰点', type: 'input', enter: true }])
  return buttons
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
