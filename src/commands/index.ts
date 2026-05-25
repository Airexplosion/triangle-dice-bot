import type { Argv, Context } from 'koishi'
import { HELP_TEXT } from '../const'
import type { PendingAdminApplications, PendingRollStore } from '../service/pending'
import type { RoomStore } from '../service/store'
import type { WebClient } from '../service/web-client'
import { sendQQMarkdown, type QQButton } from '../util/qq-markdown'
import { registerAdminCommands } from './admin'
import { registerAptitudeCommand } from './aptitude'
import { registerBindCommands } from './bind'
import { registerMigrateCommand } from './migrate'
import { registerMissionCommands } from './mission'
import { registerPostRollCommands } from './post-roll'
import { registerQueryCommands } from './query'
import { registerReportCommands } from './report'
import { registerRollCommands } from './roll'

export interface CommandDeps {
  rooms: RoomStore
  pending: PendingRollStore
  pendingAdmin: PendingAdminApplications
  web: WebClient | null
  /** 是否在 QQ 适配器下走原生 markdown 路径（依赖私域 + 已开通 markdown 权限） */
  useMarkdown: boolean
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
  '现实修改', '异常能力',
  '增加成功', '减少成功', '撤回骰点',
  '录入资质',
  '任务属性', '混沌增加', '混沌减少', '失败增加', '失败减少', '散逸增加', '散逸减少',
  '注册管理', '申请管理', '同意管理',
  '绑定', '解绑', '查询绑定', '查询状态', '查询嘉奖', '查询物品', '查询角色', '切换角色',
  '查看任务', '开始任务', '结束任务', '解绑任务',
  '查看报告', '通过报告', '申诉报告',
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

  // ========== help ==========
  // 用户已在 Koishi 控制台禁用 @koishijs/plugin-help，'帮助' 名字可用
  const helpButtons: QQButton[][] = [
    [
      { label: '查看任务', data: '查看任务' },
      { label: '查询角色', data: '查询角色' },
      { label: '查询状态', data: '查询状态' },
    ],
  ]
  ctx
    .command('帮助')
    .alias('骰点帮助', '菜单')
    .action(md(HELP_TEXT, helpButtons))

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

  // ========== 维护命令：JSON → DB 一次性迁移 ==========
  registerMigrateCommand(ctx, deps)

  log.info('registerCommands: 全部注册完成')

  // 抑制未使用变量告警（deps 在 P2+ 才会被各命令真正使用）
  void deps
}
