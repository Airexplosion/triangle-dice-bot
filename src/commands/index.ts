import type { Argv, Context } from 'koishi'
import { HELP_CHECK_SECTION, HELP_PAGES } from '../const'
import { rawRoomIdOf, roomIdOf } from '../room'
import type { LogStore } from '../service/log-store'
import type { PendingAdminApplications, PendingRollStore } from '../service/pending'
import type { RoomStore } from '../service/store'
import type { WebClient } from '../service/web-client'
import { isAdmin } from '../util/auth'
import { sendQQMarkdown, type QQButton } from '../util/qq-markdown'
import { registerAdminCommands } from './admin'
import { normalizeAptitudeCommandContent, registerAptitudeCommand } from './aptitude'
import { registerAuditCommands } from './audit'
import { registerLogCommands } from './log'
import { registerBindCommands } from './bind'
import { registerMigrateCommand } from './migrate'
import { registerMissionCommands } from './mission'
import { registerPostRollCommands } from './post-roll'
import { registerQueryCommands } from './query'
import { registerReportCommands } from './report'
import { characterHasHighWall, registerRollCommands } from './roll'

export interface CommandDeps {
  rooms: RoomStore
  pending: PendingRollStore
  pendingAdmin: PendingAdminApplications
  logs: LogStore
  web: WebClient | null
  /** 是否在 QQ 适配器下走原生 markdown 路径（依赖私域 + 已开通 markdown 权限） */
  useMarkdown: boolean
  /** 审核白名单：允许 /经理审核 /分部审核 的群 openid。 */
  auditGroupIds: string[]
  /** 审核白名单：允许 /经理审核 /分部审核 的用户 openid。 */
  auditUserIds: string[]
}

/** P2/P3/P4 待实现的占位 reply（markdown）。*/
const TODO = (phase: 'P2' | 'P3' | 'P4', name: string) =>
  `> **[${phase} 待实现]** \`${name}\``

/**
 * 本插件认得的所有命令名（含 alias）。前缀 middleware 只剥这些命令前的 `/` 或 `.`，
 * 不影响其它插件的消息分发。
 */
const OUR_COMMAND_NAMES: ReadonlySet<string> = new Set([
  '帮助', '骰点帮助', '菜单',
  '现实修改', '异常能力', '检定',
  '增加成功', '减少成功', '撤回骰点',
  'd8', 'd10调', 'd6调',
  '录入资质',
  '任务属性', '调整属性', '管理面板', '混沌增加', '混沌减少', '失败增加', '失败减少', '散逸增加', '散逸减少',
  '注册管理', '申请管理', '同意管理',
  '绑定', '解绑', '查询绑定', '查询状态', '查询角色卡', '查询资质', '查询异常能力', '查询异常', '查询关系', '查询嘉奖', '查询物品', '查询角色', '切换角色',
  '查看任务', '开始任务', '结束任务', '解绑任务',
  '查看报告', '通过报告', '申诉报告',
  'info', '经理审核', '分部审核',
  'log', '日志',
  'triangle-migrate-json',
])

/**
 * 注册所有命令。命令名沿用 Python 版的中文。
 *
 * 关于前缀：本插件不动 Koishi 全局 prefix 设置；用户若想 `/` `.` 触发，
 * 需要在 Koishi 控制台把 prefix 设为 ['', '/', '.'] 之类的列表。
 * （或在 P2 我们另加一段 middleware 主动剥前缀，等届时确认。）
 */
