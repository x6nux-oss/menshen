# menshen 工程优化审计（M0 只读盘点）

> 审计对象：`x6nux-oss/menshen`，`main@45dd0aa`（2026-11-14 20:18 +0800）。
> 审计日期：2026-11-23 至 2026-11-24。审计方式：只读代码、静态检索、本地门禁、
> 合成库查询计划与体积实验；未连接生产数据库、真实 bot 或真实 AI 上游。
> 本文只新增报告文件，不修改业务代码、CI、配置或部署。

## 0. 结论摘要

当前最该先做的不是重构，而是把「坏了能恢复、慢了能看见、卡了能定位」补齐。
按风险排序：

| 优先级 | 问题 | 结论 |
|---|---|---|
| P0 | 无备份 / 恢复 / 完整性校验 | 单 SQLite 承载全部租户配置、判定史、申诉与明文上游密钥，磁盘损坏或误删即全量丢失；已由 M1（CODE-40）承接，但需把归档目录与文件权限纳入范围 |
| P0 | 删除不释放磁盘 | `log_retention_days` 清理后 SQLite 文件不缩；合成库 200k 行约 70 MB，删光后仍 70 MB，留下 17,559 个空闲页（约 68.6 MB），`auto_vacuum=0` |
| P0 | 归档文件无保留期，且索引清理后会重复导出 | 文件只增不减；`archive_items` 按 30 天清理后，`/export` 会再次 claim 并向同一 JSONL 追加重复行 |
| P1 | `/healthz` 恒 200 | DB 不可读、bot 全停、更新断流时仍返回 `ok`，编排与反代无法据此摘流量 |
| P1 | 后台任务无 panic 隔离 | 一个畸形 update 或上游空响应可让整个进程退出；已定位一处 `Candidates[0]` 无长度保护的潜在 panic |
| P1 | 初判并发无全局闸 | 每 bot 32 路、无 Shared 级上限；复判才是 50。多 bot + hedge 扇出会把上游并发按 bot 数放大 |
| P1 | 识图与判定共用 worker 池 | 图片突发会占住判定 worker 最长 60 秒；单 Python worker 串行，第 5 路直接失败 |
| P2 | 可观测性、CI 门禁、文档漂移 | 无 `/metrics`/pprof；CI 缺 gofmt、漏洞扫描、镜像扫描；HANDOFF 与 docs 多处落后于 main |

## 1. 基线与验证

### 1.1 规模

| 项 | 实测 |
|---|---|
| Go 文件 / 测试文件 | 265 / 133 |
| Go 非测试代码 | 44,350 行 |
| Go 测试函数 | 883 个 |
| Go 包 | 16 个（`go list ./...`） |
| 前端测试 | 52 个文件 / 510 个用例通过 |
| 前端技术栈 | React 19 + rsbuild + Base UI + Tailwind（`web/package.json`） |
| 后端 | 纯 Go 1.25.5（`go.mod`），单个二进制 + 单个 SQLite；本地视觉是 Python 子进程 |

### 1.2 本次实际执行的门禁

| 命令 | 结果 |
|---|---|
| `go test ./...` | 全部通过 |
| `go test ./... -coverprofile=/tmp/menshen-cover.out` | 总语句覆盖率 **69.2%**；`main` 42.1%、`internal/antiad` 79.1%、`internal/panel` 55.6%、`internal/core` 59.8%、`internal/store` 54.3%、`internal/mtproto` 18.2%、`tasks.go` 0% |
| `go vet ./...` | 通过 |
| `gofmt -l .` | 输出为空 |
| `go build ./...` | 通过 |
| `npm --prefix web run test` | 52 文件 / 510 测试通过 |
| `npm --prefix web run lint` | 通过 |
| `npm --prefix web run typecheck` | 通过 |
| `npm --prefix web run build` | 通过，生成 index/admin/public 三入口 |
| `govulncheck ./...` | 3 条可达漏洞（见 §6.2） |
| `npm audit --package-lock-only` | 2 个 high（均为 dev 依赖；`--omit=dev` 为 0） |

> 环境差异：本地 Go 为 1.27.3，CI 按 `go.mod` 使用 1.25.5。标准库漏洞
> `GO-2026-6859` 的「fixed in 1.27.4」只适用于本地工具链；部署/CI 的实际
> 1.25.5 工具链需在 M4 里用同一版本重跑 `govulncheck` 后再定性。

### 1.3 合成库实验

用 20 万条 `antiad_log` + 20 万条 `group_messages` 构造临时库（`/tmp`，
未进入仓库），验证体积与查询计划：

```
200k + 200k 行库文件：约 70 MB
DELETE 全部数据后：仍 70 MB
PRAGMA freelist_count = 17559, page_size = 4096  → 约 68.6 MB 未归还
PRAGMA auto_vacuum = 0
```

这证明了当前 `CleanupData` 只删行、不回收页；保留期策略不能阻止数据库文件
随时间单调增长。实验库是普通 journal 模式；WAL 模式下文件只增不减的性质相同。

## 2. 调用链与模块边界

### 2.1 入站到处置

```
webhook /_w、/admin、/miniapp、/cap
  main.go:340 webRouter
  core/webhook.go:51 Registry.ServeHTTP
    → core/bot.go:748 Bot.Enqueue（update_id 去重，队列 256）
    → core/bot.go:779 RunQueueWorker（单 goroutine 串行）
    → dispatch.go:17 dispatch
      → antiad.HandleGroupMessage（pipeline.go:36）
        → asSender / archive.HandleMessage（pipeline.go:56）
        → chatActive（pipeline.go:24）
        → touchMember + recordMessage（member.go:176/209）
        → 规则门 / 内容哈希 / 护栏（pipeline.go:205-304）
        → buildState（state.go:265）
        → Bot.AdSubmit(judgeAndAct)（pipeline.go:320）
          → seeVisual（vision.go:99）
          → enrichLinkPreviews（linkpreview.go:255）
          → judgeFirst（judge.go:553）
          → 初判先删/临时禁言（pipeline.go:460-475）
          → Bot.AdReview(review)（pipeline.go:480）
          → actOnVerdict（dispose.go:597）
            → ApplyAction（dispose.go:217）
            → logAd（adlog.go:17）
            → archive.RecordJudgment
            → sendAdAlert（alert.go:47）
```

