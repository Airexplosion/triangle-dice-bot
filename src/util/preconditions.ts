import type { Session } from 'koishi'
import { rawRoomIdOf } from '../room'
import type { WebClient } from '../service/web-client'
import {
  GROUP_ONLY,
  NETWORK_ERROR_BLOCK,
  NO_GROUP,
  NO_QQ_ID,
  NO_WEB_CONFIG_BLOCK,
} from './messages'
import { sendQQMarkdown, type QQButton } from './qq-markdown'

export interface PreconditionDeps {
  web: WebClient | null
  useMarkdown: boolean
}

/**
 * 检查当前用户是否已绑定角色卡账号。
 * 未绑定时直接发送友好引导（含"如何绑定"步骤 + [绑定] 输入框按钮），返回 false。
 * 调用方据此提前 return，不再走业务逻辑。
 *
 * 返回 true 表示已绑定可继续；false 表示已 reply 引导文本，调用方应直接 return。
 */
export async function requireBound(
  session: Session,
  deps: PreconditionDeps,
): Promise<boolean> {
  if (!deps.web) {
    await reply(session, deps, NO_WEB_CONFIG_BLOCK)
    return false
  }
  const qqOpenid = session.userId
  if (!qqOpenid) {
    await reply(session, deps, NO_QQ_ID)
    return false
  }
  const r = await deps.web.getBindingStatus(qqOpenid)
  if (!r) {
    await reply(session, deps, NETWORK_ERROR_BLOCK)
    return false
  }
  if (!r.bound) {
    const buttons: QQButton[][] = [
      [{ label: '我已生成绑定码', data: '/绑定 ', type: 'input' }],
    ]
    await reply(
      session,
      deps,
      [
        '# 你尚未绑定角色卡',
        '',
        '该命令需要绑定后才能使用。',
        '',
        '**绑定步骤**',
        '1. 在角色卡网页登录 → 个人中心 → 生成 8 位绑定码',
        '2. 在群里发：`绑定 你的8位绑定码`',
        '',
        '> 例：`绑定 ABCD1234`',
      ].join('\n'),
      buttons,
    )
    return false
  }
  return true
}

/**
 * 检查当前群是否已绑定网页任务。
 * 未绑定时发送友好引导（含"如何开始任务"），返回 false。
 */
export async function requireMissionBound(
  session: Session,
  deps: PreconditionDeps,
): Promise<boolean> {
  if (session.isDirect) {
    await reply(session, deps, GROUP_ONLY)
    return false
  }
  if (!deps.web) {
    await reply(session, deps, NO_WEB_CONFIG_BLOCK)
    return false
  }
  const groupId = rawRoomIdOf(session)
  if (!groupId) {
    await reply(session, deps, NO_GROUP)
    return false
  }
  const r = await deps.web.getMissionStatus(groupId)
  if (!r) {
    await reply(session, deps, NETWORK_ERROR_BLOCK)
    return false
  }
  if (!r.bound) {
    const buttons: QQButton[][] = [
      [{ label: '我已生成任务绑定码', data: '/开始任务 ', type: 'input' }],
    ]
    await reply(
      session,
      deps,
      [
        '# 本群尚未绑定任务',
        '',
        '该命令需要本群已绑定任务才能使用。',
        '',
        '**绑定步骤（经理操作）**',
        '1. 在网页任务面板生成 30 位任务绑定码',
        '2. 群里发：`开始任务 你的30位绑定码`',
        '',
        '> 仅独立模式可用 `开始任务 不使用`，跳过网页对接',
      ].join('\n'),
      buttons,
    )
    return false
  }
  return true
}

async function reply(
  session: Session,
  deps: PreconditionDeps,
  content: string,
  buttons?: QQButton[][],
): Promise<void> {
  await sendQQMarkdown(session, content, {
    enabled: deps.useMarkdown,
    buttons,
  })
}
