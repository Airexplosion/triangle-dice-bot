import type { Context } from 'koishi'

/**
 * 角色卡 Web API 客户端。1:1 对应 triangle-agency-Character-sheet 的 /api/bot/* 端点。
 * 所有方法返回 `T | null`：null 表示请求失败 / HTTP 异常 / 服务端报错。
 * 业务层根据需要给用户友好提示。
 */
export class WebClient {
  private base: string

  constructor(
    private ctx: Context,
    baseUrl: string,
    private botKey: string,
  ) {
    this.base = baseUrl.replace(/\/+$/, '')
  }

  // ─── HTTP helpers ──────────────────────────────────────────────

  private headers(): Record<string, string> {
    return { 'X-Bot-Key': this.botKey }
  }

  /**
   * GET 调用。返回值约定：
   *   - 2xx：服务端 JSON 直接返回（业务上一般是 \{ success: true, ... \}）
   *   - 4xx：把服务端 \{ error: "..." \} 转成 \{ success: false, error \} 返回（业务错，不是连接失败）
   *   - 5xx / 网络异常：返回 null（视为连接失败，业务层提示"暂时无法连接"）
   */
  private async getJson<T>(
    path: string,
    params?: Record<string, unknown>,
  ): Promise<T | null> {
    try {
      return await this.ctx.http.get<T>(`${this.base}${path}`, {
        params,
        headers: this.headers(),
        timeout: 5000,
      })
    } catch (e) {
      return handleHttpError<T>(this.ctx.logger('triangle:web'), 'GET', path, e)
    }
  }