进群路径是并行的第二条链：`HandleChatMemberUpdate`（`member.go:86`）和
`new_chat_members` 服务消息都汇聚到 `onJoin`（`coldjudge.go:20`），再做
入群验证、联合封禁拦截和冷判定。

### 2.2 边界与耦合

- **依赖方向没有循环**：`core` 不 import `antiad`/`panel`；`main.go` 是唯一
  同时看见三层的装配点（`dispatch.go:1-17` 的注释说明了原因）。这是正确的。
- **`core.Shared` 是事实上的 service locator**：Store、Cache、LocalModels、
  AdLimits、Logs、AIClient、reviewSem、Registry 都挂在这里（`core/bot.go:38-107`），
  `core.Ext` 又用类型擦除挂 `antiad`/`panel` 的进程级状态（`core/bot.go:64-68`）。
  边界因此是「编译期包依赖」清楚、**运行期所有权不清楚**：任何包都能通过
  `Shared` 改写全局状态。
- **`core.Bot` 是 god object**：同时承担 TG 传输、待输入会话、命令菜单、文件
  下载、两个判定队列、去重窗口、分钟任务节流、主 bot 判断（`core/bot.go:150-214`）。
  这使单测必须构造大量共享状态，也是 `core` 覆盖率只有 59.8% 的原因之一。
- **判定编排有三套相似实现**：
  - 消息自动判定：`judgeAndAct`（`pipeline.go:340`）
  - 进群/前置号：`judgeAccountCheck`（`coldjudge.go:375`）
  - `/check` 人工复查：`judgeBoth`（`judge.go:488`）

  三者都在处理「systemone 失败回落大模型 / 置信度线 / 初判与复判合并 / 成本合并」，
  但阈值读取和回退分支各写一遍。改一条阈值语义要同时改三处，容易漂移。
- **重复的数据读取/写入**：
  - 图片消息在 `recordMessage`（`pipeline.go:199`）后，识图成功又在
    `vision.go:129` 再写一次留底；同一条消息两次同步写。
  - `modelList`（`store/cache.go:525`）与 `listOrSingle`（`store/cache.go:544`）
    是同一套「新 JSON 列优先、旧单值列回退」的两份实现。
  - `chatRef`（`antiad/status.go:80`）、`chatTag`（`panel/antiadlog.go` 内）与
    `core.LookupChatRef` 都在渲染群引用；面板与 antiad 各有一套转义口径。
- **大文件**：`internal/panel/miniapp.go` 1,932 行、`internal/panel/antiadlog.go`
  1,063 行、`internal/antiad/ruleagent.go` 1,742 行；`miniapp_test.go` 2,052 行。
  这些文件本身不是缺陷，但把协议、权限、SQL 和展示混在一起，回归定位成本高。

### 2.3 结论

模块边界总体是「可理解」的，不需要重写。优化应先做**边界内的最小切口**：
把三套判定编排的公共阈值/回落抽成一个小函数；把 `Shared` 上的新能力按用途
分到已有子结构；不要为了「架构干净」做大迁移。

## 3. 数据面

### 3.1 表增长与量级

| 表 | 写入时机 | 单行量级（上限） | 默认保留 | 备注 |
|---|---|---|---|---|
| `antiad_log` | 每条判定/未送检记录 | 正文 1,000 rune + 两级 JSON（`adTextLimit`，`decide.go:12`） | 30 天 | 面板、申诉、统计、形态总结都读它 |
| `group_messages` | 每条非命令群消息 | 正文 1,000 rune（`member.go:202`） | 30 天 | `/check` 复查与 recent_context 的来源 |
| `ai_log` | **每次 AI 尝试** | input 64 KB + output 32 KB（`ailog.go:18-24`） | 14 天（`ai_log_days`） | 一次判定可产生初判、复判、证据重试最多 3 行；失败重试再叠加 |
| `group_members` | 每条发言 upsert | 小 | 30 天，但 `ad_hits>0`/白名单行保留 | 高频同步写 |
| `web_checks` | 每次网页验证 | IP/UA/fp + signals | 30 天 | 隐私数据 |
| `join_verify` | 每次入群验证 | 小 | 未在 CleanupData 清理（仅超时任务改状态） | 需确认长期增长 |
| `archive_items` | 每次归档 claim | 小 | 30 天 | 只清索引，不清文件 |

**假设与量级**：若 1,000 条/天、每条消息平均 2 次 AI 尝试、每次 `ai_log`
平均 8 KB，则 `ai_log` 约 16 MB/天、14 天约 224 MB；若图片/失败重试多，
上限可到 100 MB/天量级。`antiad_log` + `group_messages` 按 2 KB/条估算，
30 天约 120 MB。实际值需 M3 用生产库或脱敏快照测。

### 3.2 索引与热点查询

现有索引覆盖了大多数主路径：`antiad_log(bot_id,id)`、`(bot_id,created_at)`、
`(user_id,id)`、`group_messages(chat_id,user_id,at)`、`group_members(last_msg_at)`、
`appeals` 未结唯一索引等（`store/db.go:745-780`）。

但以下查询在合成库上会退化为扫描（`EXPLAIN QUERY PLAN` 实测）：

| 查询 | 证据 | 计划 |
|---|---|---|
| Mini App 记录列表按 `bot_id IN (...)` + `action LIKE 'deleted%'` | `panel/miniapp.go:1541-1595` | `SCAN antiad_log` |
| Mini App 记录搜索 `text LIKE '%q%' OR reason LIKE '%q%'` | 同上 | `SCAN antiad_log` |
| 多 bot 记录列表 `bot_id IN (1,2,3) AND verdict='ad' ORDER BY id DESC` | 同上 | `SCAN antiad_log` |
| 申诉列表按 `bot_id IN (...)` + `ORDER BY id DESC` | `panel/miniapp.go:1751-1759` | `SCAN appeals`（缺 `(bot_id,id)` 索引） |
| recent_context `ORDER BY at DESC, message_id DESC` | `member.go:271` | 索引查找 + `USE TEMP B-TREE` |

