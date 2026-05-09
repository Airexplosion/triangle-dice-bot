import type { Context } from 'koishi'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { APTITUDE_NAMES } from '../const'
import type { RoomState } from '../types'
import type { CommandDeps } from './index'

/**
 * 一次性迁移命令：从 Python 版 data/rooms/*.json 读取并 upsert 到 triangle_room 表。
 *
 * 用法（在 Koishi 控制台 / 命令行触发）：
 *   triangle-migrate-json <data/rooms 目录绝对路径> [platform=qq]
 *
 * 例：
 *   triangle-migrate-json F:\桌面\claude 项目与\QQ机器人\triangle-dice-bot\qq-bot\data\rooms qq
 *
 * 注：rawRoomId 无法从 JSON 直接还原（旧版把 / \ 替换成了 _），所以将其视作不可逆，
 * 把文件名 stem 同时填入 roomId 和 rawRoomId；platform 默认 'qq'。
 * 若你的旧数据混了多平台，可先把目录按平台分开再多次执行。
 */
export function registerMigrateCommand(ctx: Context, deps: CommandDeps): void {
  ctx
    .command(
      'triangle-migrate-json <dir:text>',
      '从 Python 版 data/rooms/*.json 一次性导入到数据库',
      { authority: 4 },
    )
    .option('platform', '-p <platform:string>  默认 qq')
    .option('dryRun', '-n  仅扫描不写库')
    .action(async ({ options }, dir) => {
      if (!dir) return '用法: triangle-migrate-json <data/rooms 目录绝对路径>'

      const platform = options?.platform ?? 'qq'
      const dryRun = options?.dryRun ?? false

      let entries: string[]
      try {
        entries = await fs.readdir(dir)
      } catch (e) {
        return `无法读取目录: ${dir}\n${(e as Error).message}`
      }

      const jsonFiles = entries.filter((f) => f.endsWith('.json'))
      if (jsonFiles.length === 0) return `目录中没有 .json 文件: ${dir}`

      const summary: string[] = [
        `扫描到 ${jsonFiles.length} 个房间文件`,
        `platform=${platform}, dryRun=${dryRun}`,
        '',
      ]
      let ok = 0
      let failed = 0

      for (const file of jsonFiles) {
        const fullPath = path.join(dir, file)
        const rawRoomId = file.replace(/\.json$/, '')
        const roomId = `${platform}:${rawRoomId}`
        try {
          const raw = await fs.readFile(fullPath, 'utf-8')
          const data = JSON.parse(raw) as Record<string, unknown>
          const state = pythonRoomToState(data, roomId, rawRoomId, platform)
          if (!dryRun) {
            await deps.rooms.update(roomId, platform, rawRoomId, (existing) => {
              Object.assign(existing, state, { roomId, rawRoomId, platform })
            })
          }
          summary.push(
            `✓ ${rawRoomId}  chaos=${state.chaosPool} fail=${state.failureCount} ` +
              `players=${Object.keys(state.players).length} admins=${state.admins.length}`,
          )
          ok++
        } catch (e) {
          summary.push(`✗ ${file}: ${(e as Error).message}`)
          failed++
        }
      }

      summary.push('', `完成：成功 ${ok} 失败 ${failed}`)
      return summary.join('\n')
    })
}

function pythonRoomToState(
  data: Record<string, unknown>,
  roomId: string,
  rawRoomId: string,
  platform: string,
): RoomState {
  const players: RoomState['players'] = {}
  const rawPlayers = (data.players as Record<string, unknown>) ?? {}
  for (const [pid, pdata] of Object.entries(rawPlayers)) {
    const p = pdata as Record<string, unknown>
    const aptitudes: Record<string, number> = {}
    for (const name of APTITUDE_NAMES) aptitudes[name] = 0
    const rawApt = (p?.aptitudes as Record<string, unknown>) ?? {}
    for (const [k, v] of Object.entries(rawApt)) {
      if (typeof v === 'number') aptitudes[k] = v
    }
    players[pid] = { playerId: String(p?.player_id ?? pid), aptitudes }
  }

  return {
    roomId,
    rawRoomId,
    platform,
    chaosPool: numberOr(data.chaos_pool, 0),
    failureCount: numberOr(data.failure_count, 0),
    scatterValue: numberOr(data.scatter_value, 0),
    players,
    admins: stringListOr(data.admins, []),
    missionActive: Boolean(data.mission_active),
    missionId: stringOrNull(data.mission_id),
    missionName: stringOrNull(data.mission_name),
    missionMembers: stringListOr(data.mission_members, []),
    pendingAdminApplicant: null,
    updatedAt: new Date(),
  }
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function stringOrNull(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function stringListOr(v: unknown, fallback: string[]): string[] {
  if (!Array.isArray(v)) return fallback
  return v.filter((x): x is string => typeof x === 'string')
}
