# koishi-plugin-triangle-dice

[Koishi](https://koishi.chat/) 插件，三角机构 TRPG 骰点系统的 QQ 群机器人实现。
1:1 移植自 Python 版 [triangle-dice-bot](https://github.com/Airexplosion/triangle-dice-bot)，
对接角色卡服务 [triangle-agency-Character-sheet](https://github.com/Airexplosion/triangle-agency-Character-sheet)。

---

## 功能一览

- **骰点核心**：6D4 系统，自动处理燃尽 / 三连升华 / 失败计数
- **骰后修改**：5 分钟窗口内"增加成功 / 减少成功"，自动消耗资质
- **撤回骰点**：一键撤销本次骰点的混沌池 / 失败计数 / 资质消耗
- **观察模式**：非任务成员骰点不影响任务的混沌池 / 失败计数
- **角色卡集成**：绑定 / 查询状态 / 切换角色 / 物品分页
- **任务管理**：开始 / 结束 / 解绑任务 + 报告通过 / 申诉
- **管理员系统**：QQ 频道走角色识别，QQ 群走注册流程（可对接 web 经理身份验证）
- **Markdown 富渲染**：QQ 私域机器人原生 markdown + callback 按钮
- **Web 双向同步**：骰点 / 资质消耗 / 混沌增减自动同步到角色卡 web

---

## 前置条件

| 项 | 要求 |
|---|---|
| Koishi | ≥ 4.17 |
| Node.js | ≥ 18 |
| 数据库 | 任意 koishi-plugin-database-*（本插件用 `database` 服务，未指定具体驱动）|
| QQ 适配器 | `@koishijs/plugin-adapter-qq`（V2 接口）|
| QQ 机器人类型 | **私域** + **已开通原生 markdown 权限**（公域 / 无 markdown 权限会受限）|
| 角色卡 web 服务（可选） | 部署 triangle-agency-Character-sheet，提供 `BOT_API_KEY` |

QQ 开放平台 Bot 至少需要这些 intents：
- `GROUP_AT_MESSAGE_CREATE`（群 @ 必选）
- `C2C_MESSAGE_CREATE`（私聊，可选）
- `PUBLIC_GUILD_MESSAGES`（频道，可选）

---

## 配置项

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `webApiBase` | string | `''` | 角色卡 API base URL，如 `https://your-server`。空 → 角色卡相关命令禁用 |
| `webApiKey` | string | `''` | 角色卡服务 `BOT_API_KEY`（对应服务端 `.env`）|
| `useMarkdown` | boolean | `true` | 关闭后所有 reply 走纯文本（公域机器人 / 无 markdown 权限可关）|

---

## 命令清单

> 全部命令支持 `/` `.` 前缀（如 `/现实修改 专注`），由插件内部 middleware 处理，不污染其它插件。

`菜单` 会按绑定、任务、解锁和管理员状态展示常用按钮；`帮助` 保留完整规则说明。

### 骰点

| 命令 | 说明 |
|---|---|
| `现实修改 [资质]` | 主流骰点，可能触发失败计数；不带资质名给九宫格 |
| `异常能力 [资质]` | 不影响失败计数 |
| `增加成功 N` | 骰后 5 分钟内将 N 个非 3 翻成 3，消耗资质 |
| `减少成功 N` | 骰后 5 分钟内将 N 个 3 翻成非 3，消耗资质 |
| `撤回骰点` | 撤销本次骰点的混沌 / 失败 / 资质消耗 |

### 资质

| 命令 | 说明 |
|---|---|
| `录入资质 资质 数值 …` | 绝对值：`专注 8`；增量：`专注 -1` / `专注减1`；上限：`专注 上限 +1`；兼容旧格式 `专注3` |

### 任务

| 命令 | 权限 | 说明 |
|---|---|---|
| `查看任务` | 所有人 | 当前群绑定任务的详情 |
| `开始任务 绑定码` | 管理员 | 绑定网页任务 |
| `开始任务 不使用` | 管理员 | 独立模式（不接 web）|
| `结束任务` | 管理员 | 结束当前任务（待处理报告会拦截）|
| `解绑任务` | 管理员 | 解除群与任务的绑定 |

### 管理员

| 命令 | 权限 | 说明 |
|---|---|---|
| `任务属性` | 所有人 | 显示混沌池 / 燃尽计数 / 散逸端 |
| `管理面板` | 管理员 | 任务、报告、日志和危险操作入口 |
| `调整属性 混沌/燃尽/散逸 加/减 N` | 管理员 | 调整任务属性；面板内提供一键 ±1 |
| `混沌增加 N` / `混沌减少 N` | 管理员 | |
| `失败增加 N` / `失败减少 N` | 管理员 | |
| `注册管理 [不使用]` | — | 注册首位群管理员；不带 `不使用` 时校验 web 经理身份 |
| `申请管理 [不使用]` | — | 申请管理员（已有 admin 时）|
| `同意管理` | 管理员 | 批准最近申请 |

### 角色卡

| 命令 | 说明 |
|---|---|
| `绑定 绑定码` | 把 QQ 绑到 web 账号 |
| `解绑` / `查询绑定` | |
| `查询状态` | 角色基础摘要 |
| `查询角色卡 [页码]` | 分页查看完整角色卡；长列表会自动继续拆页 |
| `查询资质` / `查询异常能力` / `查询关系` | 单独查看对应栏目 |
| `查询嘉奖` | 仅嘉奖 / 申诫 / MVP / 察看期 |
| `查询物品 [page]` / `查询物品 物品名` | 列表（5 件 / 页）/ 单件详情 |
| `查询角色 [page]` | 角色列表（6 个 / 页，按钮直接切换）|
| `切换角色 名称或序号` | |

### 报告

| 命令 | 说明 |
|---|---|
| `查看报告` | 当前任务的待处理报告 |
| `通过报告` | 接受评级 |
| `申诉报告 原因` | 申诉评级 |

### 维护

| 命令 | 权限 | 说明 |
|---|---|---|
| `triangle-migrate-json 路径` | authority ≥ 4 | 从 Python 版 `data/rooms/*.json` 一次性导入 DB；`-n` dry-run，`-p qq` 指定 platform |

---

## 已知限制

- **QQ event_id 不被群消息接受**：satori adapter-qq 注释那行说对了。callback 按钮的回复用"该群最近 5 分钟内的 msg_id"作为被动凭证（自动缓存）
- **callback 延迟 1-3 秒**：QQ 服务端往返固定开销，无法绕过
- **markdown at 用户**：在群消息 markdown 内 `<qqbot-at-user id="..."/>` 在部分客户端版本下不渲染，本插件已退回 openid 短码
- **关键操作统一使用 input + enter**：点击会以用户身份发送命令，群内可见，但不依赖 callback 的 5 分钟 `msg_id` 缓存；需要填写数值或原因的按钮只预填输入框
- **`帮助` 命令名跟 Koishi 内置 `@koishijs/plugin-help` 冲突**：使用本插件前请在 Koishi 控制台禁用 `help` 插件

---

## 开发

```sh
git clone <repo>
cd koishi-plugin-triangle-dice
npm install
npm test       # 跑 5 个测试文件，34 个用例
npm run build  # 编译到 lib/
```

测试覆盖：
- `dice.test.ts` 6D4 骰点 + burnout 顺序 + 三连升华
- `chaos.test.ts` 混沌计算边界
- `msg-seq.test.ts` per-msg_id 计数器（防 QQ Bad Request）
- `mission.test.ts` 观察模式三种状态
- `aptitude-parser.test.ts` 资质 token 解析容错

---

## 部署到 Linux 服务器（持续化运行）

Koishi Desktop 是 Windows GUI 形态，Linux 上推荐用 **官方 boilerplate 模板 + systemd / Docker** 持续化运行。

### 方案 A：systemd（推荐，最简单）

```bash
# 1. 准备 Node.js（≥ 18）
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 2. 拿 Koishi 模板
git clone https://github.com/koishijs/boilerplate.git ~/koishi
cd ~/koishi

# 3. 启用 corepack 让 yarn 4 自动可用
sudo corepack enable

# 4. 装依赖
yarn install

# 5. 装本插件（两种方式选一）
#  方式 1：发布到 npm 后从 registry 装
yarn add koishi-plugin-triangle-dice
#  方式 2：本地 portal 软链（开发 / 自托管）
git clone <本插件仓库> /opt/koishi-plugin-triangle-dice
cd /opt/koishi-plugin-triangle-dice && npm install && npm run build
cd ~/koishi
yarn add "koishi-plugin-triangle-dice@portal:/opt/koishi-plugin-triangle-dice"

# 6. 装 QQ 适配器和数据库
yarn add @koishijs/plugin-adapter-qq @koishijs/plugin-database-sqlite

# 7. 编辑 koishi.yml 配置插件、Bot、数据库
nano koishi.yml

# 8. 试跑确认能起
yarn start

# 9. 创建 systemd 服务
sudo tee /etc/systemd/system/koishi.service > /dev/null <<'EOF'
[Unit]
Description=Koishi (triangle-dice)
After=network.target

[Service]
Type=simple
User=YOUR_USER
WorkingDirectory=/home/YOUR_USER/koishi
ExecStart=/usr/bin/yarn start
Restart=on-failure
RestartSec=5
StandardOutput=append:/var/log/koishi.log
StandardError=append:/var/log/koishi.log

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now koishi
sudo systemctl status koishi
```

更新插件：

```bash
# portal 模式
cd /opt/koishi-plugin-triangle-dice
git pull && npm run build
sudo systemctl restart koishi

# npm 模式
cd ~/koishi && yarn upgrade koishi-plugin-triangle-dice
sudo systemctl restart koishi
```

### 方案 B：Docker

```dockerfile
# Dockerfile
FROM node:20-alpine
RUN corepack enable
WORKDIR /app
COPY . .
RUN yarn install --immutable && yarn build
EXPOSE 5140
CMD ["yarn", "start"]
```

```yaml
# docker-compose.yml
services:
  koishi:
    build: .
    restart: always
    ports:
      - "5140:5140"
    volumes:
      - ./data:/app/data       # SQLite 持久化
      - ./koishi.yml:/app/koishi.yml
    environment:
      NODE_ENV: production
```

```bash
docker compose up -d
docker compose logs -f koishi
```

### 方案 C：pm2

```bash
yarn global add pm2
cd ~/koishi
pm2 start "yarn start" --name koishi
pm2 save
pm2 startup    # 跟着输出指引设开机自启
```

### 反向代理（可选）

Koishi 控制台默认监听 `127.0.0.1:5140`，远程访问需要反代。Nginx 例：

```nginx
server {
  listen 443 ssl http2;
  server_name koishi.your-domain.com;

  ssl_certificate     /path/to/fullchain.pem;
  ssl_certificate_key /path/to/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:5140;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

注：QQ 官方 Bot 用 WebSocket 主动连 QQ 服务端，**不需要外网入站端口**——Koishi 服务器只需出网访问 `https://api.sgroup.qq.com/`。反代只是为了远程访问 Koishi 控制台 UI。

---

## 协议

继承 Python 版 triangle-dice-bot 的协议（详见上游仓库）。