单 bot 的 `bot_id=?` 查询能用 `idx_antiad_bot_id`；问题集中在主管理员的
「全平台」视图、多 bot 次管和文本搜索。记录表会随 30 天保留期达到十万到
百万行，这些查询会逐渐变慢。面板没有默认时间窗，搜索会扫全表。

### 3.3 清理与空间

- `CleanupData` 用 `deleteBatched` 每批 5,000 行（`gban.go:812-900`），
  避免长写锁，这是正确的。
- 但它只 `DELETE`，不 `VACUUM`/`incremental_vacuum`；`store.Open` 也没有设置
  `auto_vacuum`（`store/db.go:475-486`）。因此文件只增不减，备份也会越来越大。
- `archive_items` 在 30 天后被删（`gban.go:838-843`），但
  `archive/` 下的 JSONL 与图片没有任何保留期清理；且索引删掉后，下一次
  `/export` 会重新 claim 同一条记录并向同一文件追加，产生重复行
  （`archive.go:215-226`、`ExportChat` 的 claim 循环）。

### 3.4 备份缺失的实际影响

单库同时包含：

- `upstreams.api_key`、`bots.token` 明文（`store/db.go` 的注释与 schema）；
- `settings.web_secret`、验证码密钥；
- 白名单、联合封禁、申诉与验证记录（含 IP/UA/浏览器特征）；
- 群消息正文、判定流水、AI 请求/响应摘要；
- 归档去重索引与头像索引。

没有定时备份、恢复流程或启动完整性校验（全仓 `rg backup|restore|integrity_check`
只命中日志轮转与文档）。磁盘损坏、误删、容器卷丢失都等于**配置、名单、
申诉证据与密钥一起丢失**。这与 M1（CODE-40）描述一致，M0 只需补两点：
归档目录纳入备份；备份/恢复流程要验证 `PRAGMA integrity_check` 与文件权限。

## 4. 性能与成本

### 4.1 AI 并发、超时与重试

| 项 | 现状 | 证据 |
|---|---|---|
| 每 bot 判定 worker | 32 个初判 + 32 个复判 goroutine | `core/bot.go:267-298` |
| 全局复判闸 | 50 | `core/bot.go:277-280`、`324-329` |
| 全局初判闸 | **没有** | 同上，注释明确「初判总并发 = adWorkers × bot 数」 |
| 队列 | 每 bot 每队列 1,024 | `core/bot.go:274-276` |
| 重试 | 最多 5 次，总预算 150 秒，单次 45 秒 | `aiclient.go:28-42, 130-198` |
| 卡住判据 | systemone 2 秒；复判首字 15 秒、空闲 10 秒 | `store/cache.go:107-115`、`aiclient.go:468-487` |
| hedge | 1 分钟内重试超过 5 次后并发 2 路，持续 5 分钟 | `aiclient.go:146-158, 760-790` |

风险不是「5 次重试」本身，而是**多 bot 叠加**：N 个 bot 时初判并发是
32N，hedge 再乘 2；上游看到的是一份配额。复判有 50 的全局闸，初判没有。
M3 应把「初判全局并发」作为独立基线项，不要沿用父 issue 里
「当前 Shared 级 ≤50」的表述——50 只覆盖复判。

### 4.2 默认采信线 95% 的成本含义

`DefaultSoTrust = 95`（`store/cache.go:30`），且 `needReview` 在置信度低于
采信线**或**要禁言/封禁时触发复判（`judge.go:584-589`）。默认
`antiad_bool_verdict=1` 下，新人广告只要判为广告就会走禁言档，因此**大量
广告结论会进复判**；systemone 的置信度若常在 90~94，复判率会接近 100%。
这不是错误，但会显著放大成本，且没有基线证明 95 是最优默认。M3 应测：
`trust=95/90/85` 下的复判率、漏判率、单条成本与 p95 延迟。

### 4.3 本地识图

- `describeVisual` 在判定 worker 上最多等 60 秒，先抢 `localMedia` 槽位（容量 4），
  再 `fetchTGFile`、解码、调用 `LocalModels.Infer`（`antiad/localvision.go:27-70`）。
- `Infer` 自己还有 `manager.slots`（容量 4，满了直接返回「队列已满」）和
  单个 `manager.gate`（一个 Python worker 串行），`worker.py` 单进程
  （`localvision/worker.go:43-74`）。
- 图片突发时：第 5 路立即失败；前 4 路占住 4 个判定 worker 等 Python；
  其余 28 个判定 worker 仍可处理文本，但整个池的可用度下降。纯图识图失败时
  `seeVisual` 记一条「判定失败」流水并放行（`vision.go:112-119`），不会告警。

建议把识图放到独立的小 worker 池/队列，或至少把「等槽位」移出判定 worker；
同时给 queue depth、等待时长、失败原因打点。M3 需要量化图片比例与 CPU。

### 4.4 图片压缩与下载

- `visionFileMax = 20 MB`（`vision.go:21`），但 `fetchTGFile` 调
  `DownloadFile`，后者的实际上限是 `fileMaxBytes = 5 MB`（`vision.go:169`、
  `core/bot.go:390-398`）。5~20 MB 的图片/视频会先通过大小检查，再在下载时失败。
- `photoVisual` 只是从 Telegram 提供的尺寸里挑一个 ≤1280 的档，**不做缩放**；
  文档图片也没有缩放。`worker.py:232-240` 把整张图交给 RapidOCR；
  `_decode_image` 只做 40 MP 上限校验（`worker.py:205-226`）。
- 视频抽帧由 ffmpeg 缩到 1280（`videoframes.go:84-95`），图片/文档没有同等处理。

建议：`fetchTGFile` 改用 `DownloadFileLimit(..., visionFileMax)`；在 Python 侧
统一把 OCR 输入缩到长边 1280~1600；在 Go 侧对非 Telegram 压缩图也做一次
尺寸/像素检查。先做 M3 基线，再决定是否引入额外依赖。

### 4.5 写路径

每条群消息的同步段至少有：

1. `touchMember`：`INSERT ... ON CONFLICT ... RETURNING`（`member.go:176-198`）
2. `recordMessage`：`INSERT ... ON CONFLICT`（`member.go:209-215`）
3. 判定 worker 里每次 AI 尝试：`INSERT INTO ai_log`（`ailog.go:145-176`）
4. `logAd`：`INSERT INTO antiad_log`（`adlog.go:17-60`）
5. 归档开启时：`archive_items` claim + 文件 append（`archive.go:215-226, 366-390`）

