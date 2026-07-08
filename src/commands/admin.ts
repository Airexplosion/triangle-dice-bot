import type { Context, Session } from 'koishi'
import { rawRoomIdOf, roomIdOf } from '../room'
import type { RoomStore } from '../service/store'
import {
  fireSyncChaos,
  fireSyncFailure,
  fireSyncScatter,
  syncFromWeb,
} from '../service/sync'
import type { WebClient } from '../service/web-client'
import type { RoomState } from '../types'
import { isAdmin, isQQGuildChannel } from '../util/auth'
import { sendQQMarkdown, type QQButton } from '../util/qq-markdown'

export interface AdminDeps {
  rooms: RoomStore
  web: WebClient | null
  useMarkdown: boolean
}

export function registerAdminCommands(ctx: Context, deps: AdminDeps): void {
  // 任务属性 ── 所有人能看（Python 版要求管理员，但读取性命令放开更友好；
  // 如需收紧，调 _checkAdmin 即可）
  ctx
    .command('任务属性', '查看混沌池 / 燃尽计数')
    .action(async ({ session }) => {
      if (!session) return
      // 显示前从 web 同步最新值
      await syncFromWeb(deps.web, deps.rooms, session)
      const rs = await loadRoom(deps, session)
      if (typeof rs === 'string') return reply(session, deps, rs)
      const md = renderTaskAttrs(rs)
      const buttons = buildTaskAttrButtons(isAdmin(session, rs), undefined, Boolean(rs.missionId))
      await reply(session, deps, md, buttons)
    })

  ctx
    .command('混沌增加 <n:posint>', '管理员：增加混沌池')
    .action(async ({ session }, n) =>
      modifyCounter(deps, session, '混沌', '增加', n),
    )

  ctx
    .command('混沌减少 <n:posint>', '管理员：减少混沌池')
    .action(async ({ session }, n) =>
      modifyCounter(deps, session, '混沌', '减少', n),
    )

  ctx
    .command('失败增加 <n:posint>', '管理员：增加燃尽计数')
    .action(async ({ session }, n) =>
      modifyCounter(deps, session, '失败', '增加', n),
    )

  ctx
    .command('失败减少 <n:posint>', '管理员：减少燃尽计数')
    .action(async ({ session }, n) =>
      modifyCounter(deps, session, '失败', '减少', n),
    )

  ctx
    .command('散逸增加 <n:posint>', '管理员：增加散逸端')
    .action(async ({ session }, n) =>
      modifyCounter(deps, session, '散逸', '增加', n),
    )

  ctx
    .command('散逸减少 <n:posint>', '管理员：减少散逸端')
    .action(async ({ session }, n) =>
      modifyCounter(deps, session, '散逸', '减少', n),
    )

  ctx
    .command('调整属性 <field:string> [direction:string] [n:posint]', '管理员：调整任务属性')
    .action(async ({ session }, field, direction, n) => {
      const normalized = normalizeCounterField(field)
      if (!session) return
      if (!normalized) {
        await reply(session, deps, '> 用法：调整属性 混沌/燃尽/散逸 加/减 N')
        return
      }

      // Koishi 会把以「-」开头的位置参数当成命令选项，导致 -1/-2 无法传进 action。
      // 统一使用「加/减 + 正整数」，按钮文案仍可正常显示 +1/−1。
      if (!direction) {
        await reply(session, deps, `# 自定义${counterLabel(normalized)}\n\n请选择调整方向：`, [
          [
            { label: '增加', data: `/调整属性 ${normalized} 加 `, primary: true, type: 'input' },
            { label: '减少', data: `/调整属性 ${normalized} 减 `, type: 'input' },
          ],
        ])
        return
      }
      const action = normalizeCounterDirection(direction)
      if (!action || !n || n <= 0) {
        await reply(session, deps, '> 用法：调整属性 混沌/燃尽/散逸 加/减 N（N ≥ 1）')
        return
      }
      await modifyCounter(
        deps,
        session,
        normalized,
        action,
        n,
      )
    })

  ctx.command('管理面板', '管理员：打开当前群管理面板').action(async ({ session }) => {
    if (!session) return
    const rs = await loadRoom(deps, session)
    if (typeof rs === 'string') return reply(session, deps, rs)
    if (!isAdmin(session, rs)) return reply(session, deps, '> 需要管理员权限。')

    const lines = ['# 经理面板', '']
    lines.push(rs.missionActive ? `当前任务　**${rs.missionName ?? '进行中'}**` : '当前任务　**未开始**')
    const buttons: QQButton[][] = []
    if (rs.missionActive) {
      const taskRow: QQButton[] = []
      if (rs.missionId) taskRow.push({ label: '任务详情', data: '/查看任务', type: 'input', enter: true })
      taskRow.push({ label: '任务属性', data: '/任务属性', primary: true, type: 'input', enter: true })
      if (rs.missionId) taskRow.push({ label: '任务报告', data: '/查看报告', type: 'input', enter: true })
      buttons.push(taskRow)
      buttons.push([
        { label: '结束任务', data: '/结束任务', type: 'input', enter: true },
        { label: '解绑任务', data: '/解绑任务', type: 'input', enter: true },
      ])
    } else {
      buttons.push([
        { label: '填写任务绑定码', data: '/开始任务 ', type: 'input' },
        { label: '独立任务模式', data: '/开始任务 不使用', type: 'input', enter: true },
      ])
    }
    buttons.push([
      { label: '跑团日志', data: '/log', type: 'input', enter: true },
      { label: '操作菜单', data: '/菜单', type: 'input', enter: true },
    ])
    await reply(session, deps, lines.join('\n'), buttons)
  })

  ctx
    .command('注册管理 [mode:string]', '注册首位管理员（群聊场景）')
    .action(async ({ session }, mode) => registerAdmin(deps, session, mode))

  ctx
    .command('申请管理 [mode:string]', '申请成为管理员')
    .action(async ({ session }, mode) => applyAdmin(deps, session, mode))

  ctx.command('同意管理', '管理员：批准管理员申请').action(async ({ session }) =>
    approveAdmin(deps, session),
  )
}

