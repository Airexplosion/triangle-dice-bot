import type { Context } from 'koishi'

/**
 * 跑团日志（log）存储层。仿海豹核心 .log 语义：
 *   每个房间有多份日志记录 + 至多一个"当前日志"（status ∈ recording|paused）。
 *   recording 时捕获中间件把发言落到 triangle_log_line。
 *
 * 表：
 *   triangle_log       一份日志的元数据
 *   triangle_log_line  逐条发言（append-only，O(1) 插入）
 */

declare module 'koishi' {
  interface Tables {
    triangle_log: TriangleLogRow
    triangle_log_line: TriangleLogLineRow
  }
}

export type LogStatus = 'recording' | 'paused' | 'ended'
export type LineKind = 'msg' | 'bot' | 'dice' | 'system'

export interface TriangleLogRow {
  id: number
  roomId: string
  name: string
  status: LogStatus
  createdAt: Date
  endedAt: Date | null
  /** 染色页链接（上传后缓存，再次 get 直接返回）。*/
  url: string | null
}

export interface TriangleLogLineRow {
  id: number
  logId: number
  time: Date
  senderId: string
  senderName: string
  kind: LineKind
  content: string
}

export function defineLogModel(ctx: Context): void {
  ctx.model.extend(
    'triangle_log',
    {
      id: 'unsigned',
      roomId: 'string',
      name: 'string',
      status: 'string',
      createdAt: 'timestamp',
      endedAt: { type: 'timestamp', nullable: true },
      url: { type: 'string', nullable: true },
    },
    { primary: 'id', autoInc: true },
  )
  ctx.model.extend(
    'triangle_log_line',
    {
      id: 'unsigned',
      logId: 'unsigned',
      time: 'timestamp',
      senderId: 'string',
      senderName: 'string',
      kind: 'string',
      content: 'text',
    },
    { primary: 'id', autoInc: true },
  )
}

export class LogStore {
  /** 内存缓存：roomId → 正在录制的 logId（无则 undefined）。捕获热路径靠它免查库。 */
  private recordingCache = new Map<string, number>()

  constructor(private ctx: Context) {}

  /** 房间是否正在录制；是则返回 logId。仅查内存。 */
  recordingLogId(roomId: string): number | undefined {
    return this.recordingCache.get(roomId)
  }

  /** 当前日志（recording 或 paused），至多一条。 */
  async current(roomId: string): Promise<TriangleLogRow | null> {
    const rows = await this.ctx.database.get('triangle_log', { roomId })
    return rows.find((r) => r.status === 'recording' || r.status === 'paused') ?? null
  }

  /** 新建并开始记录。已有当前日志 → 返回 null（调用方提示先 end）。 */
  async create(roomId: string, name: string): Promise<TriangleLogRow | null> {
    if (await this.current(roomId)) return null
    const row = await this.ctx.database.create('triangle_log', {
      roomId,
      name,
      status: 'recording',
      createdAt: new Date(),
      endedAt: null,
      url: null,
    })
    this.recordingCache.set(roomId, row.id)
    return row
  }

  /** 暂停当前录制。返回是否成功（无 recording 当前日志则 false）。 */
  async pause(roomId: string): Promise<TriangleLogRow | null> {
    const cur = await this.current(roomId)
    if (!cur || cur.status !== 'recording') return null
    await this.ctx.database.set('triangle_log', cur.id, { status: 'paused' })
    this.recordingCache.delete(roomId)
    return { ...cur, status: 'paused' }
  }

  /**
   * 开始/切换记录。
   *   name 给定：把该名字的日志设为 recording（先要求没有其它当前日志）。
   *   name 省略：续记当前 paused 日志。
   * 返回 { ok, row, reason }。
   */
  async resume(
    roomId: string,
    name?: string,
  ): Promise<{ ok: boolean; row?: TriangleLogRow; reason?: string }> {
    const cur = await this.current(roomId)
    if (name) {
      // 切到具名日志：若当前有别的进行中日志，先拒绝
      if (cur && cur.name !== name) {
        return { ok: false, reason: `已有进行中的日志「${cur.name}」，请先 log end` }
      }
      const rows = await this.ctx.database.get('triangle_log', { roomId, name })
      if (!rows.length) return { ok: false, reason: `没有名为「${name}」的日志` }
      const row = rows[0]
      await this.ctx.database.set('triangle_log', row.id, { status: 'recording', endedAt: null })
      this.recordingCache.set(roomId, row.id)
      return { ok: true, row: { ...row, status: 'recording' } }
    }
    if (!cur) return { ok: false, reason: '没有可继续的日志，请用 log new 新建' }
    if (cur.status === 'recording') return { ok: false, reason: '当前日志已在记录中' }
    await this.ctx.database.set('triangle_log', cur.id, { status: 'recording' })
    this.recordingCache.set(roomId, cur.id)
    return { ok: true, row: { ...cur, status: 'recording' } }
  }

  /** 结束当前日志（recording 或 paused）。返回该日志，无则 null。 */
  async end(roomId: string): Promise<TriangleLogRow | null> {
    const cur = await this.current(roomId)
    if (!cur) return null
    await this.ctx.database.set('triangle_log', cur.id, { status: 'ended', endedAt: new Date() })
    this.recordingCache.delete(roomId)
    return { ...cur, status: 'ended', endedAt: new Date() }
  }

  /** 按名字找一份日志（任意状态）。 */
  async findByName(roomId: string, name: string): Promise<TriangleLogRow | null> {
    const rows = await this.ctx.database.get('triangle_log', { roomId, name })
    return rows[0] ?? null
  }

  /** 列出房间所有日志，新→旧。 */
  async list(roomId: string): Promise<TriangleLogRow[]> {
    const rows = await this.ctx.database.get('triangle_log', { roomId })
    return rows.sort((a, b) => b.id - a.id)
  }

  /** 删除一份日志 + 其所有发言。 */
  async remove(roomId: string, name: string): Promise<boolean> {
    const row = await this.findByName(roomId, name)
    if (!row) return false
    await this.ctx.database.remove('triangle_log_line', { logId: row.id })
    await this.ctx.database.remove('triangle_log', { id: row.id })
    if (this.recordingCache.get(roomId) === row.id) this.recordingCache.delete(roomId)
    return true
  }

  /** 缓存染色页链接。 */
  async setUrl(logId: number, url: string): Promise<void> {
    await this.ctx.database.set('triangle_log', logId, { url })
  }

  /** 追加一条发言（热路径，best-effort）。 */
  async appendLine(line: Omit<TriangleLogLineRow, 'id'>): Promise<void> {
    await this.ctx.database.create('triangle_log_line', line)
  }

  /** 取一份日志的全部发言，按时间（id）升序。 */
  async getLines(logId: number): Promise<TriangleLogLineRow[]> {
    const rows = await this.ctx.database.get('triangle_log_line', { logId })
    return rows.sort((a, b) => a.id - b.id)
  }

  async countLines(logId: number): Promise<number> {
    const rows = await this.ctx.database.get('triangle_log_line', { logId }, ['id'])
    return rows.length
  }
}
