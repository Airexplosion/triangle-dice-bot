import type { Context, Session } from 'koishi'
import { rawRoomIdOf } from '../room'
import type { WebClient } from '../service/web-client'
import { NETWORK_ERROR_BLOCK } from '../util/messages'
import { sendQQMarkdown, type QQButton } from '../util/qq-markdown'
import { makeWrap } from '../util/safe-action'

export interface AuditDeps {
  web: WebClient | null
  useMarkdown: boolean
  auditGroupIds: string[]
  auditUserIds: string[]
}

/** 一屏内最多带按钮展示的申请条数（QQ 键盘最多 5 行）。 */
const MAX_WITH_BUTTONS = 5

export function registerAuditCommands(ctx: Context, deps: AuditDeps): void {
  const wrap = makeWrap(ctx, deps.useMarkdown)

  // ─── /info：查询触发者个人 id + 当前群 id（不限权限，用于配置白名单）──
  ctx.command('info', '查询你的个人 ID 与当前群 ID').action(
    wrap(async ({ session }) => {
      if (!session) return
      const uid = session.userId ?? '(未知)'
      const gid = session.isDirect ? null : rawRoomIdOf(session)
      const lines = [
        '# 三角机构 · ID 信息',
        '',
        '个人 ID（openid）',
        `\`${uid}\``,
        '',
        '当前群 ID（group openid）',
        gid ? `\`${gid}\`` : '`（当前为私聊，无群 ID）`',
        '',
        `审核备注短码　**#${shortCode(uid)}**`,
      ]
      await reply(session, deps, lines.join('\n'))
    }),
  )

  // ─── /经理审核 [action] [id] [note]──
  ctx.command('经理审核 [action:string] [id:string] [note:text]', '超管：审核经理申请').action(
    wrap(async ({ session }, action, id, note) => {
      if (!session) return
      const gate = auditGate(session, deps)
      if (gate) return reply(session, deps, `> ${gate}`)
      if (!deps.web) return reply(session, deps, NETWORK_ERROR_BLOCK)

      // 有 action+id → 执行审核；否则列出待审核
      if (action && id) {
        const verb = parseAction(action)
        if (!verb) return reply(session, deps, '> 用法：经理审核 通过/拒绝 <编号> [备注]')
        const appId = Number.parseInt(id, 10)
        if (!Number.isInteger(appId)) return reply(session, deps, '> 编号必须是数字。')
        const r = await deps.web.reviewManagerApplication(
          appId,
          verb,
          shortCode(session.userId ?? ''),
          note?.trim() || undefined,
        )
        if (!r) return reply(session, deps, NETWORK_ERROR_BLOCK)
        if (!r.success) return reply(session, deps, `> ${r.error ?? '审核失败'}`)
        return reply(session, deps, `> ${r.message ?? '已处理'}`, [
          [{ label: '查看待审核', data: '/经理审核', type: 'input', enter: true }],
        ])
      }

      // 列出待审核
      const r = await deps.web.listManagerApplications()
      if (!r) return reply(session, deps, NETWORK_ERROR_BLOCK)
      if (!r.success) return reply(session, deps, `> ${r.error ?? '查询失败'}`)
      const apps = r.applications ?? []
      if (!apps.length) return reply(session, deps, '> 当前没有待审核的经理申请。')

      const lines: string[] = [`# 待审核 · 经理申请`, '', `共 ${apps.length} 条待处理`, '']
      const shown = apps.slice(0, MAX_WITH_BUTTONS)
      const buttons: QQButton[][] = []
      shown.forEach((a, i) => {
        const who = a.name ? `${a.name}（@${a.username}）` : `@${a.username}`
        lines.push(`${i + 1}. **#${a.id}** ${who}　角色 ${a.char_count} 张`)
        if (a.reason && a.reason.trim()) lines.push(`　理由：${a.reason.trim()}`)
        buttons.push([
          { label: `通过 #${a.id}`, data: `/经理审核 通过 ${a.id}`, primary: true, type: 'input', enter: true },
          { label: `拒绝 #${a.id}`, data: `/经理审核 拒绝 ${a.id}`, type: 'input', enter: true },
        ])
      })
      if (apps.length > MAX_WITH_BUTTONS) {
        lines.push('')
        lines.push(`> 仅显示前 ${MAX_WITH_BUTTONS} 条，处理后再发 /经理审核 查看下一批。`)
      }
      await reply(session, deps, lines.join('\n'), buttons)
    }),
  )

  // ─── /分部审核 [action] [id] [note]──
  ctx.command('分部审核 [action:string] [id:string] [note:text]', '超管：审核分部创建申请').action(
    wrap(async ({ session }, action, id, note) => {
      if (!session) return
      const gate = auditGate(session, deps)
      if (gate) return reply(session, deps, `> ${gate}`)
      if (!deps.web) return reply(session, deps, NETWORK_ERROR_BLOCK)

      if (action && id) {
        const verb = parseAction(action)
        if (!verb) return reply(session, deps, '> 用法：分部审核 通过/拒绝 <编号> [备注]')
        const appId = Number.parseInt(id, 10)
        if (!Number.isInteger(appId)) return reply(session, deps, '> 编号必须是数字。')
        const r = await deps.web.reviewBranchApplication(
          appId,
          verb,
          shortCode(session.userId ?? ''),
          note?.trim() || undefined,
        )
        if (!r) return reply(session, deps, NETWORK_ERROR_BLOCK)
        if (!r.success) return reply(session, deps, `> ${r.error ?? '审核失败'}`)
        return reply(session, deps, `> ${r.message ?? '已处理'}`, [
          [{ label: '查看待审核', data: '/分部审核', type: 'input', enter: true }],
        ])
      }

      const r = await deps.web.listBranchApplications()
      if (!r) return reply(session, deps, NETWORK_ERROR_BLOCK)
      if (!r.success) return reply(session, deps, `> ${r.error ?? '查询失败'}`)
      const apps = r.applications ?? []
      if (!apps.length) return reply(session, deps, '> 当前没有待审核的分部申请。')

      const lines: string[] = [`# 待审核 · 分部创建`, '', `共 ${apps.length} 条待处理`, '']
      const shown = apps.slice(0, MAX_WITH_BUTTONS)
      const buttons: QQButton[][] = []
      shown.forEach((a, i) => {
        const who = a.name ? `${a.name}（@${a.username}）` : `@${a.username}`
        lines.push(`${i + 1}. **#${a.id}** 分部「${a.branch_name}」　申请人 ${who}`)
        if (a.branch_description && a.branch_description.trim())
          lines.push(`　简介：${a.branch_description.trim()}`)
        if (a.reason && a.reason.trim()) lines.push(`　理由：${a.reason.trim()}`)
        buttons.push([
          { label: `通过 #${a.id}`, data: `/分部审核 通过 ${a.id}`, primary: true, type: 'input', enter: true },
          { label: `拒绝 #${a.id}`, data: `/分部审核 拒绝 ${a.id}`, type: 'input', enter: true },
        ])
      })
      if (apps.length > MAX_WITH_BUTTONS) {
        lines.push('')
        lines.push(`> 仅显示前 ${MAX_WITH_BUTTONS} 条，处理后再发 /分部审核 查看下一批。`)
      }
      await reply(session, deps, lines.join('\n'), buttons)
    }),
  )
}

