import type { Context, Session } from 'koishi'
import { rawRoomIdOf } from '../room'
import type { WebClient } from '../service/web-client'
import { NETWORK_ERROR_BLOCK } from '../util/messages'
import { requireBound } from '../util/preconditions'
import { sendQQMarkdown, type QQButton } from '../util/qq-markdown'
import { makeWrap } from '../util/safe-action'

export interface ReportDeps {
  web: WebClient | null
  useMarkdown: boolean
}

export function registerReportCommands(ctx: Context, deps: ReportDeps): void {
  const wrap = makeWrap(ctx, deps.useMarkdown)

  ctx.command('查看报告', '查看当前任务的待处理报告').action(
    wrap(async ({ session }) => {
      if (!session) return
      if (!(await requireBound(session, deps))) return
      const qqOpenid = session.userId!
      const groupId = session.isDirect
        ? undefined
        : rawRoomIdOf(session) ?? undefined

      const r = await deps.web!.getPendingReport(qqOpenid, groupId)
      if (!r) return reply(session, deps, NETWORK_ERROR_BLOCK)
      if (!r.success) return reply(session, deps, `> ${r.error ?? '查询失败'}`)
      if (!r.report) {
        return reply(session, deps, `> ${r.message ?? '当前没有待处理的报告。'}`)
      }

      const rep = r.report
      const lines: string[] = []
      lines.push(`# 待处理报告`)
      lines.push('')
      lines.push(`任务　**${rep.missionName}**`)
      lines.push(`评级　**${rep.rating}**`)
      lines.push(`我的状态　**${myStatusLabel(rep.myStatus)}**`)
      lines.push('')
      const rw = rep.myRewards
      const reward: string[] = []
      if (rw.commend) reward.push(`嘉奖 ${rw.commend > 0 ? '+' : ''}${rw.commend}`)
      if (rw.reprimand)
        reward.push(`申诫 ${rw.reprimand > 0 ? '+' : ''}${rw.reprimand}`)
      if (rw.mvp) reward.push('MVP')
      if (rw.probation) reward.push('察看期')
      lines.push(`待结算　${reward.length ? reward.join(' · ') : '无'}`)
      lines.push('')
      lines.push(
        `进度　${rep.allResponses.accepted}/${rep.allResponses.total} 已确认` +
          (rep.allResponses.appealing
            ? `（申诉中 ${rep.allResponses.appealing}）`
            : ''),
      )

      const buttons: QQButton[][] = []
      if (rep.myStatus === 'pending') {
        buttons.push([
          { label: '接受评级', data: '/通过报告', primary: true, type: 'input', enter: true },
          { label: '填写申诉理由', data: '申诉报告 ', type: 'input' },
        ])
      }
      buttons.push([
        { label: '角色状态', data: '/查询状态', type: 'input', enter: true },
        { label: '任务详情', data: '/查看任务', type: 'input', enter: true },
        { label: '操作菜单', data: '/菜单', type: 'input', enter: true },
      ])
      await reply(session, deps, lines.join('\n'), buttons)
    }),
  )

  ctx.command('通过报告', '接受当前评级').action(
    wrap(async ({ session }) => {
      if (!session) return
      if (!(await requireBound(session, deps))) return
      const qqOpenid = session.userId!
      const groupId = session.isDirect
        ? undefined
        : rawRoomIdOf(session) ?? undefined

      const r = await deps.web!.agentResponse(qqOpenid, groupId ?? null, 'accept')
      if (!r) return reply(session, deps, NETWORK_ERROR_BLOCK)
      if (!r.success) return reply(session, deps, `> ${r.error ?? '操作失败'}`)
      const note = r.autoFinalized ? '（任务报告已完结）' : ''
      await reply(
        session,
        deps,
        `> ${r.message ?? '已接受评级'}${note}`,
        [[
          { label: '角色状态', data: '/查询状态', primary: true, type: 'input', enter: true },
          { label: '任务详情', data: '/查看任务', type: 'input', enter: true },
        ]],
      )
    }),
  )

  ctx.command('申诉报告 <reason:text>', '提出申诉').action(
    wrap(async ({ session }, reason) => {
      if (!session) return
      if (!(await requireBound(session, deps))) return
      const qqOpenid = session.userId!
      if (!reason || !reason.trim()) {
        return reply(session, deps, '**用法**　申诉报告 原因（至少 1 字）')
      }
      const groupId = session.isDirect
        ? undefined
        : rawRoomIdOf(session) ?? undefined

      const r = await deps.web!.agentResponse(
        qqOpenid,
        groupId ?? null,
        'appeal',
        reason.trim(),
      )
      if (!r) return reply(session, deps, NETWORK_ERROR_BLOCK)
      if (!r.success) return reply(session, deps, `> ${r.error ?? '申诉失败'}`)
      await reply(session, deps, `> ${r.message ?? '申诉已提交，等待经理处理。'}`, [[
        { label: '查看报告', data: '/查看报告', primary: true, type: 'input', enter: true },
        { label: '任务详情', data: '/查看任务', type: 'input', enter: true },
      ]])
    }),
  )
}

function myStatusLabel(s: string): string {
  return (
    {
      pending: '待响应',
      accepted: '已接受',
      appealing: '申诉中',
      not_participant: '非参与者',
    } as Record<string, string>
  )[s] ?? s
}

async function reply(
  session: Session,
  deps: ReportDeps,
  content: string,
  buttons?: QQButton[][],
): Promise<void> {
  await sendQQMarkdown(session, content, {
    enabled: deps.useMarkdown,
    buttons,
  })
}