`Store.Write` 固定 1 个连接（`store/db.go:487`），这是 SQLite 的正确做法，
但意味着广告洪峰时上述写入全部串行。`ai_log` 每行可达 96 KB，是最大的
写放大来源；`archive` 每行一次 open/write/close，且全局 `writeMu` 串行。

M3 应先测「1,000 条/分钟、50% 带 AI 重试、归档开/关」下的写队列等待时间，
再决定是否需要把 `ai_log` 改为异步批量写、把归档改为按日 buffered writer。

## 5. 可观测性

### 5.1 现有能力

| 入口 | 能回答 | 不能回答 |
|---|---|---|
| `GET /healthz` | 进程还活着 | DB 是否可读、bot 是否在跑、是否还在收更新、队列是否满 |
| 管理员 `/status` | 版本、uptime、bot 启用/运行数、生效群/演练群数、`AdBusy` 总数、未结申诉、近 24h 送检/命中/失败/未送检/误判/开销/留底、命中类型 Top5、连续失败数 | 队列深度分布、更新丢弃数、AI p50/p95、每模型失败率、DB/WAL/归档体积、备份年龄、localvision 队列、goroutine/内存、限流命中 |
| `slog` 三路输出 | 结构化错误、重试阶段、耗时、模型/上游 | 请求关联 ID、每条消息的全链路 ID、指标聚合 |
| `ai_log` 表 | 每次 AI 尝试的输入/输出摘要、用量、成本、延迟、失败阶段 | 跨尝试的聚合视图、告警 |

`/healthz` 的实现是 `core/webhook.go:52-55` 直接 `w.Write([]byte("ok"))`，
没有任何依赖检查。Dockerfile/Compose 也没有 `HEALTHCHECK`（`Dockerfile` 无
`HEALTHCHECK`，`docker-compose.yml` 只有 `restart`）。

### 5.2 最小 metrics 集

建议 M2 只做下面这一组，标签必须是低基数、不含 chat/用户/token/正文：

**进程与存活**

- `menshen_build_info{version}` = 1
- `menshen_start_time_seconds`
- `menshen_goroutines`
- `menshen_memory_bytes{kind="alloc|sys|heap"}`

**入站与队列**

- `menshen_http_requests_total{route,method,status}`
- `menshen_http_request_duration_seconds{route,method}` histogram
- `menshen_webhook_updates_total{bot,result="accepted|duplicate|dropped|unauthorized|bad_body"}`
- `menshen_queue_depth{bot,queue="updates|ad|review"}`
- `menshen_ad_busy{bot}`

**判定与 AI**

- `menshen_judgements_total{bot,verdict="ad|clean|error|skipped",action}`
- `menshen_ai_requests_total{endpoint,model,upstream,status}`
- `menshen_ai_request_duration_seconds{endpoint,model,upstream}` histogram
- `menshen_ai_tokens_total{endpoint,model,kind="prompt|completion|cache_read|cache_write"}`
- `menshen_ai_cost_quota_total{endpoint,model}`
- `menshen_ai_retries_total{endpoint,model}`
- `menshen_ai_fail_streak`
- `menshen_hedge_active{endpoint,models}`

**识图**

- `menshen_localvision_requests_total{group="ocr|nsfw",result}`
- `menshen_localvision_duration_seconds{group}` histogram
- `menshen_localvision_queue_depth`

**容量与备份**

- `menshen_db_size_bytes`
- `menshen_db_wal_size_bytes`
- `menshen_db_free_bytes`（`freelist_count * page_size`）
- `menshen_archive_size_bytes`
- `menshen_last_backup_success_timestamp_seconds`
- `menshen_backup_duration_seconds`
- `menshen_integrity_check_ok`

**业务积压**

- `menshen_appeals_open`
- `menshen_join_verify_pending`
- `menshen_rate_limited_total{route}`

pprof 作为可选项，默认关闭；开启时只允许回环或管理员 Bearer，且不要和
公开路由共用无鉴权入口。

## 6. 供应链与公开端点

### 6.1 CI 门禁

`.github/workflows/docker.yml` 的 `check` 作业实际执行：
`npm ci → lint → test → typecheck → build → go vet → go test → go build`，
再加 tag/version 一致性与双架构镜像构建。

缺口：

- **没有 `gofmt -l .`**，但 `docs/development.md:12-18` 写「三项在 CI 上是门槛」。
- 没有 `govulncheck`、`staticcheck`、`go test -race`。
- 没有 `npm audit`（`npm ci --no-audit`）。
- 没有镜像扫描、SBOM、签名；`provenance: false` 是为多架构 manifest 稳定性
  做的取舍（`docker.yml:103-105`），但发布物因此没有 attestation。
- Actions 用 major tag（`actions/checkout@v4`、`docker/build-push-action@v6` 等），
  Dockerfile 基础镜像用浮动 tag（`node:22-alpine`、`golang:1.25-alpine`、
  `python:3.12-slim`），没有 digest 固定。

### 6.2 依赖漏洞

`govulncheck ./...`（本地 Go 1.27.3）报告 3 条可达：

| 漏洞 | 模块 | 当前 | 修复 |
|---|---|---|---|
| GO-2026-6888 | `github.com/andybalholm/brotli` | 1.2.1 | 1.2.7 |
| GO-2026-6865 | `github.com/klauspost/compress` | 1.19.1 | 1.20.2 |
| GO-2026-6859 | 标准库 `net/http` | 1.27.3 | 1.27.4 |

前两条是间接依赖，但 `govulncheck` 给出了从 `core.Bot.CallOK` 等路径可达的
调用链；第三条要按 CI/部署的 1.25.5 工具链重跑后再定性。`npm audit` 的 2 个
high（`vite@8.3.2`、`undici@7.30.0`）都只在 dev 依赖里；`--omit=dev` 为 0。
结论：先升级 dev 依赖与 Go 间接依赖，再把 `govulncheck`/`npm audit` 变成
门禁，避免「CI 绿但已知漏洞未修」。

### 6.3 公开端点与安全头

