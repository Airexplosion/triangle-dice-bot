import type { Context, Session } from 'koishi'
import { rawRoomIdOf, roomIdOf } from '../room'
import type { LogStore, TriangleLogRow } from '../service/log-store'
import type { WebClient } from '../service/web-client'
import { NETWORK_ERROR_BLOCK } from '../util/messages'
import { sendQQMarkdown, setBotMessageHook, type QQButton } from '../util/qq-markdown'

export interface LogDeps {
  store: LogStore
  web: WebClient | null
  useMarkdown: boolean
}

/**
 * 跑团日志（/log）功能。仿海豹核心：
 *   /log new [名]   新建并开始记录
 *   /log on [名]    开始 / 切换 / 续记
 *   /log off        暂停
 *   /log end        结束并上传染色页，返回链接
 *   /log get [名]   重新获取染色链接
 *   /log list       列出本群日志
 *   /log del <名>   删除
 * 记录范围：日志录制期间群内所有发言 + 机器人回复（含骰点结果）。
 * 权限：群内任何人（跑团惯例）。
 */
export function registerLogCommands(ctx: Context, deps: LogDeps): void {
  const { store } = deps

  // ── 捕获 1：机器人回复（含骰点结果）—— 经 sendQQMarkdown 钩子 ──
  setBotMessageHook((session, content) => {
    const roomId = roomIdOf(session)
    if (!roomId || store.recordingLogId(roomId) === undefined) return
    const logId = store.recordingLogId(roomId)!
    void store
      .appendLine({
        logId,
        time: new Date(),
        senderId: session.selfId ?? 'bot',
        senderName: '三角机构',
        kind: 'bot',
        content: stripMarkdown(content),
      })
      .catch(() => {})
  })

  // ── 捕获 2：群内人类发言 —— 中间件 ──
  ctx.middleware(async (session, next) => {
    try {
      const roomId = roomIdOf(session)
      if (roomId && store.recordingLogId(roomId) !== undefined && !isLogCommand(session.content)) {
        const text = cleanContent(session.content ?? '')
        if (text) {
          await store.appendLine({
            logId: store.recordingLogId(roomId)!,
            time: new Date(),
            senderId: session.userId ?? '?',
            senderName: senderName(session),
            kind: 'msg',
            content: text,
          })
        }
      }
    } catch {
      /* 捕获失败不影响消息分发 */
    }
    return next()
  })

  // ── /log 命令 ──
  ctx.command('log [sub:string] [arg:text]', '跑团日志记录').action(
    async ({ session }, sub, arg) => {
      if (!session) return
      if (session.isDirect) return reply(session, deps, '> 日志功能仅群内可用。')
      const roomId = roomIdOf(session)
      const groupId = rawRoomIdOf(session)
      if (!roomId || !groupId) return reply(session, deps, '> 无法定位当前群。')
      const name = (arg ?? '').trim()
      const action = (sub ?? '').trim().toLowerCase()

      switch (action) {
        case '':
        case 'status':
        case '状态':
          return showStatus(session, deps, roomId)

        case 'new':
        case '新建': {
          const logName = name || autoName()
          const row = await store.create(roomId, logName)
          if (!row) {
            const cur = await store.current(roomId)
            return reply(
              session,
              deps,
              `> 已有进行中的日志「${cur?.name}」。先 \`/log end\` 结束，或 \`/log off\` 暂停。`,
            )
          }
          return reply(
            session,
            deps,
            [`# 📓 日志已开始`, '', `名称　**${logName}**`, '', '此后本群发言与骰点都会被记录。', '`/log off` 暂停 · `/log end` 结束并出链接'].join('\n'),
          )
        }

        case 'on':
        case 'start':
        case '开始':
        case '继续': {
          const r = await store.resume(roomId, name || undefined)
          if (!r.ok) return reply(session, deps, `> ${r.reason}`)
          return reply(session, deps, `> ▶️ 已开始记录日志「${r.row?.name}」。`)
        }

        case 'off':
        case 'pause':
        case '暂停': {
          const row = await store.pause(roomId)
          if (!row) return reply(session, deps, '> 当前没有正在记录的日志。')
          return reply(session, deps, `> ⏸️ 已暂停日志「${row.name}」。\`/log on\` 继续 · \`/log end\` 结束。`)
        }

        case 'end':
        case 'stop':
        case '结束': {
          const row = await store.end(roomId)
          if (!row) return reply(session, deps, '> 当前没有进行中的日志。')
          const link = await uploadAndLink(deps, groupId, row)
          if (!link) {
            return reply(
              session,
              deps,
              `> ⏹️ 日志「${row.name}」已结束，但上传染色页失败（网络/服务）。可稍后 \`/log get ${row.name}\` 重试。`,
            )
          }
          return reply(
            session,
            deps,
            [`# ⏹️ 日志已结束`, '', `名称　**${row.name}**`, '', `染色回放：`, link].join('\n'),
          )
        }

        case 'get':
        case '获取':
        case '链接': {
          let row = name ? await store.findByName(roomId, name) : await store.current(roomId)
          if (!row && !name) {
            // 无当前日志时取最近一份
            const all = await store.list(roomId)
            row = all[0] ?? null
          }
          if (!row) return reply(session, deps, '> 没找到日志。用 `/log list` 查看本群日志。')
          if (row.url) {
            return reply(session, deps, [`# 📓 ${row.name}`, '', `染色回放：`, row.url].join('\n'))
          }
          const link = await uploadAndLink(deps, groupId, row)
          if (!link) return reply(session, deps, NETWORK_ERROR_BLOCK)
          return reply(session, deps, [`# 📓 ${row.name}`, '', `染色回放：`, link].join('\n'))
        }

        case 'list':
        case '列表': {
          const all = await store.list(roomId)
          if (!all.length) return reply(session, deps, '> 本群还没有任何日志。`/log new` 开始一份。')
          const lines = ['# 📚 本群日志', '']
          for (const r of all.slice(0, 15)) {
            lines.push(`· **${r.name}**　${statusLabel(r.status)}${r.url ? ' · 有链接' : ''}`)
          }
          if (all.length > 15) lines.push(`…… 共 ${all.length} 份`)
          return reply(session, deps, lines.join('\n'))
        }

        case 'del':
        case 'delete':
        case '删除': {
          if (!name) return reply(session, deps, '> 用法：`/log del <日志名>`')
          const ok = await store.remove(roomId, name)
          return reply(session, deps, ok ? `> 🗑️ 已删除日志「${name}」。` : `> 没找到名为「${name}」的日志。`)
        }

        default:
          return reply(session, deps, helpText())
      }
    },
  )
}

