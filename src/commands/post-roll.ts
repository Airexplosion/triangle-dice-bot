import type { Context } from 'koishi'
import { calculateChaos } from '../game/chaos'
import { countSuccesses } from '../game/dice'
import { rawRoomIdOf, roomIdOf } from '../room'
import type { PendingRollStore } from '../service/pending'
import { getOrCreatePlayer, type RoomStore } from '../service/store'
import {
  fireConsumeAptitude,
  fireSetAptitudes,
  fireSyncChaos,
  fireSyncFailure,
  syncFromWeb,
} from '../service/sync'
import type { WebClient } from '../service/web-client'
import { isMissionMember } from '../util/mission'
import { sendQQMarkdown, type QQButton } from '../util/qq-markdown'
import { formatDice } from './roll'

export interface PostRollDeps {
  rooms: RoomStore
  pending: PendingRollStore
  web: WebClient | null
  useMarkdown: boolean
}

const NON_THREE = [1, 2, 4]

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
    const oldSuccesses = countSuccesses(oldDice)
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

    const newSuccesses = countSuccesses(dice)
    const newChaos = calculateChaos(dice, pending.unconsumedBurnout)
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
    row.push({ label: '增加成功 1', data: '增加成功 1', primary: true })
  }
  if (o.pendingRemainingThrees > 0) {
    row.push({ label: '减少成功 1', data: '减少成功 1' })
  }
  if (row.length > 0) buttons.push(row)
  buttons.push([{ label: '撤回骰点', data: '撤回骰点' }])
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