- 申诉 POST 有「每单每分钟 5 次、每 IP 每分钟 20 次」限频
  （`antiad/appeal_web.go:236-245`）；但 `/admin/login`、`/miniapp/api`、
  `/admin/api`、`/cap/*`、`_w` 的 GET 数据接口没有通用 IP 限流。
- 公开页壳有严格 CSP、`X-Robots-Tag`、`Referrer-Policy`
  （`panel/public.go:31-40`）；`/admin` 与 `/miniapp` 的 HTML 壳
  （`panel/miniapp.go` 的 `writeHTML`、`panel/admin_panel.go` 的 `adminIndex`）
  没有 CSP / `frame-ancestors` / `X-Content-Type-Options`。
- 管理端 cookie 是 `HttpOnly + SameSite=Lax`，API 要求 `X-Web: 1`
  （`admin_panel.go:29-33`），CSRF 设计是对的；但缺少响应安全头会让
  「后台被第三方页面嵌套」这类问题没有第二道防线。
- 文件权限：SQLite、运行日志、归档 JSONL、归档图片都以 `0644` 创建
  （`store/db.go:478-486` 未 chmod；`logbuf/file.go:119`；
  `archive/archive.go:382`；`archive/image.go:311`），目录为 `0755`
  （`archive.go:370`）。库里有明文 bot token/上游 key/web_secret，日志与
  归档有群消息正文。单租户容器风险较低，但共享主机/备份拷贝会放大。

## 7. 测试与文档

### 7.1 覆盖缺口

| 范围 | 覆盖率 | 风险 |
|---|---|---|
| `main` | 42.1% | 启动装配、webhook 路由、main bot 迁移分支 |
| `tasks.go` | 0% | 分钟/小时任务、清理/汇总/退群/标题刷新 |
| `internal/mtproto` | 18.2% | 入群时间回查、历史图片回捞 |
| `internal/panel` | 55.6% | 权限边界、Mini App/Admin API 分支 |
| `internal/core` | 59.8% | 队列、去重、命令菜单、webhook |
| `internal/store` | 54.3% | 迁移、缓存重建、索引 |

优先补的回归不是「凑覆盖率」，而是会掩盖本次发现的缺陷：

- `/healthz` 在 DB 关闭/锁住时返回非 200（M2 实现后）。
- `CleanupData` 后 `freelist_count` 不增长或 `VACUUM` 生效（M1/M3）。
- 备份失败（目录不可写、磁盘满）、损坏库、空库恢复（M1）。
- webhook 队列满、判定队列满、复判队列满时的丢弃/放行路径。
- 识图超时/队列满/5–20 MB 文件、纯图失败不误删。
- `eino_kind.go` Gemini 空 `candidates` 不 panic。
- 归档导出在索引清理后不重复追加（O-03 修复后）。

### 7.2 文档漂移

| 位置 | 现状 | 应改为 |
|---|---|---|
| `HANDOFF.md:3` | 仓库 `x6nux/menshen`、main `491a8d0` | 当前是 `x6nux-oss/menshen`、`45dd0aa`；建议把 HANDOFF 标注为历史快照并链接本报告 |
| `HANDOFF.md:8-11` | 2026-09-28 的 dev 实例状态、Turnstile-only | 已被 multi-provider（Turnstile/hCaptcha/Cap）与后续提交取代 |
| `HANDOFF.md:91-93`、`:154` | 引用 `dev/`、`CLAUDE.md` | 仓库里不存在；要么补回，要么删除引用 |
| `docs/development.md:12-18` | 说 `gofmt`/`go vet`/`go test` 都是 CI 门槛 | CI 只跑 vet/test/build，缺 gofmt |
| `docs/development.md:97` | 说三张表按同一保留期清理 | `ai_log` 有独立 `ai_log_days`；`group_members` 有命中/白名单例外；归档文件不在清理范围 |
| `docs/development.md:102` | 链接 `../CLAUDE.md`（不存在） | 删除或改到实际文档 |
| `docs/panel.md:109` | 桌面面板由 Vite 构建 | 实际是 rsbuild（`web/package.json`） |
| `docs/panel.md:118-120` | 公开页是 React + MUI | 实际已迁移到 Tailwind + Base UI，旧 MUI 已移除 |
| `docs/deployment.md:79` | 只描述 Turnstile | 代码支持 hCaptcha 与内置 Cap，需补全 |
| `README.md:87-93`、`docs/deployment.md:99-105`、`docs/development.md:76` | 旧组织路径/镜像 `x6nux/menshen` | 统一为当前仓库的发布路径，避免 clone/pull 到旧地址 |

## 8. 优化清单

每条按「问题 → 证据 → 建议 → 预估影响 → 依赖」给出。优先级是
P0（先做）/P1（本路线图内做）/P2（可排后）。

### P0

#### O-01 备份、恢复与完整性校验

- **问题**：单 SQLite 无定时备份、无恢复流程、无启动完整性校验；库内含明文密钥、名单、申诉与聊天正文。
- **证据**：`store/db.go:478-486` 只开 WAL/同步/忙等；全仓 `rg backup|restore|integrity_check` 只命中日志轮转/文档；`main.go:94-100` 打开库后直接 seed。
- **建议**：M1 实现 `VACUUM INTO` 每日备份到独立目录、保留 N 份（默认 7）；启动 `PRAGMA quick_check`、备份后 `PRAGMA integrity_check`；把 `archive/` 纳入备份或明确排除并写进恢复文档；恢复演练脚本；备份/DB 文件 `0600`。
- **预估影响**：把「磁盘损坏 = 全量丢失」降为「最多丢一个备份周期」；恢复时间从不可控变为可演练。
- **依赖**：M1（CODE-40）。本报告只补充范围，不重复登记 issue。

#### O-02 回收 SQLite 空闲页

- **问题**：`CleanupData` 只 DELETE，不 VACUUM/auto_vacuum，文件随时间单调增长。
- **证据**：`gban.go:812-900`；`store/db.go:475-486`；合成库 200k+200k 行约 70 MB，删光后仍 70 MB，`freelist_count=17559`、`page_size=4096`、`auto_vacuum=0`。
- **建议**：新建库时 `PRAGMA auto_vacuum=INCREMENTAL`（老库需一次 `VACUUM` 才生效）；小时任务在清理后执行有上限的 `PRAGMA incremental_vacuum(N)`；或把 `VACUUM` 放到低峰维护窗口；备份用 `VACUUM INTO` 天然压缩。
- **预估影响**：保留期生效后文件可回落到实际数据量；备份体积与磁盘水位可控。
- **依赖**：M1（备份/维护任务）或 M3（容量基线）。

