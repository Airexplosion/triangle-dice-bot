import { describe, expect, it } from 'vitest'
import { isMissionMember } from '../src/util/mission'
import type { RoomState } from '../src/types'

/**
 * 回归测试：观察模式判断。
 * 三种状态各有 corner case，未来若改 RoomState 字段或加新场景，本测试要继续守住语义。
 */
describe('isMissionMember', () => {
  function makeRoom(overrides: Partial<RoomState> = {}): RoomState {
    return {
      roomId: 'qq:test',
      rawRoomId: 'test',
      platform: 'qq',
      chaosPool: 0,
      failureCount: 0,
      scatterValue: 0,
      players: {},
      admins: [],
      missionActive: false,
      missionId: null,
      missionName: null,
      missionMembers: [],
      pendingAdminApplicant: null,
      updatedAt: new Date(),
      ...overrides,
    }
  }

  it('未启用任务 → 所有人都贡献（独立群）', () => {
    const room = makeRoom({ missionActive: false })
    expect(isMissionMember(room, 'anyone')).toBe(true)
    expect(isMissionMember(room, 'unknown')).toBe(true)
  })

  it('启用任务但成员列表为空 → 所有人都贡献（独立模式）', () => {
    const room = makeRoom({ missionActive: true, missionMembers: [] })
    expect(isMissionMember(room, 'anyone')).toBe(true)
  })

  it('启用任务 + 有成员 → 仅成员贡献', () => {
    const room = makeRoom({
      missionActive: true,
      missionMembers: ['alice', 'bob'],
    })
    expect(isMissionMember(room, 'alice')).toBe(true)
    expect(isMissionMember(room, 'bob')).toBe(true)
    expect(isMissionMember(room, 'observer')).toBe(false)
  })

  it('精确匹配 playerId（防止前缀匹配等错误）', () => {
    const room = makeRoom({
      missionActive: true,
      missionMembers: ['user-12345'],
    })
    expect(isMissionMember(room, 'user-12345')).toBe(true)
    expect(isMissionMember(room, 'user-1234')).toBe(false)
    expect(isMissionMember(room, 'user-123456')).toBe(false)
  })
})
