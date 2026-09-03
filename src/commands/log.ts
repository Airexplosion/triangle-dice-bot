import type { Context, Session } from 'koishi'
import { rawRoomIdOf, roomIdOf } from '../room'
import type { LineKind, LogStore, TriangleLogRow } from '../service/log-store'
import type { WebClient } from '../service/web-client'
import { NETWORK_ERROR_BLOCK } from '../util/messages'
import { sendQQMarkdown, setBotMessageHook, type QQButton } from '../util/qq-markdown'

/**
 * 外部转接层（onebot-bridge）补记日志的回调签名。
 * 返回 true = 已写入；false = 该房间未在录制 / 内容为空 / 写入失败。
 */
export type ExternalLogRecorder = (
  roomId: string,
  extName: string,
  content: string,
  kind?: LineKind,
) => boolean

declare global {
  /**
   * 由本插件注册、供 koishi-plugin-onebot-bridge 调用的全局钩子。
   * 桥接层是 `typeof rec === 'function'` 的软判断，未注册时静默跳过 ——
   * 正因如此，它失效时不会报错，只是日志里悄悄少了骰点结果。
   */
  // eslint-disable-next-line no-var
  var __triangleLogRecordExternal: ExternalLogRecorder | undefined
}

export interface LogDeps {
  store: LogStore
  web: WebClient | null
  useMarkdown: boolean
  /** 该群是否已被观察到收到过普通发言（→ 已开启全量消息）。undefined 视为不检查。 */
  hasSeenFreeMessage?: (roomId: string) => boolean
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
/**
 * 构造「外部日志记录器」。
 *
 * 外部 OneBot 桥（red）的回复走 bridge 里的 `bot.internal.sendMessage`，绕过了
 * `sendQQMarkdown`，所以捕获 1 的钩子拿不到它们（`.rd` 就属于这一类：指令被转发
 * 给外部骰子服务，结果再由 bridge 直接发出）。bridge 转而调用本函数产出的全局钩子，
 * 把结果补记进跑团日志。
 *
 * 抽成独立工厂函数（而非内联在 registerLogCommands 里）是为了能在不 mock 整个
 * Context 的前提下做单元测试 —— 见 tests/external-log.test.ts。该测试同时盯住
 * 「注册」那一步：这段逻辑此前只存在于 lib/ 的编译产物中，源码里并没有，
 * 一次 `npm run build` 就被 tsc 覆盖，导致骰点结果长期静默不入日志。
 */
export function createExternalLogRecorder(store: LogStore): ExternalLogRecorder {
  return (roomId, extName, content, kind = 'bot') => {
    try {
      if (!roomId) return false
      const logId = store.recordingLogId(roomId)
      if (logId === undefined) return false
      const text = stripMarkdown(String(content ?? ''))
      if (!text) return false
      void store
        .appendLine({
          logId,
          time: new Date(),
          senderId: 'onebot',
          senderName: extName || '红',
          kind,
          content: text,
        })
        .catch(() => {})
      return true
    } catch {
      return false
    }
  }
}

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

  // ── 捕获 3：外部 OneBot 桥（red）发出的消息 —— 全局钩子 ──
  // roomId 约定 `qq:${group_openid}`，与 room.ts 的 roomIdOf 输出一致。
  const externalRecorder = createExternalLogRecorder(store)
  globalThis.__triangleLogRecordExternal = externalRecorder
  ctx.on('dispose', () => {
    // 插件卸载/热重载时撤下钩子，避免桥接层继续往已销毁的 store 写
    if (globalThis.__triangleLogRecordExternal === externalRecorder) {
      globalThis.__triangleLogRecordExternal = undefined
    }
  })