// ---------------------------------------------------------------------------
// 任务属性
// ---------------------------------------------------------------------------

function renderTaskAttrs(rs: RoomState): string {
  return [
    '# 任务属性',
    '',
    `混沌池　**${rs.chaosPool}**`,
    `燃尽计数　**${rs.failureCount}**`,
    `散逸端　**${rs.scatterValue}**`,
  ].join('\n')
}

// ---------------------------------------------------------------------------
// 混沌 / 失败 加减
// ---------------------------------------------------------------------------

async function modifyCounter(
  deps: AdminDeps,
  session: Session | undefined,
  field: '混沌' | '失败' | '散逸',
  action: '增加' | '减少',
  n: number | undefined,
): Promise<void> {
  if (!session) return
  if (session.isDirect) return reply(session, deps, '> 私聊不支持此命令。')
  if (!n || n <= 0) {
    return reply(session, deps, `> 用法：${field}${action} N（N ≥ 1）`)
  }

  const ids = ensureRoomIds(session)
  if (!ids) return reply(session, deps, '> 无法定位房间。')

  const room = await deps.rooms.getOrCreate(
    ids.roomId,
    session.platform,
    ids.rawRoomId,
  )
  if (!isAdmin(session, room)) {
    return reply(session, deps, '> 需要管理员权限。')
  }

  // 修改前从 web 拉最新值，避免覆盖网页的并发改动
  await syncFromWeb(deps.web, deps.rooms, session)

  let oldVal = 0
  let newVal = 0
  await deps.rooms.update(ids.roomId, session.platform, ids.rawRoomId, (r) => {
    if (field === '混沌') {
      oldVal = r.chaosPool
      r.chaosPool =
        action === '增加' ? r.chaosPool + n : Math.max(0, r.chaosPool - n)
      newVal = r.chaosPool
    } else if (field === '失败') {
      oldVal = r.failureCount
      r.failureCount =
        action === '增加' ? r.failureCount + n : Math.max(0, r.failureCount - n)
      newVal = r.failureCount
    } else {
      oldVal = r.scatterValue
      r.scatterValue =
        action === '增加' ? r.scatterValue + n : Math.max(0, r.scatterValue - n)
      newVal = r.scatterValue
    }
  })

  // 把实际差额同步回 web
  const realDelta = newVal - oldVal
  if (field === '混沌') {
    fireSyncChaos(deps.web, session, realDelta, `管理员手动${action}`)
  } else if (field === '失败') {
    fireSyncFailure(deps.web, session, realDelta)
  } else {
    fireSyncScatter(deps.web, session, realDelta)
  }

  const label =
    field === '混沌' ? '混沌池' : field === '失败' ? '燃尽计数' : '散逸端'
  const md = [
    '# ' + (field + action),
    '',
    `${label}　**${oldVal} → ${newVal}**`,
  ].join('\n')
  const buttons = buildTaskAttrButtons(true, field, Boolean(room.missionId))
  await reply(session, deps, md, buttons)
}

