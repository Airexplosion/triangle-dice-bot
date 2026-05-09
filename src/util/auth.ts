import type { Session } from 'koishi'
import type { RoomState } from '../types'

/**
 * 频道场景下被视为管理员的 QQ 角色 id：
 *   "2" = 频道管理员
 *   "4" = 频道创建者
 * （由 QQ 开放平台官方语义决定）
 */
const QQ_GUILD_ADMIN_ROLE_IDS: ReadonlySet<string> = new Set(['2', '4'])

/**
 * 是否管理员。三类来源各自判断：
 *   - 频道 (QQ guild channel)：看 session.author.roles 是否含频道管理 / 创建者角色
 *   - 群 (QQ 群 / 其它平台群)：查 RoomState.admins 是否含当前 playerId
 *   - 私聊：始终 false（管理员命令在私聊不可用，调用方自己拒绝）
 */
export function isAdmin(session: Session, room: RoomState): boolean {
  if (session.isDirect) return false

  if (isQQGuildChannel(session)) {
    const roles = (session.author as unknown as { roles?: string[] })?.roles ?? []
    return roles.some((r) => QQ_GUILD_ADMIN_ROLE_IDS.has(String(r)))
  }

  const playerId = session.userId ?? ''
  return room.admins.includes(playerId)
}

/**
 * 判断 QQ session 是否来自频道。和 util/qq-markdown 里的同名函数语义一致，
 * 抽到这里避免循环依赖。
 */
export function isQQGuildChannel(session: Session): boolean {
  if (session.platform !== 'qq') return false
  if (session.isDirect) return false
  return Boolean(
    session.channelId &&
      session.guildId &&
      session.channelId !== session.guildId,
  )
}