  // ── 捕获 2：群内人类发言 —— 中间件 ──
  ctx.middleware(async (session, next) => {
    try {
      const roomId = roomIdOf(session)
      if (roomId && store.recordingLogId(roomId) !== undefined && !isLogCommand(session.content)) {
        let text = cleanContent(session.content ?? '')
        if (text) {
          // 趁 QQ 图片 rkey 还新鲜，立刻把图片转存到 COS（否则导出/查看时已失效）
          if (deps.web && text.includes('[[img:')) text = await rehostImages(deps, text)
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

      // 强制变体：跳过「消息全部开放」前置检查（由警告里的按钮触发）
      const forced = action === '强制新建' || action === '强制继续'
      const effAction = action === '强制新建' ? 'new' : action === '强制继续' ? 'on' : action
      // 未观察到本群收到过普通发言 → 判定可能未开启全量消息
      const messagesClosed = (): boolean =>
        typeof deps.hasSeenFreeMessage === 'function' && !deps.hasSeenFreeMessage(roomId)

      switch (effAction) {
        case '':
        case 'status':
        case '状态':
          return showStatus(session, deps, roomId)

        case 'new':
        case '新建': {
          const logName = name || autoName()
          if (!forced && messagesClosed()) return warnMessagesClosed(session, deps, 'new', logName)
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
            [`# 日志已开始`, '', `名称　**${logName}**`, '', '此后本群发言与骰点都会被记录。', '`/log off` 暂停 · `/log end` 结束并出链接'].join('\n'),
            logButtons('recording'),
          )
        }

        case 'on':
        case 'start':
        case '开始':
        case '继续': {
          if (!forced && messagesClosed()) return warnMessagesClosed(session, deps, 'on', name)
          const r = await store.resume(roomId, name || undefined)
          if (!r.ok) return reply(session, deps, `> ${r.reason}`)
          return reply(session, deps, `> 已开始记录日志「${r.row?.name}」。`, logButtons('recording'))
        }

        case 'off':
        case 'pause':
        case '暂停': {
          const row = await store.pause(roomId)
          if (!row) return reply(session, deps, '> 当前没有正在记录的日志。')
          return reply(
            session,
            deps,
            `> 已暂停日志「${row.name}」。`,
            logButtons('paused'),
          )
        }

        case 'end':
        case 'stop':
        case '结束': {
          const current = await store.current(roomId)
          if (!current) return reply(session, deps, '> 当前没有进行中的日志。', logButtons('inactive'))
          if (name !== '确认') {
            return reply(
              session,
              deps,
              `# 确认结束日志？\n\n日志　**${current.name}**\n\n> 结束后不能继续追加记录。`,
              [[
                { label: '确认结束并生成链接', data: '/log end 确认', type: 'input', enter: true },
                { label: '返回日志状态', data: '/log', primary: true, type: 'input', enter: true },
              ]],
            )
          }
          const row = await store.end(roomId)
          if (!row) return reply(session, deps, '> 当前没有进行中的日志。', logButtons('inactive'))
          const link = await uploadAndLink(deps, groupId, row)
          if (!link) {
            return reply(
              session,
              deps,
              `> 日志「${row.name}」已结束，但上传染色页失败（网络/服务）。可稍后 \`/log get ${row.name}\` 重试。`,
              logButtons('inactive'),
            )
          }
          return reply(
            session,
            deps,
            [`# 日志已结束`, '', `名称　**${row.name}**`, '', `染色回放：`, link].join('\n'),
            logButtons('inactive'),
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
            return reply(
              session,
              deps,
              [`# ${row.name}`, '', `染色回放：`, row.url].join('\n'),
              [[
                { label: '日志列表', data: '/log list', type: 'input', enter: true },
                { label: '操作菜单', data: '/菜单', type: 'input', enter: true },
              ]],
            )
          }
          const link = await uploadAndLink(deps, groupId, row)
          if (!link) return reply(session, deps, NETWORK_ERROR_BLOCK)
          return reply(session, deps, [`# ${row.name}`, '', `染色回放：`, link].join('\n'), [[
            { label: '日志列表', data: '/log list', type: 'input', enter: true },
            { label: '操作菜单', data: '/菜单', type: 'input', enter: true },
          ]])
        }

        case 'list':
        case '列表': {
          const all = await store.list(roomId)
          if (!all.length) return reply(session, deps, '> 本群还没有任何日志。', logButtons('inactive'))
          const lines = ['# 本群日志', '']
          for (const r of all.slice(0, 15)) {
            lines.push(`· **${r.name}**　${statusLabel(r.status)}${r.url ? ' · 有链接' : ''}`)
          }
          if (all.length > 15) lines.push(`…… 共 ${all.length} 份`)
          const current = await store.current(roomId)
          return reply(session, deps, lines.join('\n'), logButtons(current?.status ?? 'inactive'))
        }

        case 'del':
        case 'delete':
        case '删除': {
          if (!name) return reply(session, deps, '> 用法：`/log del <日志名>`')
          const ok = await store.remove(roomId, name)
          return reply(session, deps, ok ? `> 已删除日志「${name}」。` : `> 没找到名为「${name}」的日志。`)
        }

        default:
          return reply(session, deps, helpText(), logButtons('inactive'))
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
    return reply(session, deps, helpText(), logButtons('inactive'))
  }
  const n = await deps.store.countLines(cur.id)
  await reply(
    session,
    deps,
    [
      `# 当前日志`,
      '',
      `名称　**${cur.name}**`,
      `状态　**${statusLabel(cur.status)}**`,
      `已记录　**${n}** 条`,
      '',
      cur.status === 'recording' ? '`/log off` 暂停 · `/log end` 结束' : '`/log on` 继续 · `/log end` 结束',
    ].join('\n'),
    logButtons(cur.status),
  )
}

function logButtons(status: 'recording' | 'paused' | 'ended' | 'inactive'): QQButton[][] {
  if (status === 'recording') {
    return [[
      { label: '暂停记录', data: '/log off', primary: true, type: 'input', enter: true },
      { label: '结束并生成链接', data: '/log end', type: 'input', enter: true },
      { label: '日志列表', data: '/log list', type: 'input', enter: true },
    ]]
  }
  if (status === 'paused') {
    return [[
      { label: '继续记录', data: '/log on', primary: true, type: 'input', enter: true },
      { label: '结束并生成链接', data: '/log end', type: 'input', enter: true },
      { label: '日志列表', data: '/log list', type: 'input', enter: true },
    ]]
  }
  return [[
    { label: '快速新建', data: '/log new', primary: true, type: 'input', enter: true },
    { label: '命名新建', data: '/log new ', type: 'input' },
    { label: '日志列表', data: '/log list', type: 'input', enter: true },
  ]]
}

function helpText(): string {
  return [
    '# 跑团日志',
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

/** 把文本里的 QQ 图片 URL 逐个转存到 COS，替换成永久链接（失败保留原 URL）。 */
async function rehostImages(deps: LogDeps, text: string): Promise<string> {
  const urls = new Set<string>()
  const re = /\[\[img:(.*?)\]\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) urls.add(m[1])
  for (const u of urls) {
    if (!u || u.startsWith('/') || /myqcloud\.com/.test(u)) continue // 已是本地/COS，跳过
    try {
      const r = await deps.web!.fetchLogImage(u)
      if (r?.success && r.localUrl) text = text.split(`[[img:${u}]]`).join(`[[img:${r.localUrl}]]`)
    } catch {
      /* 转存失败保留原 URL */
    }
  }
  return text
}

/** 是否是 /log 管理命令本身（避免把命令记进日志）。 */
function isLogCommand(content: string | undefined): boolean {
  if (!content) return false
  const stripped = content.replace(/^(?:<[^>]+>|\s)+/g, '').replace(/^[/.]/, '').trimStart()
  return /^log(\s|$)/i.test(stripped) || /^日志(\s|$)/.test(stripped)
}

/** 把 session.content 清成可读纯文本：图片→[图片]，去掉其它 element 标签。 */
function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x2[Ff];/g, '/')
    .replace(/&amp;/g, '&') // 必须最后解码，否则 &amp;lt; 会被二次解码
}

function cleanContent(content: string): string {
  return content
    // 保留图片 URL（解码 &amp; 等实体，否则 URL 参数损坏导致拉取失败）
    .replace(/<img\b[^>]*?\b(?:src|url)="([^"]*)"[^>]*>/gi, (_m, u) => `[[img:${decodeEntities(u)}]]`)
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

/** 「消息全部开放」未开启时的拦截提示 + 强制开始按钮。 */
function warnMessagesClosed(
  session: Session,
  deps: LogDeps,
  kind: 'new' | 'on',
  name: string,
): Promise<void> {
  const sub = kind === 'new' ? '强制新建' : '强制继续'
  const forceData = `/log ${sub}${name ? ' ' + name : ''}`
  return reply(
    session,
    deps,
    [
      '# 暂时无法开始日志',
      '',
      '检测到本群**可能未开启「消息全部开放」**。',
      '',
      '机器人当前收不到群内普通发言，日志只能记到 @机器人 的消息和骰点结果，**无法完整记录跑团过程**。',
      '',
      '**请群主操作**：QQ 群设置 → 机器人 / 消息接收，给本机器人开启「接收全部消息 / 消息列表」权限，然后重试。',
      '',
      '> 若你确认已开启（或本群刚建、暂时无人发言导致误判），可点下方按钮强制开始。',
    ].join('\n'),
    [
      [
        { label: '我已开启，强制开始', data: forceData, primary: true, type: 'input', enter: true },
        { label: '返回', data: '/log', type: 'input', enter: true },
      ],
    ],
  )
}

async function reply(
  session: Session,
  deps: LogDeps,
  content: string,
  buttons?: QQButton[][],
): Promise<void> {
  await sendQQMarkdown(session, content, { enabled: deps.useMarkdown, buttons })
}