// ─── 上传染色页 ───────────────────────────────────────────────────

async function uploadAndLink(
  deps: LogDeps,
  groupId: string,
  row: TriangleLogRow,
): Promise<string | null> {
  if (!deps.web) return null
  const lines = await deps.store.getLines(row.id)
  const r = await deps.web.uploadLog({
    token: row.url ? row.url.split('/').pop() : undefined,
    groupId,
    name: row.name,
    lines: lines.map((l) => ({
      t: +new Date(l.time),
      who: l.senderName,
      sid: l.senderId,
      kind: l.kind,
      text: l.content,
    })),
  })
  if (r?.success && r.url) {
    await deps.store.setUrl(row.id, r.url)
    return r.url
  }
  return null
}

// ─── 展示 ─────────────────────────────────────────────────────────

async function showStatus(session: Session, deps: LogDeps, roomId: string): Promise<void> {
  const cur = await deps.store.current(roomId)
  if (!cur) {
    return reply(session, deps, helpText())
  }
  const n = await deps.store.countLines(cur.id)
  await reply(
    session,
    deps,
    [
      `# 📓 当前日志`,
      '',
      `名称　**${cur.name}**`,
      `状态　**${statusLabel(cur.status)}**`,
      `已记录　**${n}** 条`,
      '',
      cur.status === 'recording' ? '`/log off` 暂停 · `/log end` 结束' : '`/log on` 继续 · `/log end` 结束',
    ].join('\n'),
  )
}

function helpText(): string {
  return [
    '# 📓 跑团日志',
    '',
    '`/log new [名]`　新建并开始记录',
    '`/log on [名]`　开始 / 续记',
    '`/log off`　暂停',
    '`/log end`　结束并生成染色链接',
    '`/log get [名]`　重新获取链接',
    '`/log list`　本群所有日志',
    '`/log del <名>`　删除',
  ].join('\n')
}

function statusLabel(s: string): string {
  return { recording: '记录中', paused: '已暂停', ended: '已结束' }[s] ?? s
}

// ─── 工具 ─────────────────────────────────────────────────────────

/** 是否是 /log 管理命令本身（避免把命令记进日志）。 */
function isLogCommand(content: string | undefined): boolean {
  if (!content) return false
  const stripped = content.replace(/^(?:<[^>]+>|\s)+/g, '').replace(/^[/.]/, '').trimStart()
  return /^log(\s|$)/i.test(stripped) || /^日志(\s|$)/.test(stripped)
}

/** 把 session.content 清成可读纯文本：图片→[图片]，去掉其它 element 标签。 */
function cleanContent(content: string): string {
  return content
    .replace(/<img[^>]*\/?>/gi, '[图片]')
    .replace(/<audio[^>]*\/?>/gi, '[语音]')
    .replace(/<video[^>]*\/?>/gi, '[视频]')
    .replace(/<face[^>]*\/?>/gi, '[表情]')
    .replace(/<at[^>]*name="([^"]*)"[^>]*\/?>/gi, '@$1')
    .replace(/<at[^>]*\/?>/gi, '@某人')
    .replace(/<[^>]+>/g, '')
    .trim()
}

/** 机器人 markdown 回复转成日志里的可读纯文本（轻度去标记）。 */
function stripMarkdown(content: string): string {
  return content
    .split('\n')
    .map((line) =>
      line
        .replace(/^#+\s*/, '')
        .replace(/^>\s?/, '')
        .replace(/\*\*/g, '')
        .replace(/`/g, ''),
    )
    .join('\n')
    .trim()
}

/** 取发言人显示名：QQ 群昵称/名 → 用户名 → 短码。 */
function senderName(session: Session): string {
  const a = session.author as { nick?: string; name?: string; nickname?: string } | undefined
  return (
    a?.nick ||
    a?.nickname ||
    a?.name ||
    session.username ||
    `#${(session.userId ?? '').slice(-6).toUpperCase()}`
  )
}

function autoName(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `跑团-${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

async function reply(
  session: Session,
  deps: LogDeps,
  content: string,
  buttons?: QQButton[][],
): Promise<void> {
  await sendQQMarkdown(session, content, { enabled: deps.useMarkdown, buttons })
}
