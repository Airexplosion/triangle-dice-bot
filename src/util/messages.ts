/**
 * 集中存放给用户的友好文案。
 * 原则：不说「未知错误」、「失败」这种笼统词，而是枚举具体可能性 + 引导下一步操作。
 */

/** 角色卡服务暂时连不上（web-client 返回 null）：5xx / 网络异常 / 超时 / 配置错。 */
export const NETWORK_ERROR_BLOCK = [
  '# 暂时连不上角色卡服务',
  '',
  '可能原因：',
  '· 角色卡服务器临时离线 / 重启中（最常见）',
  '· 服务器到 Bot 的网络抖动 / 超时',
  '· Bot 配置中的 `webApiBase` 地址写错',
  '',
  '稍候片刻再试。若反复失败请联系经理排查角色卡服务状态。',
].join('\n')

/** 插件未配置 webApiBase / webApiKey。*/
export const NO_WEB_CONFIG_BLOCK = [
  '# 角色卡服务未配置',
  '',
  '该命令需要 Bot 对接角色卡 Web 服务才能使用。',
  '',
  '请联系经理在 Koishi 控制台填好 `webApiBase` 和 `webApiKey`。',
].join('\n')

/** 拿不到 QQ openid（极少见，session.userId 缺失）。*/
export const NO_QQ_ID = [
  '> 无法获取你的 QQ 标识。',
  '',
  '请重新 @ 机器人发一次命令。',
].join('\n')

/** 群命令在私聊触发。*/
export const GROUP_ONLY = '> 该命令仅限群聊使用。'

/** 群定位失败（rawRoomId 拿不到）。*/
export const NO_GROUP = '> 无法定位当前群，请稍后重试。'