  private async postJson<T>(
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T | null> {
    try {
      return await this.ctx.http.post<T>(`${this.base}${path}`, body, {
        headers: this.headers(),
        timeout: 5000,
      })
    } catch (e) {
      return handleHttpError<T>(this.ctx.logger('triangle:web'), 'POST', path, e)
    }
  }

  // ─── Binding ───────────────────────────────────────────────────

  bindUser(bindCode: string, qqOpenid: string): Promise<BindUserResp | null> {
    return this.postJson('/api/bot/bind-user', { bindCode, qqOpenid })
  }

  unbindUser(qqOpenid: string): Promise<{ success: boolean } | null> {
    return this.postJson('/api/bot/unbind-user', { qqOpenid })
  }

  bindMission(
    bindCode: string,
    qqGroupOpenid: string,
  ): Promise<BindMissionResp | null> {
    return this.postJson('/api/bot/bind-mission', { bindCode, qqGroupOpenid })
  }

  unbindMission(
    qqGroupOpenid: string,
  ): Promise<{ success: boolean; missionId?: number } | null> {
    return this.postJson('/api/bot/unbind-mission', { qqGroupOpenid })
  }

  // ─── Aptitude sync ─────────────────────────────────────────────

  getAptitudes(
    qqOpenid: string,
    qqGroupOpenid?: string,
  ): Promise<GetAptitudesResp | null> {
    return this.getJson('/api/bot/aptitudes', { qqOpenid, qqGroupOpenid })
  }

  consumeAptitude(
    qqOpenid: string,
    qqGroupOpenid: string | null,
    aptitudeName: string,
    amount: number,
  ): Promise<{ success: boolean } | null> {
    return this.postJson('/api/bot/consume-aptitude', {
      qqOpenid,
      qqGroupOpenid,
      aptitudeName,
      amount,
    })
  }

  /**
   * 花费 / 退还申诫（reprimands）。amount 正数=花费，负数=退还。
   * 4xx（如申诫不足）→ \{ success: false, error \}；5xx / 网络 → null。
   */
  spendReprimands(
    qqOpenid: string,
    qqGroupOpenid: string | null,
    amount: number,
    reason?: string,
  ): Promise<{ success: boolean; balance?: number; error?: string } | null> {
    return this.postJson('/api/bot/spend-reprimands', {
      qqOpenid,
      qqGroupOpenid,
      amount,
      reason,
    })
  }

  setAptitudes(
    qqOpenid: string,
    qqGroupOpenid: string | null,
    aptitudes: Record<string, number>,
  ): Promise<{ success: boolean } | null> {
    return this.postJson('/api/bot/set-aptitudes', {
      qqOpenid,
      qqGroupOpenid,
      aptitudes,
    })
  }

  // ─── Chaos / failure sync ──────────────────────────────────────

  syncChaos(
    qqGroupOpenid: string,
    delta: number,
    reason = '',
  ): Promise<{ success: boolean; chaosValue: number } | null> {
    return this.postJson('/api/bot/sync-chaos', {
      qqGroupOpenid,
      delta,
      reason,
    })
  }

  syncFailure(
    qqGroupOpenid: string,
    delta: number,
  ): Promise<{ success: boolean; failureCount: number } | null> {
    return this.postJson('/api/bot/sync-failure', { qqGroupOpenid, delta })
  }

  syncScatter(
    qqGroupOpenid: string,
    delta: number,
  ): Promise<{ success: boolean; scatterValue: number } | null> {
    return this.postJson('/api/bot/sync-scatter', { qqGroupOpenid, delta })
  }

  // ─── Queries ───────────────────────────────────────────────────

  getCharacterStatus(
    qqOpenid: string,
    qqGroupOpenid?: string,
  ): Promise<CharacterStatusResp | null> {
    return this.getJson('/api/bot/character-status', { qqOpenid, qqGroupOpenid })
  }

  getBindingStatus(qqOpenid: string): Promise<BindingStatusResp | null> {
    return this.getJson('/api/bot/binding-status', { qqOpenid })
  }

  getMissionStatus(qqGroupOpenid: string): Promise<MissionStatusResp | null> {
    return this.getJson('/api/bot/mission-status', { qqGroupOpenid })
  }

  getCharacters(
    qqOpenid: string,
    qqGroupOpenid?: string,
  ): Promise<CharactersResp | null> {
    return this.getJson('/api/bot/characters', { qqOpenid, qqGroupOpenid })
  }

  selectCharacter(
    qqOpenid: string,
    characterId: string | number,
  ): Promise<SelectCharacterResp | null> {
    return this.postJson('/api/bot/select-character', {
      qqOpenid,
      characterId,
    })
  }

  getItemDetail(
    qqOpenid: string,
    qqGroupOpenid: string | null,
    itemName: string,
  ): Promise<ItemDetailResp | null> {
    return this.getJson('/api/bot/item-detail', {
      qqOpenid,
      qqGroupOpenid,
      itemName,
    })
  }

  // ─── Manager role / mission detail / reports ───────────────────

  checkManagerRole(qqOpenid: string): Promise<ManagerRoleResp | null> {
    return this.getJson('/api/bot/check-manager-role', { qqOpenid })
  }

  getMissionDetail(qqGroupOpenid: string): Promise<MissionDetailResp | null> {
    return this.getJson('/api/bot/mission-detail', { qqGroupOpenid })
  }

  getPendingReport(
    qqOpenid: string,
    qqGroupOpenid?: string,
  ): Promise<PendingReportResp | null> {
    return this.getJson('/api/bot/pending-report', { qqOpenid, qqGroupOpenid })
  }

  agentResponse(
    qqOpenid: string,
    qqGroupOpenid: string | null,
    action: 'accept' | 'appeal',
    reason?: string,
  ): Promise<AgentResponseResp | null> {
    const body: Record<string, unknown> = { qqOpenid, action }
    if (qqGroupOpenid) body.qqGroupOpenid = qqGroupOpenid
    if (reason) body.reason = reason
    return this.postJson('/api/bot/agent-response', body)
  }

  getReportStatus(qqGroupOpenid: string): Promise<ReportStatusResp | null> {
    return this.getJson('/api/bot/report-status', { qqGroupOpenid })
  }

  // ─── Dice + Anomalies (reborndevfenUI 新增) ────────────────────

  /**
   * 把骰子结果推到 web 画板。web 端 mission-panel / sheet-v2 通过 socket 'dice:roll' 接收。
   */
  diceRoll(
    qqGroupOpenid: string,
    qqOpenid: string | null,
    label: string,
    total: number | string,
    results: number[],
    type: 'check' | 'normal',
    charNameFallback?: string,
  ): Promise<{ success: boolean; missionId?: number; charName?: string; error?: string } | null> {
    return this.postJson('/api/bot/dice-roll', {
      qqGroupOpenid,
      qqOpenid,
      label,
      total,
      results,
      type,
      charNameFallback,
    })
  }

  /**
   * 拿当前角色的异常能力列表 + 每个异常对应的 9 资质。
   * qualName 为 null 表示资质字段不是 9 资质之一 → koishi 端应当跳过 / 走"常规异常"。
   */
  getCharacterAnomalies(
    qqOpenid: string,
    qqGroupOpenid?: string,
  ): Promise<CharacterAnomaliesResp | null> {
    return this.getJson('/api/bot/character-anomalies', { qqOpenid, qqGroupOpenid })
  }

  /**
   * 查询绑定角色已解锁的高墙文件清单。
   * 4xx（如未绑定 QQ）→ \{ success: false, error \}；5xx / 网络 → null。
   */
  getCharacterHighWalls(
    qqOpenid: string,
    qqGroupOpenid?: string,
  ): Promise<CharacterHighWallsResp | null> {
    return this.getJson('/api/bot/character-high-walls', { qqOpenid, qqGroupOpenid })
  }
}

// ─── Internal helpers ────────────────────────────────────────────

interface ErrLikeLogger {
  warn(msg: string, ...args: unknown[]): void
}

/**
 * 统一处理 ctx.http 抛出的异常。
 *   - 4xx：服务端业务错误，把 \{ error \} 转成 \{ success: false, error \} 透出（不算连接失败）
 *   - 5xx / 网络异常：返回 null（业务层提示"暂时无法连接"）
 */
function handleHttpError<T>(
  log: ErrLikeLogger,
  method: string,
  path: string,
  e: unknown,
): T | null {
  const err = e as {
    response?: { status?: number; data?: unknown }
    message?: string
  }
  const status = err.response?.status
  if (status && status >= 400 && status < 500) {
    const body = err.response?.data
    if (typeof body === 'object' && body) {
      // 透传服务端返回的全部字段（含 archived 等），并补 success:false
      const errorMsg =
        'error' in body ? String((body as { error: unknown }).error) : (err.message ?? '请求失败')
      return { success: false, ...(body as object), error: errorMsg } as unknown as T
    }
    return { success: false, error: err.message ?? '请求失败' } as unknown as T
  }
  log.warn(
    '%s %s failed: status=%s msg=%s',
    method,
    path,
    status ?? 'n/a',
    err.message ?? String(e),
  )
  return null
}

// ─── Response shapes ─────────────────────────────────────────────

export interface BindUserResp {
  success: boolean
  userId?: number
  username?: string
  name?: string
  error?: string
}

export interface BindMissionResp {
  success: boolean
  missionId?: number
  missionName?: string
  error?: string
}

export interface GetAptitudesResp {
  success: boolean
  attrs?: Record<string, unknown>
  characterId?: string | number
  error?: string
  /** 角色卡已归档（机器人不可操作）。 */
  archived?: boolean
}

export interface CharacterStatusResp {
  success: boolean
  character?: {
    id: string | number
    name: string
    anomaly: string
    reality: string
    competency: string
    commendations: number
    reprimands: number
    mvpCount: number
    probationCount: number
    managerName: string | null
    activeMission: { id: number; name: string } | null
    items: Array<{ name: string; effect: string; purchase: string }>
  }
  error?: string
}

export interface BindingStatusResp {
  success: boolean
  bound: boolean
  userId?: number
  username?: string
  name?: string
  error?: string
}

export interface MissionStatusResp {
  success: boolean
  bound: boolean
  missionId?: number
  missionName?: string
  missionStatus?: string
  chaosValue?: number
  failureCount?: number
  error?: string
}

export interface CharactersResp {
  success: boolean
  characters?: Array<{
    id: string | number
    name: string
    anomaly: string
    reality: string
    competency: string
    isActive: boolean
    isMissionMember: boolean
    managerName: string | null
    missionName: string | null
  }>
  error?: string
}

export interface SelectCharacterResp {
  success: boolean
  characterId?: string | number
  characterName?: string
  error?: string
}

export interface ItemDetailResp {
  success: boolean
  items?: Array<{ name: string; effect: string; purchase: string }>
  error?: string
}

export interface ManagerRoleResp {
  success: boolean
  bound: boolean
  isManager?: boolean
  userId?: number
  username?: string
  role?: number
  error?: string
}

export interface MissionDetailResp {
  success: boolean
  mission?: {
    id: number
    name: string
    description: string
    missionType: string
    status: string
    chaosValue: number
    failureCount: number
    scatterValue: number
    creatorName: string
    optionalTasks: unknown[]
    members: Array<{
      characterId: string | number
      characterName: string
      memberStatus: string
      qqOpenid: string | null
    }>
  }
  error?: string
}

export interface PendingReportResp {
  success: boolean
  report: null | {
    reportId: number
    missionName: string
    rating: string
    status: string
    myStatus: string
    myRewards: {
      commend: number
      reprimand: number
      mvp: boolean
      probation: boolean
    }
    allResponses: {
      total: number
      pending: number
      accepted: number
      appealing: number
    }
  }
  message?: string
  error?: string
}

export interface AgentResponseResp {
  success: boolean
  message?: string
  autoFinalized?: boolean
  error?: string
}

export interface ReportStatusResp {
  success: boolean
  hasReport: boolean
  reportStatus?: string
  pendingCount?: number
  appealingCount?: number
  acceptedCount?: number
  allAccepted: boolean
  error?: string
}

export interface CharacterAnomaliesResp {
  success: boolean
  characterId?: string | number
  characterName?: string
  anomalies?: Array<{
    name: string
    qualName: string | null
    trigger: string | null
    trained: boolean
  }>
  error?: string
  /** 角色卡已归档（机器人不可操作）。 */
  archived?: boolean
}

export interface CharacterHighWallsResp {
  success: boolean
  characterId?: string | number
  characterName?: string
  highWalls?: Array<{
    /** 数据库存的文件名，可能是旧格式 "X2.md" 或新格式 "X2 赛风商店.md" */
    filename: string
    /** filename 去掉 .md 后缀，做显示兜底 */
    title: string
    /** high_wall_files 表的 display_name（可能为 null）*/
    displayName: string | null
    description: string | null
    /** high_wall_files.is_active；该 filename 在主表里没有时为 null */
    isActive: boolean | null
  }>
  error?: string
  /** 角色卡已归档（机器人不可操作）。 */
  archived?: boolean
}
