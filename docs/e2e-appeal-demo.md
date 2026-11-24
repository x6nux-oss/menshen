# 申诉链路离线端到端演示

一条命令把 menshen 真正启动起来，并把「处罚 → 申诉 → 验证 → 解禁」整条链路
自动跑通。不联网、不碰真实 Telegram / 模型 / Cloudflare，也不读写仓库里的
`data.db`。

## 一条命令

```bash
go run ./scripts/e2e
```

成功时依次打印 5 个步骤，末尾是：

```
✅ 申诉链路端到端通过
  1. antiad_log: verdict=ad action=deleted_muted ...
  ...
```

失败时进程以非 0 退出，并打印失败步骤、最近的模型请求/响应、最近的 Telegram
调用、网页验证响应以及 menshen 日志尾部。

可选参数：

| 参数 | 作用 |
|---|---|
| `-repo <dir>` | menshen 仓库根目录，默认 `.` |
| `-bin <path>` | 复用已构建的二进制，跳过现场 `go build` |
| `-fail initial` | 让假模型返回空响应：第 2 步应明确失败 |
| `-fail turnstile` | 让假 Turnstile 返回 `success:false`：第 4 步应明确失败 |

失败注入只用于确认「失败时会指到具体步骤」，退出码仍为 1：

```bash
go run ./scripts/e2e -fail initial; echo "exit=$?"
```

## 演示怎么隔离

脚本在临时目录里完成全部动作，退出时删除：

| 真实依赖 | 演示替身 |
|---|---|
| Telegram Bot API | 进程内 `httptest` 假 API，按 `TGAPIBase` 接入；捕获 `sendMessage` / `deleteMessage` / `restrictChatMember` / `getChatMember` 等调用并返回可控响应 |
| OpenAI 兼容模型上游 | 进程内假上游：`/v1/systemone` 固定判广告，`/v1/chat/completions` 按提示词区分「消息复判」与「申诉复核」 |
| Cloudflare Turnstile | 进程内假 `siteverify`，按申诉单号返回合法 `action` / `cdata` / `hostname` |
| SQLite / 日志 / 归档 | 临时目录下的 `data.db`、`menshen.log`、`archive/` |
| 网络 | 子进程环境去掉 `MENSHEN_*` 与代理变量，所有上游都指向 `127.0.0.1`；`tg_api_id: 0` 关闭 MTProto 回查 |

`public_url` 必须写成 `https://demo.local`（配置校验要求 https），实际的网页
验证请求按路径直接打到本地监听端口，签名不变。

为了把 Turnstile 指向假服务，新增了仅供测试的配置项
`turnstile_verify_url`（环境变量 `MENSHEN_TURNSTILE_VERIFY_URL`）；留空时仍走
Cloudflare 官方地址，生产不要配置。

## 脚本里的固定角色

| 角色 | ID | 说明 |
|---|---|---|
| 配置里的主 bot | `100001` | 只做配置管理，不判定；由被测进程按 `bot_token` 自动登记 |
| 工作 bot | `200002` | 脚本直接写进 `bots` 表，启动时自动拉起，接群并判定 |
| 主管理员 / 工作 bot 归属人 | `900009` | 在群里发解禁码完成兑换 |
| 广告发送者 | `300003` | 发一条引流广告，之后走申诉 |
| 群 | `-1001234567890` | `enabled=1`、`dryrun=0` |

## 断言清单

1. **启动**：`/healthz` 返回 200，假 Telegram 收到 `getMe`。
2. **处罚**：群里发广告后，`antiad_log` 出现 `verdict=ad` 且 `action` 含
   `deleted`；假 Telegram 收到指向该消息的 `deleteMessage` 与指向该用户的
   `restrictChatMember`；复判模型被调用。
3. **申诉**：私聊点「写申诉理由」生成 `appeals` 单；发送理由后 AI 复核为
   `uphold`，状态转 `web`。
4. **人机验证**：从假 Telegram 收到的私聊消息里取出 `/_w/ap/...` 链接，带正常
   UA 提交假 Turnstile 令牌；返回解禁码，`web_checks` 有一条 `result=pass`，
   解禁码与库中一致并已私聊下发。
5. **兑换**：群管理员在群里发解禁码；`ad_whitelist` 出现该 bot / 群 / 用户，
   `source=appeal`，有效期 24h（23–25h 容差）；申诉单结案为 `redeemed`，
   `appeal_redeems` 有一条本群兑换记录，假 Telegram 收到 `unbanChatMember`。

## 边界

- demo 通过不等于真机 / 真实账号验收：没有真实 Telegram 投递、真实 Turnstile
  域名白名单、真实模型时延与配额。
- 假上游的响应是固定规则，不验证模型判定质量，只验证 menshen 自己这条链路。
- 不启动长轮询，也不调用 `api.telegram.org`；测试通过 webhook 入口直接投递
  update。

## 常见失败

| 现象 | 原因 |
|---|---|
| 第 1 步 `go build` 失败 | 在仓库根目录执行，或用 `-repo` 指定 |
| 第 2 步超时 | 看打印的最近模型请求/响应；`-fail initial` 就是这种情况 |
| 第 4 步提示验证未通过 | 看最近网页响应；`-fail turnstile` 就是这种情况 |
| 端口被占用 | 脚本每次随机选空闲端口，若仍失败，检查本机防火墙/回环限制 |