export function registerCommands(ctx: Context, deps: CommandDeps): void {
  const log = ctx.logger('triangle')
  log.info('registerCommands: 开始注册')

  // 前缀剥离：用户发 `/现实修改 专注` 或 `.现实修改 专注` 时，剥成 `现实修改 专注`
  // 只对我们插件认得的命令名起效，不影响其它插件
  ctx.middleware(async (session, next) => {
    const raw = session.content
    if (typeof raw === 'string') {
      // 兼容 @bot 在前的情况：把开头连续的 < ... > element 占位 + 空白 跳过
      const stripPrefix = raw.replace(/^(?:<[^>]+>|\s)+/g, '')
      if (stripPrefix.startsWith('/') || stripPrefix.startsWith('.')) {
        const cleaned = stripPrefix.slice(1).replace(/^\s+/, '')
        const firstWord = cleaned.split(/\s+/, 1)[0]
        if (firstWord && OUR_COMMAND_NAMES.has(firstWord)) {
          session.content = cleaned
        }
      }
      session.content = normalizeAptitudeCommandContent(session.content ?? '')
    }
    return next()
  }, true /* prepend，确保比命令分发更早跑 */)

  // 统一 reply 入口：QQ 走 raw markdown，其它平台走 session.send（markdown 字符串）
  const md = (mdContent: string, buttons?: QQButton[][]) => async (argv: Argv) => {
    if (!argv.session) return
    await sendQQMarkdown(argv.session, mdContent, {
      enabled: deps.useMarkdown,
      buttons,
    })
  }
  const todoMd = (phase: 'P2' | 'P3' | 'P4', label: string) => md(TODO(phase, label))

  // ========== 主菜单 + help（分页）==========
  // 用户已在 Koishi 控制台禁用 @koishijs/plugin-help，'帮助' 名字可用
  const TOTAL_HELP_PAGES = HELP_PAGES.length
  const buildHelpButtons = (page: number): QQButton[][] => {
    const nav: QQButton[] = []
    if (page > 1) {
      nav.push({ label: '上一页', data: `/帮助 ${page - 1}`, type: 'input', enter: true })
    }
    if (page < TOTAL_HELP_PAGES) {
      nav.push({ label: '下一页', data: `/帮助 ${page + 1}`, primary: true, type: 'input', enter: true })
    }
    const rows: QQButton[][] = []
    if (nav.length) rows.push(nav)
    rows.push([{ label: '操作菜单', data: '/菜单', primary: true, type: 'input', enter: true }])
    return rows
  }

  ctx.command('菜单', '打开常用操作菜单').action(async ({ session }) => {
    if (!session) return

    const rawRoomId = rawRoomIdOf(session)
    const compositeRoomId = roomIdOf(session)
    const userId = session.userId
    const [binding, hasCheck] = await Promise.all([
      deps.web && userId ? deps.web.getBindingStatus(userId) : Promise.resolve(null),
      characterHasHighWall(deps.web, session, 'T3'),
    ])

    let admin = false
    let missionActive = false
    let webMission = false
    let missionName: string | null = null
    if (rawRoomId && compositeRoomId) {
      const room = await deps.rooms.getOrCreate(compositeRoomId, session.platform, rawRoomId)
      admin = isAdmin(session, room)
      missionActive = room.missionActive
      webMission = Boolean(room.missionId)
      missionName = room.missionName
    }

    const bound = Boolean(binding?.bound)
    const lines = ['# 三角机构 · 操作菜单', '']
    lines.push(bound ? `角色卡　**已绑定**` : '角色卡　**未绑定**')
    if (rawRoomId) {
      lines.push(missionActive ? `当前任务　**${missionName ?? '进行中'}**` : '当前任务　**未开始**')
    }
    lines.push('', '> 只显示当前场景可用的主要入口。')

    const buttons: QQButton[][] = []
    if (!session.isDirect) {
      const diceRow: QQButton[] = [
        { label: '现实修改', data: '/现实修改', primary: true, type: 'input', enter: true },
        { label: '异常能力', data: '/异常能力', primary: true, type: 'input', enter: true },
      ]
      if (hasCheck) diceRow.push({ label: '检定', data: '/检定', type: 'input', enter: true })
      buttons.push(diceRow)
    }

    if (bound) {
      buttons.push([
        { label: '角色状态', data: '/查询状态', type: 'input', enter: true },
        { label: '物品背包', data: '/查询物品', type: 'input', enter: true },
        { label: '切换角色', data: '/查询角色', type: 'input', enter: true },
      ])
    } else {
      buttons.push([
        { label: '填写绑定码', data: '绑定 ', type: 'input' },
        { label: '查询绑定', data: '/查询绑定', type: 'input', enter: true },
      ])
    }

    if (rawRoomId) {
      if (missionActive) {
        const taskRow: QQButton[] = []
        if (webMission) taskRow.push({ label: '任务详情', data: '/查看任务', type: 'input', enter: true })
        taskRow.push({ label: '任务属性', data: '/任务属性', type: 'input', enter: true })
        if (bound && webMission) taskRow.push({ label: '任务报告', data: '/查看报告', type: 'input', enter: true })
        buttons.push(taskRow)
      } else if (admin) {
        buttons.push([
          { label: '填写任务绑定码', data: '开始任务 ', type: 'input' },
          { label: '独立任务模式', data: '/开始任务 不使用', type: 'input', enter: true },
        ])
      }
      buttons.push([
        { label: '跑团日志', data: '/log', type: 'input', enter: true },
        { label: '更多说明', data: '/帮助 1', type: 'input', enter: true },
      ])
    } else {
      buttons.push([{ label: '更多说明', data: '/帮助 1', type: 'input', enter: true }])
    }

    if (admin) {
      buttons.push([{ label: '经理面板', data: '/管理面板', type: 'input', enter: true }])
    }

    await sendQQMarkdown(session, lines.join('\n'), {
      enabled: deps.useMarkdown,
      buttons,
    })
  })

  ctx
    .command('帮助 [page:string]')
    .alias('骰点帮助')
    .action(async (argv, page) => {
      if (!argv.session) return
      const n = Number.parseInt((page ?? '1').trim(), 10)
      const cur = Number.isNaN(n) ? 1 : Math.max(1, Math.min(n, TOTAL_HELP_PAGES))
      let content = HELP_PAGES[cur - 1]
      // 检定（T3）仅对已解锁角色，在第 1 页底部追加
      if (cur === 1 && (await characterHasHighWall(deps.web, argv.session, 'T3'))) {
        content += `\n\n\n${HELP_CHECK_SECTION}`
      }
      await sendQQMarkdown(argv.session, content, {
        enabled: deps.useMarkdown,
        buttons: buildHelpButtons(cur),
      })
    })

  // ========== P2: 骰点核心（已实装，群+任务场景下自动 sync 到 web） ==========
  registerRollCommands(ctx, {
    rooms: deps.rooms,
    pending: deps.pending,
    web: deps.web,
    useMarkdown: deps.useMarkdown,
  })
  registerPostRollCommands(ctx, {
    rooms: deps.rooms,
    pending: deps.pending,
    web: deps.web,
    useMarkdown: deps.useMarkdown,
  })
  registerAptitudeCommand(ctx, {
    rooms: deps.rooms,
    web: deps.web,
    useMarkdown: deps.useMarkdown,
  })

  // ========== P3: 管理 + 鉴权（已实装） ==========
  // pending 申请已持久化到 RoomState.pendingAdminApplicant，不再用内存 PendingAdminApplications
  registerAdminCommands(ctx, {
    rooms: deps.rooms,
    web: deps.web,
    useMarkdown: deps.useMarkdown,
  })

  // ========== P4: 角色卡 / 任务 / 报告（已实装） ==========
  registerBindCommands(ctx, { web: deps.web, useMarkdown: deps.useMarkdown })
  registerQueryCommands(ctx, { web: deps.web, useMarkdown: deps.useMarkdown })
  registerMissionCommands(ctx, {
    web: deps.web,
    rooms: deps.rooms,
    useMarkdown: deps.useMarkdown,
  })
  registerReportCommands(ctx, { web: deps.web, useMarkdown: deps.useMarkdown })

  // ========== 超管审核（/info /经理审核 /分部审核）==========
  registerAuditCommands(ctx, {
    web: deps.web,
    useMarkdown: deps.useMarkdown,
    auditGroupIds: deps.auditGroupIds,
    auditUserIds: deps.auditUserIds,
  })

  // ========== 跑团日志（/log）==========
  registerLogCommands(ctx, {
    store: deps.logs,
    web: deps.web,
    useMarkdown: deps.useMarkdown,
  })

  // ========== 维护命令：JSON → DB 一次性迁移 ==========
  registerMigrateCommand(ctx, deps)

  log.info('registerCommands: 全部注册完成')

  // 抑制未使用变量告警（deps 在 P2+ 才会被各命令真正使用）
  void deps
}