#### O-03 归档文件保留期与重复导出

- **问题**：`archive/` 文件无清理；`archive_items` 清理后 `/export` 会重复 claim 并追加重复 JSONL 行。
- **证据**：`gban.go:838-843` 删索引；`archive.go:215-226` 每次 claim；`archive.go:366-390` append 无幂等检查；全仓无 `archive/*` 文件删除逻辑。
- **建议**：按日期目录/文件 mtime 清理超过保留期的归档；或保留 `archive_items` 直到对应文件删除；导出前检查目标文件是否已有同一 `(kind,chat,ref)` 行；给归档目录加体积指标。
- **预估影响**：开启归档后磁盘不再无限增长；重复导出不再污染审计副本。
- **依赖**：M1（备份/清理任务）。

### P1

#### O-04 `/healthz` 改为就绪检查

- **问题**：恒 200，无法发现 DB 不可读、bot 全停、更新断流。
- **证据**：`core/webhook.go:52-55`；Dockerfile/Compose 无 HEALTHCHECK；`panel/status.go` 的 `/status` 是管理员私聊入口，不是机器探针。
- **建议**：区分 liveness/readiness。readiness 检查：`Store.Read.PingContext` + 可选 `quick_check`（缓存结果，避免每请求跑）；至少一个运行中 bot；最近一次成功 update 的时间在阈值内；返回 503 + 简短原因。保留 `/healthz` 兼容，新增 `/readyz` 或在同路径升级语义。
- **预估影响**：编排/反代能在故障时摘流量；排障不再依赖用户反馈。
- **依赖**：M2（CODE-41）。

#### O-05 后台任务 panic 隔离

- **问题**：判定 worker、webhook 串行 worker、轮询 dispatch 都没有 `recover`；一个 panic 会终止整个进程。
- **证据**：`core/bot.go:303-312`（job 直接调用）、`:779-789`（dispatch 直接调用）；`RunPolling` 同样；`eino_kind.go:809` 在 `Candidates` 非 nil 但空时访问 `[0]`，是可达的潜在 panic（规则发现渠道翻译）。
- **建议**：在 `adWorker`、`RunQueueWorker`、`RunPolling` 的每条 update/job 外加 `defer recover`，记录 `debug.Stack` 与 update/job 标识，`adBusy` 仍要减；修 `eino_kind.go` 为 `len(r.Candidates) > 0`；加一个回归测试覆盖空 `candidates`。
- **预估影响**：单个坏更新/坏上游响应不再拖垮所有 bot；panic 变成可见日志/计数。
- **依赖**：M2（可观测性）或独立小修；建议在 M2 前先做这一行级修复。

#### O-06 初判并发全局上限

- **问题**：初判每 bot 32 路、无全局闸；复判才有 50。多 bot + hedge 会把上游并发放大。
- **证据**：`core/bot.go:267-280`、`324-329`；`aiclient.go:146-158`、`349-362`。
- **建议**：加 Shared 级 `soSem`（默认 50，可配）或按 bot 动态分配；把 `adWorkers` 做成 bot 级可配；在 metrics 暴露 active/queued；M3 先测再定值。
- **预估影响**：多 bot 时上游并发从 32N×hedge 降到可控上限；减少 429/超时导致的放行。
- **依赖**：M3（CODE-42）基线；M2 指标。

#### O-07 校准默认采信线 95%

- **问题**：默认 95% 可能让绝大多数广告结论进入复判，成本翻倍；无基线证明。
- **证据**：`store/cache.go:30`；`judge.go:584-589`；`antiad_bool_verdict` 默认 1（`store/cache.go` 设置默认）。
- **建议**：M3 用脱敏样本测 `trust=95/90/85` 的复判率、漏判率、单条成本、p95；把默认值与模型档位写进 `docs/how-it-works.md`；未测前不建议直接改默认。
- **预估影响**：可能把复判调用量降一个档；同时用数据而不是感觉校准。
- **依赖**：M3。

#### O-08 识图与判定 worker 解耦

- **问题**：图片识别在判定 worker 内等本地 Python，最长 60 秒；单 worker 串行，队列满即失败。
- **证据**：`antiad/localvision.go:27-70`；`localvision/worker.go:61-74`；`vision.go:112-119`。
- **建议**：独立 vision worker/队列；`describeVisual` 不在判定 worker 内阻塞等槽位；给等待/失败打点；纯图识图失败时明确是「未判」而非「判定失败」，或按配置放行/告警。
- **预估影响**：文本判定不被图片洪峰拖慢；识图吞吐可单独扩容/限流。
- **依赖**：M3；M2 指标。

#### O-09 统一识图文件上限

- **问题**：声明 20 MB，实际下载 5 MB；5–20 MB 媒体静默识别失败。
- **证据**：`vision.go:21` vs `core/bot.go:390-398`；`vision.go:169` 用 `DownloadFile`。
- **建议**：`fetchTGFile` 改用 `DownloadFileLimit(path, visionFileMax)`；或把 `visionFileMax` 降到 5 MB 并改文档/提示；加边界测试（5 MB±1、20 MB）。
- **预估影响**：大图/视频识别覆盖率提升；不再为注定失败的文件下载/解码。
- **依赖**：M3 或独立小修。

#### O-10 OCR 前统一缩图

- **问题**：OCR 输入是原图，`visionMaxSide` 只影响 Telegram 尺寸选择；文档图片可到 40 MP。
- **证据**：`vision.go:85-92`；`worker.py:205-240`。
- **建议**：Python 侧在 OCR 前按长边 1280~1600 缩放（保留 NSFW 的 384 预处理）；在 Go 侧记录原始尺寸；用同一组图片测 CPU/耗时 before/after。
- **预估影响**：OCR CPU/内存显著下降；大图不再拖慢单 worker。
- **依赖**：M3。

#### O-11 `ai_log` 写入批量化/异步化

