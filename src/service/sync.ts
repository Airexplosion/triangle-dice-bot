import type { Session } from 'koishi'
import { rawRoomIdOf, roomIdOf } from '../room'
import type { RoomStore } from './store'
import type { WebClient } from './web-client'

/**
 * 群场景下：从 web 拉最新混沌池 / 燃尽 / 散逸端，更新到 RoomState。
 * 私聊、未配 web、或未绑定任务 → 跳过。
 */
export async function syncFromWeb(
  web: WebClient | null,
  rooms: RoomStore,
  session: Session,
): Promise<void> {
  if (!web || session.isDirect) return
  const roomId = roomIdOf(session)
  const rawRoomId = rawRoomIdOf(session)
  if (!roomId || !rawRoomId) return

  const detail = await web.getMissionDetail(rawRoomId)
  if (!detail?.success || !detail.mission) return
  const m = detail.mission
  const members =
    m.members
      ?.filter((mem): mem is typeof mem & { qqOpenid: string } => Boolean(mem.qqOpenid))
      .map((mem) => mem.qqOpenid) ?? []

  await rooms.update(roomId, session.platform, rawRoomId, (r) => {
    r.chaosPool = m.chaosValue ?? 0
    r.failureCount = m.failureCount ?? 0
    r.scatterValue = m.scatterValue ?? 0
    if (!r.missionId && m.id) r.missionId = String(m.id)
    if (!r.missionName && m.name) r.missionName = m.name
    // 任务成员同步：当 web 有 mission，认为有任务在进行
    r.missionActive = true
    r.missionMembers = members
  })
}

/**
 * 后台触发的同步：fire-and-forget，不阻塞 reply。失败仅打 log。
 * 仅当群+web 配置就绪时才发起。
 */
export function fireSyncChaos(
  web: WebClient | null,
  session: Session,
  delta: number,
  reason: string,
): void {
  if (!web || session.isDirect || delta === 0) return
  const groupId = rawRoomIdOf(session)
  if (!groupId) return
  void web.syncChaos(groupId, delta, reason)
}

export function fireSyncFailure(
  web: WebClient | null,
  session: Session,
  delta: number,
): void {
  if (!web || session.isDirect || delta === 0) return
  const groupId = rawRoomIdOf(session)
  if (!groupId) return
  void web.syncFailure(groupId, delta)
}

export function fireConsumeAptitude(
  web: WebClient | null,
  session: Session,
  aptitudeName: string,
  amount: number,
): void {
  if (!web || session.isDirect || amount <= 0) return
  const userId = session.userId
  if (!userId) return
  const groupId = rawRoomIdOf(session) ?? null
  void web.consumeAptitude(userId, groupId, aptitudeName, amount)
}

export function fireSetAptitudes(
  web: WebClient | null,
  session: Session,
  aptitudes: Record<string, number>,
): void {
  if (!web || session.isDirect) return
  const userId = session.userId
  if (!userId) return
  const groupId = rawRoomIdOf(session) ?? null
  void web.setAptitudes(userId, groupId, aptitudes)
}
