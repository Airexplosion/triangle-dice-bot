import type { RoomState } from '../types'

/**
 * 判断玩家是否对当前房间的混沌池 / 燃尽计数有贡献。
 *
 *   - 房间未启用任务（独立群） → 所有人都贡献
 *   - 启用任务但成员列表为空（"独立模式 / 不使用 web 任务"） → 所有人都贡献
 *   - 启用任务 + 有成员列表 → 仅成员贡献，其它人为"观察模式"
 *
 * 与 Python 版 RoomState.is_mission_member 语义一致。
 */
export function isMissionMember(room: RoomState, playerId: string): boolean {
  if (!room.missionActive) return true
  if (room.missionMembers.length === 0) return true
  return room.missionMembers.includes(playerId)
}
