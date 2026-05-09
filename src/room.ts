import type { Session } from 'koishi'

/**
 * 把 Koishi Session 归一化成 roomId。
 * - 私聊（C2C/DM）→ null（骰点命令不可用）
 * - 频道/群 → `${platform}:${guildId or channelId}`
 *
 * 频道场景 Koishi 的 session.guildId 即 QQ 频道的 channel_id；
 * QQ 群场景 session.guildId 即 group_openid。
 * 二者作为同一份"房间"处理，只是鉴权方式不同。
 */
export function roomIdOf(session: Session): string | null {
  if (session.isDirect) return null
  const raw = session.guildId ?? session.channelId
  if (!raw) return null
  return `${session.platform}:${raw}`
}

export function rawRoomIdOf(session: Session): string | null {
  if (session.isDirect) return null
  return session.guildId ?? session.channelId ?? null
}

/**
 * 判断当前来源是 QQ 频道还是 QQ 群。
 * adapter-qq 暂时通过 event 区分；保留对其它适配器的兼容。
 *
 * NOTE(P1 待验证)：adapter-qq 在频道/群两种场景下 session 字段差异
 * 需要在第一阶段联调时实测确认。届时根据实际情况修正本函数。
 */
export function isQQGuildChannel(session: Session): boolean {
  if (session.platform !== 'qq') return false
  // 频道场景下 session.event.channel 通常存在；群场景下则没有 channel 概念
  // 暂用 channelId 与 guildId 是否相等做近似判断
  return Boolean(session.channelId && session.channelId !== session.guildId)
}