/** 白名单门控：须在白名单群内 且 为白名单用户。返回错误文案，通过则 null。 */
function auditGate(session: Session, deps: AuditDeps): string | null {
  if (session.isDirect) return '请在指定审核群内使用该命令。'
  const gid = rawRoomIdOf(session)
  const uid = session.userId
  if (!gid || !uid) return '无法定位当前群或用户。'
  if (!deps.auditGroupIds.includes(gid) || !deps.auditUserIds.includes(uid)) {
    return '你没有审核权限（需在指定审核群内、且为指定审核员）。'
  }
  return null
}

/** 把 通过/批准/approve → 'approve'，拒绝/驳回/reject → 'reject'，其余 null。 */
function parseAction(token: string): 'approve' | 'reject' | null {
  const t = token.trim().toLowerCase()
  if (['通过', '批准', '同意', 'approve', 'pass', 'ok'].includes(t)) return 'approve'
  if (['拒绝', '驳回', 'reject', 'deny', 'no'].includes(t)) return 'reject'
  return null
}

function shortCode(userId: string): string {
  return userId.slice(-6).toUpperCase()
}

async function reply(
  session: Session,
  deps: AuditDeps,
  content: string,
  buttons?: QQButton[][],
): Promise<void> {
  await sendQQMarkdown(session, content, {
    enabled: deps.useMarkdown,
    buttons,
  })
}