function normalizeCounterField(field: string | undefined): '混沌' | '失败' | '散逸' | null {
  const value = field?.trim()
  if (value === '混沌' || value === '混沌池') return '混沌'
  if (value === '失败' || value === '燃尽' || value === '燃尽计数') return '失败'
  if (value === '散逸' || value === '散逸端') return '散逸'
  return null
}

function normalizeCounterDirection(direction: string | undefined): '增加' | '减少' | null {
  const value = direction?.trim()
  if (value === '加' || value === '增加' || value === '+' || value === '+1') return '增加'
  if (value === '减' || value === '减少') return '减少'
  return null
}

function counterLabel(field: '混沌' | '失败' | '散逸'): string {
  return field === '混沌' ? '混沌' : field === '失败' ? '燃尽' : '散逸'
}

export function buildTaskAttrButtons(
  admin: boolean,
  highlight?: '混沌' | '失败' | '散逸',
  webMission = true,
): QQButton[][] {
  const rows: QQButton[][] = []
  if (admin) {
    const addRow = (field: '混沌' | '失败' | '散逸', label: string) => {
      rows.push([
        { label: `${label} −1`, data: `/调整属性 ${field} 减 1`, type: 'input', enter: true },
        { label: `${label} +1`, data: `/调整属性 ${field} 加 1`, primary: highlight === field, type: 'input', enter: true },
        { label: `${label}自定义`, data: `/调整属性 ${field}`, type: 'input', enter: true },
      ])
    }
    addRow('混沌', '混沌')
    addRow('失败', '燃尽')
    addRow('散逸', '散逸')
  }
  const nav: QQButton[] = [
    { label: '刷新属性', data: '/任务属性', primary: !admin, type: 'input', enter: true },
  ]
  if (webMission) nav.push({ label: '任务详情', data: '/查看任务', type: 'input', enter: true })
  nav.push({ label: admin ? '经理面板' : '操作菜单', data: admin ? '/管理面板' : '/菜单', type: 'input', enter: true })
  rows.push(nav)
  return rows
}

// ---------------------------------------------------------------------------
// 注册管理 / 申请管理 / 同意管理
// ---------------------------------------------------------------------------

async function registerAdmin(
  deps: AdminDeps,
  session: Session | undefined,
  mode: string | undefined,
): Promise<void> {
  if (!session) return
  if (session.isDirect) return reply(session, deps, '> 私聊不支持此命令。')

  if (isQQGuildChannel(session)) {
    return reply(session, deps, '> 频道中管理员由角色决定，无需注册。')
  }

  const ids = ensureRoomIds(session)
  if (!ids) return reply(session, deps, '> 无法定位房间。')
  const playerId = session.userId ?? ''

  // 默认走 web 经理身份验证；"不使用" 后缀跳过
  const verifyMsg = await verifyManagerRole(deps, playerId, mode, '注册管理')
  if (verifyMsg) return reply(session, deps, verifyMsg)

  let outcome = ''
  await deps.rooms.update(ids.roomId, session.platform, ids.rawRoomId, (r) => {
    if (r.admins.length === 0) {
      r.admins.push(playerId)
      outcome = '已注册为本群管理员。'
    } else if (r.admins.includes(playerId)) {
      outcome = '你已经是管理员了。'
    } else {
      outcome = '本群已有管理员，请使用「申请管理」命令申请。'
    }
  })
  await reply(session, deps, `> ${outcome}`)
}

async function applyAdmin(
  deps: AdminDeps,
  session: Session | undefined,
  mode: string | undefined,
): Promise<void> {
  if (!session) return
  if (session.isDirect) return reply(session, deps, '> 私聊不支持此命令。')

  if (isQQGuildChannel(session)) {
    return reply(session, deps, '> 频道中管理员由角色决定，无需申请。')
  }

  const ids = ensureRoomIds(session)
  if (!ids) return reply(session, deps, '> 无法定位房间。')
  const playerId = session.userId ?? ''

  // 默认走 web 经理身份验证；"不使用" 后缀跳过
  const verifyMsg = await verifyManagerRole(deps, playerId, mode, '申请管理')
  if (verifyMsg) return reply(session, deps, verifyMsg)

  let outcome: 'submitted' | 'no-admin' | 'already-admin' = 'submitted' as
    | 'submitted'
    | 'no-admin'
    | 'already-admin'
  await deps.rooms.update(ids.roomId, session.platform, ids.rawRoomId, (r) => {
    if (r.admins.length === 0) {
      outcome = 'no-admin'
      return
    }
    if (r.admins.includes(playerId)) {
      outcome = 'already-admin'
      return
    }
    r.pendingAdminApplicant = playerId
  })

  if (outcome === 'no-admin') {
    return reply(session, deps, '> 本群暂无管理员，请直接使用「注册管理」。')
  }
  if (outcome === 'already-admin') {
    return reply(session, deps, '> 你已经是管理员了。')
  }

  const buttons: QQButton[][] = [
    [{ label: '同意', data: '/同意管理', primary: true, type: 'input', enter: true }],
  ]
  await reply(
    session,
    deps,
    '> 已提交管理员申请，请现有管理员发送「同意管理」批准。',
    buttons,
  )
}

