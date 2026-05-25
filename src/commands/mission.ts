import type { Context, Session } from 'koishi'
import { rawRoomIdOf, roomIdOf } from '../room'
import type { RoomStore } from '../service/store'
import type { WebClient } from '../service/web-client'
import { isAdmin } from '../util/auth'
import {
  GROUP_ONLY,
  NETWORK_ERROR_BLOCK,
  NO_GROUP,
  NO_WEB_CONFIG_BLOCK,
} from '../util/messages'
import { requireMissionBound } from '../util/preconditions'
import { sendQQMarkdown, type QQButton } from '../util/qq-markdown'
import { makeWrap } from '../util/safe-action'

export interface MissionDeps {
  web: WebClient | null
  rooms: RoomStore
  useMarkdown: boolean
}

export function registerMissionCommands(ctx: Context, deps: MissionDeps): void {
  const wrap = makeWrap(ctx, deps.useMarkdown)

  ctx.command('查看任务', '查看当前群绑定任务详情').action(
    wrap(async ({ session }) => {
      if (!session) return
      if (!(await requireMissionBound(session, deps))) return
      const groupId = rawRoomIdOf(session)!

      const r = await deps.web!.getMissionDetail(groupId)
      if (!r) return reply(session, deps, NETWORK_ERROR_BLOCK)
      if (!r.success || !r.mission) {
        return reply(session, deps, `> ${r.error ?? '本群暂未绑定任务'}`)
      }
      const m = r.mission
      const lines: string[] = []
      lines.push(`# ${m.name}`)
      lines.push('')
      if (m.missionType) lines.push(`类型　**${m.missionType}**`)
      if (m.description) lines.push(m.description)
      lines.push('')
      lines.push(`混沌池　**${m.chaosValue}**`)
      lines.push(`燃尽计数　**${m.failureCount}**`)
      lines.push(`散逸端　**${m.scatterValue}**`)
      lines.push('')
      lines.push(`经理　**${m.creatorName}**`)
      if (m.members.length > 0) {
        lines.push('')
        lines.push(`参与者（${m.members.length}）`)
        for (const mem of m.members) lines.push(`- ${mem.characterName}`)
      }
      await reply(session, deps, lines.join('\n'), [
        [{ label: '任务属性', data: '任务属性' }],
      ])
    }),
  )

  ctx.command('开始任务 <code:string>', '管理员：绑定网页任务到本群').action(
    wrap(async ({ session }, code) => {
      if (!session) return
      if (session.isDirect) return reply(session, deps, GROUP_ONLY)
      const groupId = rawRoomIdOf(session)
      const roomId = roomIdOf(session)
      if (!groupId || !roomId) return reply(session, deps, NO_GROUP)

      const room = await deps.rooms.getOrCreate(
        roomId,
        session.platform,
        groupId,
      )
      if (!isAdmin(session, room)) {
        return reply(session, deps, '> 需要管理员权限。')
      }

      // "开始任务 不使用" → 独立任务模式（不绑 web）
      if (code && code.trim() === '不使用') {
        await deps.rooms.update(roomId, session.platform, groupId, (r) => {
          r.missionActive = true
          r.missionId = null
          r.missionName = '独立任务'
          r.missionMembers = []
        })
        return reply(
          session,
          deps,
          ['# 已进入独立任务模式', '', '骰点不会同步到网页，所有数据本地维护。'].join(
            '\n',
          ),
          [[{ label: '任务属性', data: '任务属性' }]],
        )
      }

      if (!deps.web) return reply(session, deps, NO_WEB_CONFIG_BLOCK)
      if (!code) {
        return reply(session, deps, '**用法**　开始任务 绑定码（或 不使用）')
      }

      const r = await deps.web.bindMission(code.trim(), groupId)
      if (!r) return reply(session, deps, NETWORK_ERROR_BLOCK)
      if (!r.success) return reply(session, deps, `> ${r.error ?? '绑定失败'}`)

      // 顺手拉一次任务详情，把成员列表（qqOpenid）同步进 RoomState
      const detail = await deps.web.getMissionDetail(groupId)
      const members =
        detail?.mission?.members
          ?.filter((m): m is typeof m & { qqOpenid: string } => Boolean(m.qqOpenid))
          .map((m) => m.qqOpenid) ?? []

      await deps.rooms.update(roomId, session.platform, groupId, (room) => {
        room.missionActive = true
        room.missionId = String(r.missionId)
        room.missionName = r.missionName ?? null
        room.missionMembers = members
      })
      await reply(
        session,
        deps,
        ['# 任务已绑定', '', `任务　**${r.missionName ?? r.missionId}**`].join('\n'),
        [[{ label: '查看任务', data: '查看任务' }]],
      )
    }),
  )

  ctx.command('结束任务', '管理员：结束当前任务').action(
    wrap(async ({ session }) => {
      if (!session) return
      if (session.isDirect) return reply(session, deps, GROUP_ONLY)
      const groupId = rawRoomIdOf(session)
      const roomId = roomIdOf(session)
      if (!groupId || !roomId) return reply(session, deps, NO_GROUP)

      const room = await deps.rooms.getOrCreate(
        roomId,
        session.platform,
        groupId,
      )
      if (!isAdmin(session, room)) {
        return reply(session, deps, '> 需要管理员权限。')
      }
      if (!room.missionActive) {
        return reply(session, deps, '> 当前没有活动任务。')
      }

      // 校验报告状态：未结算的报告会阻止结束
      if (deps.web && room.missionId) {
        const status = await deps.web.getReportStatus(groupId)
        if (status?.hasReport && !status.allAccepted) {
          return reply(
            session,
            deps,
            `> 当前有未处理的报告（${status.pendingCount ?? 0} 待响应，${status.appealingCount ?? 0} 申诉中），请先处理后再结束任务。`,
            [[{ label: '查看报告', data: '查看报告' }]],
          )
        }
      }

      const oldName = room.missionName
      await deps.rooms.update(roomId, session.platform, groupId, (r) => {
        r.missionActive = false
        r.missionId = null
        r.missionName = null
        r.missionMembers = []
      })
      await reply(session, deps, `> 任务「${oldName ?? '当前任务'}」已结束。`)
    }),
  )

  ctx.command('解绑任务', '管理员：解除群与网页任务的绑定').action(
    wrap(async ({ session }) => {
      if (!session) return
      if (session.isDirect) return reply(session, deps, GROUP_ONLY)
      if (!deps.web) return reply(session, deps, NO_WEB_CONFIG_BLOCK)
      const groupId = rawRoomIdOf(session)
      const roomId = roomIdOf(session)
      if (!groupId || !roomId) return reply(session, deps, NO_GROUP)

      const room = await deps.rooms.getOrCreate(
        roomId,
        session.platform,
        groupId,
      )
      if (!isAdmin(session, room)) {
        return reply(session, deps, '> 需要管理员权限。')
      }

      const r = await deps.web.unbindMission(groupId)
      if (!r) return reply(session, deps, NETWORK_ERROR_BLOCK)
      if (!r.success) return reply(session, deps, '> 解绑失败。')

      await deps.rooms.update(roomId, session.platform, groupId, (room) => {
        room.missionActive = false
        room.missionId = null
        room.missionName = null
        room.missionMembers = []
      })
      await reply(session, deps, '> 已解除群与任务的绑定。')
    }),
  )
}

async function reply(
  session: Session,
  deps: MissionDeps,
  content: string,
  buttons?: QQButton[][],
): Promise<void> {
  await sendQQMarkdown(session, content, {
    enabled: deps.useMarkdown,
    buttons,
  })
}