- **问题**：每次 AI 尝试同步 INSERT，单写连接；行可达 96 KB，保留 14 天。
- **证据**：`ailog.go:143-176`；`store/db.go:487`；量级估算见 §3.1。
- **建议**：先加 `ai_log` 行数/字节数指标；再考虑异步 channel + 批量事务（队列满丢弃并计数）；或把 input 上限降到 16 KB、output 降到 8 KB；保留期按实际体积调整。
- **预估影响**：降低判定热路径的写锁等待；控制库/备份体积。
- **依赖**：M3；M2 指标。

#### O-12 归档写入批量化

- **问题**：每条归档 open/write/close，全局 `writeMu`；归档开启时吞吐下降。
- **证据**：`archive.go:364-390`；`archive.go:215-226`。
- **建议**：按 (chat, day) 维持 buffered writer，定时 flush/close；或改为按日批写；错误时 release claim；测归档开/关的 p95。
- **预估影响**：归档开启时不再成为同步路径瓶颈。
- **依赖**：M3（低优先级）。

#### O-13 面板记录搜索/筛选

- **问题**：`LIKE '%q%'`、`bot_id IN (...)`、`action LIKE` 在大表上全扫；无默认时间窗。
- **证据**：`panel/miniapp.go:1541-1595`；合成库 `EXPLAIN` 显示 `SCAN antiad_log`；`panel/antiadlog.go:163-165` 单 bot 可用索引。
- **建议**：默认加 30 天时间窗；给 `(bot_id,id)` 之外的常用筛选建索引/生成列；文本搜索用 FTS5 或 trigram；分页用 keyset（`id < last`）替代大 OFFSET；加慢查询日志。
- **预估影响**：记录页在 10 万~100 万行时仍可交互；避免面板拖慢读连接。
- **依赖**：M3。

#### O-14 申诉列表索引

- **问题**：`appeals` 按 `bot_id IN (...)` + `ORDER BY id DESC` 无匹配索引。
- **证据**：`panel/miniapp.go:1751-1759`；`store/db.go:359` 只有 `(bot_id,user_id)`；合成库 `EXPLAIN` 为 `SCAN appeals`。
- **建议**：`CREATE INDEX idx_appeal_bot_id ON appeals(bot_id,id)`；保留期清理后重建/分析。
- **预估影响**：申诉列表分页从扫表变索引范围扫描。
- **依赖**：M3（小）。

#### O-15 recent_context 排序索引

- **问题**：`ORDER BY at DESC, message_id DESC` 触发 temp B-tree。
- **证据**：`member.go:271`、`loadUserMessages`；合成库 `EXPLAIN` 为 `SEARCH ... USING idx_gmsg_user` + `USE TEMP B-TREE FOR RIGHT PART OF ORDER BY`。
- **建议**：评估 `(chat_id,user_id,at DESC,message_id DESC)` 索引；或把排序改为 `at DESC` 后内存按 message_id 决胜（同一秒内消息极少）。先测写放大。
- **预估影响**：每条消息同步段的 recent_context 读更稳。
- **依赖**：M3。

### P2

#### O-16 `/metrics` 与受控 pprof

- **问题**：无机器可采指标；`/status` 只覆盖一部分。
- **证据**：全仓无 `/metrics`/`pprof` 注册；`panel/status.go` 的统计面有限。
- **建议**：按 §5.2 最小集实现，鉴权默认只回环/管理员 Bearer；pprof 默认关闭、显式开启；标签不含敏感数据；在 `docs/operations.md` 写采集与告警阈值。
- **预估影响**：容量、延迟、失败率可观测；排障从「翻日志」变成「看指标再翻日志」。
- **依赖**：M2（CODE-41）。

#### O-17 公开端点限流与安全头

- **问题**：仅申诉 POST 有 IP/单据限频；admin/miniapp/cap/`_w` GET 无通用限流；admin/miniapp 壳无 CSP/frame-ancestors/X-Content-Type-Options。
- **证据**：`appeal_web.go:236-245`；`panel/public.go:31-40` vs `panel/miniapp.go` 的 `writeHTML`、`panel/admin_panel.go` 的 `adminIndex`；`core/webhook.go:51`。
- **建议**：反代层文档化限流（推荐）+ Go 侧对登录/API 做 token bucket；加统一安全头中间件；`/admin` 设 `frame-ancestors 'none'`，Mini App 按 Telegram WebView 需求保留；HSTS 在反代/CF 层。
- **预估影响**：降低暴力枚举、资源滥用与点击劫持面。
- **依赖**：M4（与 CI/供应链同批）或独立安全小修。

#### O-18 敏感文件权限

- **问题**：DB/日志/归档 0644、目录 0755；库与归档含明文密钥/聊天正文。
- **证据**：`store/db.go:478-486` 未 chmod；`logbuf/file.go:119`；`archive/archive.go:382`；`archive/image.go:311`；`archive.go:370`。
- **建议**：创建时 `0600`/目录 `0700`；容器 `umask 077`；启动时检查并纠正已有文件权限；备份文件同样 0600；文档明示。
- **预估影响**：共享主机/备份拷贝时减少密钥与聊天内容泄露面。
- **依赖**：M1（备份）或 M4（安全）。

#### O-19 CI 与供应链门禁

- **问题**：CI 缺 gofmt、govulncheck、npm audit、镜像扫描/SBOM、action SHA 固定、基础镜像 digest。
- **证据**：`.github/workflows/docker.yml:37-45`；`docs/development.md:12-18` 与实际不符；`govulncheck`/`npm audit` 结果见 §6.2；Dockerfile 基础镜像为浮动 tag。
- **建议**：加 `gofmt -l`、`govulncheck`、`npm audit --audit-level=high`（先只对 dev 依赖告警）、`go test -race`（至少 `core`/`antiad`/`store`）；Actions 固定到 commit SHA；基础镜像固定 digest 或至少 patch tag；加 Dependabot/Renovate；镜像扫描（Trivy/Grype）与 SBOM（syft）作为发布门禁或旁路报告。
- **预估影响**：已知漏洞与格式漂移不再能「绿着」进 main；发布物可追溯。
- **依赖**：M4（尚未建子 issue，见 §9）。

#### O-20 测试覆盖

