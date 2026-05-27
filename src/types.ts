/**
 * 共享类型定义。
 * 数据库表 schema 在 service/store.ts 通过 module declaration 注入到 koishi。
 */

export interface PlayerState {
  /** 玩家 id（QQ openid 或频道 user id） */
  playerId: string
  /** 9 项资质，未录入则视为 0 */
  aptitudes: Record<string, number>
}

export interface RoomState {
  /** 复合主键：`${platform}:${rawRoomId}` */
  roomId: string
  /** 原始平台 room id（频道 channel_id 或群 group_openid） */
  rawRoomId: string
  /** 平台标识，如 'qq' */
  platform: string
  chaosPool: number
  failureCount: number
  scatterValue: number
  /** 各玩家状态，按 playerId 索引 */
  players: Record<string, PlayerState>
  /** 注册管理员的 playerId 列表（仅群聊场景） */
  admins: string[]
  missionActive: boolean
  missionId: string | null
  missionName: string | null
  missionMembers: string[]
  /** 当前待批准的管理员申请人 playerId（每房间最多一个） */
  pendingAdminApplicant: string | null
  updatedAt: Date
}

export interface PendingRoll {
  playerId: string
  /** '现实修改' | '异常能力' */
  trigger: string
  aptitudeName: string
  currentDice: number[]
  chaosApplied: number
  failureIncremented: boolean
  unconsumedBurnout: number
  /** epoch ms */
  createdAt: number
  /** 本次骰点 + 后修改 累计消耗的资质（撤回时按此退还） */
  consumedAptitudes: Record<string, number>
  /**
   * U2 解锁后的额外 d6（规则破坏者）。
   * null = 未使用 d6（普通骰点）；1-6 = 该次摇出的 d6 值。
   * d6 不在 currentDice 池里，不被增/减成功修改，仅供后修改时重算混沌用。
   */
  d6Roll: number | null
  /**
   * N1 解锁后的 d10（"无名"骰）。
   * null = 未使用；1-10 = 摇出的 d10 值。
   * d10 模式下 currentDice 为空，6D4 / 燃尽 / 增减成功 都不参与。
   */
  d10Roll: number | null
  /**
   * G3 解锁后的 d8（赞助骰）。
   * null = 未使用；1-8 = 摇出的 d8 面值。仅 现实修改 用到。
   */
  d8Roll: number | null
  /**
   * 玩家对 d8=3/6 的处理选择：
   *   'ignore'   = 不计入（默认）
   *   'count'    = 计入（增加 d8 等效 3 数）
   *   'subtract' = 减去（减少 d8 等效 3 数）
   * d8 ∈ {1,2,4,5,7,8} 时此字段无效（d8 等效 3 数恒为 0）。
   */
  d8Mode: 'ignore' | 'count' | 'subtract'
}
