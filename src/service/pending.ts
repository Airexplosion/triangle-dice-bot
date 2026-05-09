import type { PendingRoll } from '../types'
import { PENDING_ROLL_TTL_SECONDS } from '../const'

/**
 * 内存中的 PendingRoll 仓库，按 (roomId, playerId) 索引。
 * 5 分钟 TTL，惰性 + 主动双清理：
 *   - get 时检查 expired
 *   - set 时挂 setTimeout 兜底删除（防内存泄漏）
 */
export class PendingRollStore {
  private byRoom = new Map<string, Map<string, PendingRoll>>()
  private timers = new Map<string, NodeJS.Timeout>()

  set(roomId: string, playerId: string, roll: PendingRoll): void {
    let roomMap = this.byRoom.get(roomId)
    if (!roomMap) {
      roomMap = new Map()
      this.byRoom.set(roomId, roomMap)
    }
    roomMap.set(playerId, roll)

    const timerKey = `${roomId}::${playerId}`
    const old = this.timers.get(timerKey)
    if (old) clearTimeout(old)
    const timer = setTimeout(() => {
      this.delete(roomId, playerId)
    }, PENDING_ROLL_TTL_SECONDS * 1000)
    if (typeof timer.unref === 'function') timer.unref()
    this.timers.set(timerKey, timer)
  }

  get(roomId: string, playerId: string): PendingRoll | undefined {
    const roomMap = this.byRoom.get(roomId)
    if (!roomMap) return undefined
    const roll = roomMap.get(playerId)
    if (!roll) return undefined
    if (this.isExpired(roll)) {
      this.delete(roomId, playerId)
      return undefined
    }
    return roll
  }

  delete(roomId: string, playerId: string): void {
    const roomMap = this.byRoom.get(roomId)
    if (roomMap) {
      roomMap.delete(playerId)
      if (roomMap.size === 0) this.byRoom.delete(roomId)
    }
    const timerKey = `${roomId}::${playerId}`
    const t = this.timers.get(timerKey)
    if (t) {
      clearTimeout(t)
      this.timers.delete(timerKey)
    }
  }

  /**
   * dispose：清空所有定时器（插件卸载时调用）。
   */
  dispose(): void {
    for (const t of this.timers.values()) clearTimeout(t)
    this.timers.clear()
    this.byRoom.clear()
  }

  private isExpired(roll: PendingRoll): boolean {
    return (Date.now() - roll.createdAt) / 1000 > PENDING_ROLL_TTL_SECONDS
  }
}

/**
 * 申请管理员的待处理记录（每房间最多一个待批准），无 TTL，进程生命周期。
 */
export class PendingAdminApplications {
  private map = new Map<string, string>()

  set(roomId: string, applicantId: string): void {
    this.map.set(roomId, applicantId)
  }

  get(roomId: string): string | undefined {
    return this.map.get(roomId)
  }

  delete(roomId: string): void {
    this.map.delete(roomId)
  }
}