- **问题**：`tasks.go` 0%、`main` 42.1%、`mtproto` 18.2%、`panel` 55.6%；本次发现的备份/清理/健康检查/panic 路径没有回归。
- **证据**：§1.2 覆盖率输出；§7.1 列表。
- **建议**：优先补 O-01/O-02/O-03/O-04/O-05/O-09 的行为测试；用表驱动覆盖队列满/超时/空响应；不要为覆盖率引入大量 mock 抽象。
- **预估影响**：上述缺陷修复后不回退；M1/M2/M3 验收有可执行证据。
- **依赖**：对应 M1/M2/M3。

#### O-21 文档与交接同步

- **问题**：HANDOFF/README/docs 多处落后于 main；新接手会按旧命令、旧路径、旧供应商操作。
- **证据**：§7.2 表。
- **建议**：把 HANDOFF 标注为「2026-09-28 历史快照」并指向本报告；修 `CLAUDE.md` 断链；把 gofmt/CI、保留期、Turnstile/hCaptcha/Cap、Vite→rsbuild、MUI→Base UI、仓库路径一次改齐；在 CI 加一个简单的链接/命令检查（可选）。
- **预估影响**：减少部署/排障误操作；让路线图的验收口径可被后来者读懂。
- **依赖**：无（可随本 PR 或后续 docs PR）。

## 9. M1–M4 范围校准

父 issue 当前把优化分成 A 数据安全、B 可观测性/容量、C 性能/成本、D 供应链/CI，
但子 issue 只建了 M1/M2/M3，**M4 尚未建**。建议按下面校准后再提升 stage：

| 子任务 | 保留 | 需要补充/修正 | 依赖 |
|---|---|---|---|
| M1（CODE-40）数据安全 | `VACUUM INTO`、保留 7 份、失败重试、恢复演练 | 把 `archive/` 纳入备份范围；启动 `quick_check`、备份后 `integrity_check`；备份/DB/日志/归档 `0600`；`auto_vacuum`/`VACUUM` 空间回收；归档文件保留期与重复导出去重 | 无 |
| M2（CODE-41）可观测性 | `/metrics` 最小集、受控 pprof、标签纪律、文档 | 把 `/healthz` 升级为 readiness（DB/bot/更新年龄）；补队列丢弃、AI 重试/延迟、DB/WAL/归档体积、备份年龄、localvision 队列；后台任务 panic 计数与隔离 | M1 的备份指标 |
| M3（CODE-42）性能/成本 | 判定链路 p50/p95、token/成本、热点 SQL、localvision、before/after | 修正「初判 Shared ≤50」为「复判 50，初判每 bot 32 无全局闸」；加初判全局并发与 `trust=95` 复判率基线；加单写连接/`ai_log` 写入/归档写入；修 20MB/5MB 下载上限与 OCR 全尺寸输入 | M2 指标 |
| M4（未建）供应链与 CI | — | 新增：gofmt、govulncheck、npm audit、race、action SHA、基础镜像 digest、SBOM/镜像扫描、依赖更新；公开端点限流与安全头、文件权限可作为 D 的安全面或拆独立小 issue | 无 |

建议在父 issue 的「顺序」里明确：**stage 3 提升前先创建 M4 子 issue**；
否则 D 没有承接者，stage 3 无法按「子任务全部 closed」收口。

## 10. 假设与未验证

- 未连接生产库/真实 bot/真实上游；所有性能数字是合成库与静态推断，M3 需用脱敏快照/合成流量复跑。
- 合成库的 70 MB/17,559 freelist 是 200k+200k 行、普通 journal 模式的结果；生产 WAL 下绝对值不同，但「DELETE 不缩文件」的性质一致。
- 文件 `0644` 是按默认 umask 与代码未 chmod 推断；部署机 umask 可能不同，M1/M4 应在启动时检查实际权限。
- `govulncheck` 使用本地 Go 1.27.3；CI/部署的 1.25.5 工具链需重跑，标准库漏洞结论可能不同。
- `npm audit` 的 2 个 high 只在 dev 依赖；生产依赖 `--omit=dev` 为 0。升级仍建议做，因为构建机被入侵同样影响供应链。
- 未做真实 Telegram/AI/人机验证端到端；`HANDOFF.md` 记录的「真实处罚→申诉→兑换」外部阻塞仍然成立。
- 未评估 `ruleagent`（AI 必封规则）的长期成本与并发；它默认手动/关闭，但一旦运行会扫全库，M3/M4 可在需要时单列。

## 11. 附录：关键命令与证据

```bash
# 基线
git rev-parse HEAD
# 45dd0aacec4f150a4fe8c70f429d19195a4e9110

go test ./...
go vet ./...
gofmt -l .
go build ./...

go test ./... -coverprofile=/tmp/menshen-cover.out
go tool cover -func=/tmp/menshen-cover.out | tail -1
# total: (statements) 69.2%

npm ci --prefix web --no-audit --no-fund
npm --prefix web run test       # 52 files / 510 tests
npm --prefix web run lint
npm --prefix web run typecheck
npm --prefix web run build

go run golang.org/x/vuln/cmd/govulncheck@latest ./...
# 3 reachable: brotli 1.2.1, klauspost/compress 1.19.1, net/http 1.27.3

npm audit --prefix web --package-lock-only --json
# 2 high (dev only); npm audit --omit=dev = 0
```

合成库查询计划（摘录）：

```text
SELECT ... WHERE bot_id IN (1,2,3) AND action LIKE 'deleted%'
  -> SCAN antiad_log

SELECT ... WHERE bot_id IN (1,2,3) AND (text LIKE ? OR reason LIKE ?)
  -> SCAN antiad_log

SELECT ... FROM appeals WHERE bot_id IN (1,2,3) ... ORDER BY id DESC
  -> SCAN appeals

SELECT ... FROM group_messages WHERE chat_id=? AND user_id=? ... ORDER BY at DESC, message_id DESC
  -> SEARCH ... USING INDEX idx_gmsg_user
     USE TEMP B-TREE FOR RIGHT PART OF ORDER BY
```

合成库体积：

```text
200k antiad_log + 200k group_messages  -> 70 MB
DELETE all                              -> 70 MB
PRAGMA freelist_count = 17559
PRAGMA page_size       = 4096
PRAGMA auto_vacuum     = 0
```
