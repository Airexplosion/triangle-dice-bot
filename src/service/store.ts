import type { Context } from 'koishi'
import { APTITUDE_NAMES } from '../const'
import type { PlayerState, RoomState } from '../types'

declare module 'koishi' {
  interface Tables {
    triangle_room: TriangleRoomRow
  }
}

export interface TriangleRoomRow {
  roomId: string
  rawRoomId: string
  platform: string
  chaosPool: number
  failureCount: number
  scatterValue: number
  players: Record<string, PlayerState>
  admins: string[]
  missionActive: boolean
  missionId: string | null
  missionName: string | null
  missionMembers: string[]
  pendingAdminApplicant: string | null
  updatedAt: Date
}

export function defineModel(ctx: Context): void {
  ctx.model.extend(
    'triangle_room',
    {
      roomId: 'string',
      rawRoomId: 'string',
      platform: 'string',
      chaosPool: 'integer',
      failureCount: 'integer',
      scatterValue: 'integer',
      players: { type: 'json', initial: {} },
      admins: { type: 'list', initial: [] },
      missionActive: 'boolean',
      missionId: { type: 'string', nullable: true },
      missionName: { type: 'string', nullable: true },
      missionMembers: { type: 'list', initial: [] },
      pendingAdminApplicant: { type: 'string', nullable: true },
      updatedAt: 'timestamp',
    },
    { primary: 'roomId' },
  )
}

export class RoomStore {
  constructor(private ctx: Context) {}

  /**
   * 获取房间，不存在则返回零值占位（不写库）。
   */
  async get(roomId: string): Promise<RoomState | null> {
    const rows = await this.ctx.database.get('triangle_room', { roomId })
    if (rows.length === 0) return null
    return rowToState(rows[0])
  }

  /**
   * 取或创建房间。新房间使用初始零值 + 给定的 platform / rawRoomId。
   */
  async getOrCreate(
    roomId: string,
    platform: string,
    rawRoomId: string,
  ): Promise<RoomState> {
    const existing = await this.get(roomId)
    if (existing) return existing
    const fresh: RoomState = {
      roomId,
      rawRoomId,
      platform,
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
    }
    await this.ctx.database.upsert('triangle_room', [stateToRow(fresh)])
    return fresh
  }

  /**
   * 在锁外读、回调内修改、再原子写。
   * 与 Python 版 update_room(updater) 模式语义一致。
   * 单 Node 事件循环 + database 实现已是事务原语，这里不再加显式锁。
   */
  async update<T>(
    roomId: string,
    platform: string,
    rawRoomId: string,
    updater: (state: RoomState) => T | Promise<T>,
  ): Promise<T> {
    const state = await this.getOrCreate(roomId, platform, rawRoomId)
    const result = await updater(state)
    state.updatedAt = new Date()
    await this.ctx.database.upsert('triangle_room', [stateToRow(state)])
    return result
  }

  async list(): Promise<RoomState[]> {
    const rows = await this.ctx.database.get('triangle_room', {})
    return rows.map(rowToState)
  }
}

function rowToState(row: TriangleRoomRow): RoomState {
  return {
    roomId: row.roomId,
    rawRoomId: row.rawRoomId,
    platform: row.platform,
    chaosPool: row.chaosPool ?? 0,
    failureCount: row.failureCount ?? 0,
    scatterValue: row.scatterValue ?? 0,
    players: row.players ?? {},
    admins: row.admins ?? [],
    missionActive: row.missionActive ?? false,
    missionId: row.missionId ?? null,
    missionName: row.missionName ?? null,
    missionMembers: row.missionMembers ?? [],
    pendingAdminApplicant: row.pendingAdminApplicant ?? null,
    updatedAt: row.updatedAt ?? new Date(),
  }
}

function stateToRow(state: RoomState): TriangleRoomRow {
  return {
    roomId: state.roomId,
    rawRoomId: state.rawRoomId,
    platform: state.platform,
    chaosPool: state.chaosPool,
    failureCount: state.failureCount,
    scatterValue: state.scatterValue,
    players: state.players,
    admins: state.admins,
    missionActive: state.missionActive,
    missionId: state.missionId,
    missionName: state.missionName,
    missionMembers: state.missionMembers,
    pendingAdminApplicant: state.pendingAdminApplicant,
    updatedAt: state.updatedAt,
  }
}

/**
 * 工具：取或创建玩家，初始 9 项资质为 0。
 */
export function getOrCreatePlayer(state: RoomState, playerId: string): PlayerState {
  let p = state.players[playerId]
  if (!p) {
    const aptitudes: Record<string, number> = {}
    for (const name of APTITUDE_NAMES) aptitudes[name] = 0
    p = { playerId, aptitudes }
    state.players[playerId] = p
  } else {
    // 兼容老数据：补齐缺失的资质槽
    for (const name of APTITUDE_NAMES) {
      if (typeof p.aptitudes[name] !== 'number') p.aptitudes[name] = 0
    }
  }
  return p
}