async function approveAdmin(
  deps: AdminDeps,
  session: Session | undefined,
): Promise<void> {
  if (!session) return
  if (session.isDirect) return reply(session, deps, '> 私聊不支持此命令。')

  const ids = ensureRoomIds(session)
  if (!ids) return reply(session, deps, '> 无法定位房间。')

  const room = await deps.rooms.getOrCreate(ids.roomId, session.platform, ids.rawRoomId)
  if (!isAdmin(session, room)) {
    return reply(session, deps, '> 需要管理员权限。')
  }
  if (!room.pendingAdminApplicant) {
    return reply(session, deps, '> 当前没有待批准的管理员申请。')
  }

  let outcome = ''
  await deps.rooms.update(ids.roomId, session.platform, ids.rawRoomId, (r) => {
    const targetId = r.pendingAdminApplicant
    if (!targetId) {
      outcome = '当前没有待批准的管理员申请。'
      return
    }
    if (r.admins.includes(targetId)) {
      outcome = '该用户已经是管理员了。'
    } else {
      r.admins.push(targetId)
      outcome = '已批准，新管理员已添加。'
    }
    r.pendingAdminApplicant = null
  })
  await reply(session, deps, `> ${outcome}`)
}

// ---------------------------------------------------------------------------
// Web 经理身份验证
// ---------------------------------------------------------------------------

/**
 * 校验当前用户是否为 web 经理。返回 null 表示通过；返回 string 表示失败提示文本。
 *
 * 行为：
 *   - mode 末尾含 "不使用" → 直接通过（用户主动跳过验证）
 *   - 未配置 web → 直接通过（独立部署场景）
 *   - web 调用失败 → 提示用户用 "不使用" 跳过
 *   - 已绑定 + 是经理 → 通过
 *   - 否则 → 拒绝并指引
 */
async function verifyManagerRole(
  deps: AdminDeps,
  qqOpenid: string,
  mode: string | undefined,
  command: '注册管理' | '申请管理',
): Promise<string | null> {
  if (mode && mode.trim() === '不使用') return null
  if (!deps.web) return null
  if (!qqOpenid) {
    return `> 无法获取 QQ 标识。如需跳过验证，使用「${command} 不使用」。`
  }

  const role = await deps.web.checkManagerRole(qqOpenid)
  if (!role) {
    return [
      '# 暂时连不上角色卡服务',
      '',
      '可能原因：',
      '· 角色卡服务器临时离线 / 重启中',
      '· 网络抖动',
      '· Bot 配置中的 `webApiBase` 写错',
      '',
      `如需跳过验证，使用「${command} 不使用」。`,
    ].join('\n')
  }
  if (!role.success) {
    return `> ${role.error ?? '查询失败'}`
  }
  if (!role.bound) {
    return [
      '> 您尚未绑定网页账号。',
      '',
      '请先用「绑定 <绑定码>」绑定账号，',
      `或用「${command} 不使用」跳过网页验证。`,
    ].join('\n')
  }
  if (!role.isManager) {
    return [
      '> 您的网页账号不是经理角色，无法' + command + '。',
      '',
      `如需跳过验证，请使用「${command} 不使用」。`,
    ].join('\n')
  }
  return null
}

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

function ensureRoomIds(session: Session): { roomId: string; rawRoomId: string } | null {
  const roomId = roomIdOf(session)
  const rawRoomId = rawRoomIdOf(session)
  if (!roomId || !rawRoomId) return null
  return { roomId, rawRoomId }
}

async function loadRoom(
  deps: AdminDeps,
  session: Session,
): Promise<RoomState | string> {
  if (session.isDirect) return '> 私聊不支持此命令。'
  const ids = ensureRoomIds(session)
  if (!ids) return '> 无法定位房间。'
  return deps.rooms.getOrCreate(ids.roomId, session.platform, ids.rawRoomId)
}

async function reply(
  session: Session,
  deps: AdminDeps,
  content: string,
  buttons?: QQButton[][],
): Promise<void> {
  await sendQQMarkdown(session, content, {
    enabled: deps.useMarkdown,
    buttons,
  })
}
