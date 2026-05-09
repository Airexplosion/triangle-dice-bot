# CLAUDE.md

This file is for future Claude Code (or human) maintainers of this plugin.
For end-user / deployment documentation see `readme.md`.

## 项目概况

Koishi 插件，从 Python 版 `triangle-dice-bot` 1:1 移植。约 2500 行 TypeScript。
对接的角色卡 web 服务在 `triangle-agency-Character-sheet` 仓库（reborndevfen 分支）。

## 架构

```
src/
├── index.ts                Schema 配置、apply()，注册 interaction/button handler，缓存最近 msg_id
├── const.ts                APTITUDE_NAMES / HELP_TEXT
├── types.ts                RoomState / PlayerState / PendingRoll
├── room.ts                 roomIdOf(session) / rawRoomIdOf 等 session 归一化
├── game/
│   ├── dice.ts             roll6d4 / applyBurnout / countSuccesses（纯函数）
│   └── chaos.ts            isTripleSublimation / calculateChaos（纯函数）
├── service/
│   ├── store.ts            triangle_room 表定义 + RoomStore 访问层
│   ├── pending.ts          PendingRollStore（内存 TTL Map）
│   ├── web-client.ts       角色卡 API 客户端（20 个端点）+ 4xx/5xx 区分
│   └── sync.ts             syncFromWeb / fireSync* 共用工具
├── util/
│   ├── auth.ts             isAdmin（频道 role / 群 admins 列表分支）
│   ├── mission.ts          isMissionMember（观察模式判断）
│   └── qq-markdown.ts      sendQQMarkdown 绕过 satori encoder 直接调 internal
└── commands/
    ├── index.ts            注册中心 + 前缀 middleware + OUR_COMMAND_NAMES
    ├── roll.ts             现实修改 / 异常能力（含 web 同步 + 观察模式）
    ├── post-roll.ts        增加成功 / 减少成功 / 撤回骰点
    ├── aptitude.ts         录入资质（含 parseAptitudeInput）
    ├── admin.ts            任务属性 / 混沌增减 / 失败增减 / 注册管理 / 申请 / 同意（含 verifyManagerRole）
    ├── bind.ts             绑定 / 解绑 / 查询绑定
    ├── query.ts            查询状态 / 嘉奖 / 物品（分页）/ 角色（分页）/ 切换角色
    ├── mission.ts          查看 / 开始 / 结束 / 解绑任务（含 mission 成员同步）
    ├── report.ts           查看报告 / 通过 / 申诉
    └── migrate.ts          triangle-migrate-json（一次性数据迁移）
```

## 关键设计决策

### 1. 绕过 satori adapter-qq encoder

`@satorijs/adapter-qq` 4.7 的 MessageEncoder 不暴露 markdown element，且对 `<button>` 触发的 markdown
做了 escape。我们直接调 `bot.internal.sendMessage / sendPrivateMessage` 自己构造 raw payload
（见 `util/qq-markdown.ts`）。

### 2. msg_seq per-msg_id 而非 per-session

QQ 服务端按 msg_id 维度管 msg_seq，不同 session 复用同一 msg_id 时 seq 必须全局递增。
计数器是模块级 Map，5 分钟后 msg_id 自动过期。**改这里前看 `tests/msg-seq.test.ts`。**

### 3. callback button 的回复凭证

QQ 群消息 API **不接受** `event_id` 字段（实测 code 40034025，satori 注释也明说）。
解决：缓存"该群最近 5 分钟内任意一条 @bot 消息的 msg_id"，interaction handler 接到 callback 后
注入 `session.messageId` 让 sendQQMarkdown 走 msg_id 路径。

### 4. 观察模式（isMissionMember）

```
not missionActive          → all members
missionActive + 0 members  → all members（独立模式）
missionActive + N members  → only those listed
```

骰点时：observer 的 chaosApplied 写 0，不动 failureCount，不 sync web。资质消耗仍然记账（撤回时退还）。
**改 isMember 行为前看 `tests/mission.test.ts`。**

### 5. 撤回骰点的资质退还

PendingRoll 上的 `consumedAptitudes: Record<aptName, n>` 记录后修改累计消耗的资质。
撤回时按此退还。新增后修改逻辑要记得累加这个字段。

### 6. 前缀剥离 middleware

Koishi 全局 prefix 不动。我们的 middleware 检测开头的 `/` 或 `.`，仅当首词在 `OUR_COMMAND_NAMES` 时才剥
（避免污染其它插件）。**新增命令名记得加进 set。**

### 7. callback 按钮分类

```
type: 'callback' (默认)  → action_type=1，QQ 推 INTERACTION_CREATE，handler 用 session.execute 分发
type: 'input'           → action_type=2 + enter:false，data 填到输入框等用户编辑（如混沌增减让用户输 N）
type: 'link'            → action_type=0
```

`enter: true` 的"按了直接发"路径**实测在 QQ 客户端 < 8983 不工作**，已废弃，全用 callback。

### 8. 触发者标注

`renderTriggerLine` 自动在每条 markdown 顶部加 `> 触发者　@xxx` 引用块。
QQ 群 markdown 内 `<qqbot-at-user id="..."/>` 实测在某些场景被 QQ 拒收（code 40034025），
当前回退到 openid 后 6 位短码（`#XXXXXX`）。如果 QQ 后续允许，改回 at 语法即可。

## 数据库

唯一表 `triangle_room`，主键 `roomId = ${platform}:${rawRoomId}`。schema 在 `service/store.ts:defineModel`。
JSON 列：`players`（Record<openid, PlayerState>）。
list 列：`admins` / `missionMembers`。
nullable string：`missionId` / `missionName` / `pendingAdminApplicant`。

## 常用命令

```sh
npm test          # 5 个测试文件 / 34 用例
npm run build     # tsc → lib/
npx vitest watch  # 改动时自动跑测试
```

发布前 checklist：
- [ ] `npm test` 全绿
- [ ] `npm run build` 无 ts 错
- [ ] 在 QQ 真机至少跑一遍：录入资质 → 现实修改 → 增加成功 → 撤回骰点

## 常见坑

| 现象 | 原因 / 排查 |
|---|---|
| 命令注册失败 `duplicate command names: "X"` | 命令名跟 Koishi 内置 / 其它插件冲突，禁用对应插件或改名 |
| 回复 Bad Request 400 | 1) msg_seq 没递增 2) msg_id 过期（>5min）3) markdown 内容含敏感词触发审核 |
| code 40034025 `event_id 无效` | 群消息别用 event_id，看 §3 |
| code 304023 | 异步审核中，msg 会延迟到达 |
| callback 按钮按了不响应 | 1) 看日志有没有 `interaction → execute` 2) lastMessageIdByChannel 缓存可能空（5 分钟没消息） |
| 资质值显示 0 | web getAptitudes 失败，查 `triangle.warn` 日志看是绑定 / 角色 / 网络哪里出问题 |
| `getIndexes is not a function` | minato 与 plugin-database-sqlite 版本不匹配，升 sqlite 即可 |

## 待办 / 未实装

- 混沌爆发 / 任务结算等高级游戏规则（Python 版也没做）
- QQ 频道 admin 鉴权的具体 role id（"2"/"4"）需在频道场景实测确认
- callback 按钮在 QQ 客户端旧版本下的兜底（目前依赖 ≥ 8983）
- 全面集成测试（当前只有针对性回归测试）
