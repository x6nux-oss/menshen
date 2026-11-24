# 运维：指标、告警、备份与排障

面向部署与值班：如何采集 `/metrics`、哪些告警值得开、就绪检查与 pprof
的边界，以及 SQLite 的备份、恢复、完整性校验与磁盘回收。判定逻辑见
[判定链路](how-it-works.md)，部署见 [部署与接入](deployment.md)。

## 1. 端点与鉴权

三个端点都挂在同一个 HTTP 监听上（`listen_addr`，默认
`127.0.0.1:8081`）。webhook 模式下与回调共用端口；长轮询模式下进程会
单独起一个只含这三个端点的服务，不会多开一条 webhook 入口。

| 端点 | 方法 | 鉴权 | 说明 |
|---|---|---|---|
| `/healthz` | GET/HEAD | 无 | 就绪检查，失败 503 |
| `/metrics` | GET/HEAD | 回环或 Bearer | Prometheus 文本格式 |
| `/debug/pprof/` | GET | 回环或 Bearer | 默认关闭，`pprof_enabled: true` 才注册 |

**回环**指对端地址是 `127.0.0.1`/`::1`，且请求不带
`X-Forwarded-For`、`X-Real-IP`、`CF-Connecting-IP`、`Forwarded` 任一
转发头。部署在 nginx / Cloudflare 后面时，外部请求经反代进来对端也是
回环，所以带转发头的一律按外部处理：必须给 Bearer。

`metrics_token` 为空时，外部请求再带什么令牌都拒绝（401）。配了之后：

```yaml
metrics_token: "换成随机长串"
pprof_enabled: false   # 需要时再开
```

```bash
# 本机
curl -s http://127.0.0.1:8081/metrics | head

# 经反代或从别的机器
curl -s -H "Authorization: Bearer $TOKEN" https://ad.example.com/metrics
```

⚠️ 不要把 `/metrics`、`/debug/pprof/` 放进公开反代而不配 token。即使
监听在回环，反代转发时也可能补上转发头；补了头就不算回环，会要求
Bearer。最稳妥是只在监控网段暴露，或在反代层再加一层白名单。

### 1.1 就绪检查

`/healthz` 成功返回 `200 ok`，失败返回 `503 not ready: <原因>`：

| 原因 | 含义 |
|---|---|
| `database unreadable` | 读连接 2 秒内查不了库（损坏、锁死、文件被删） |
| `no running bots` | 没有任何 bot 实例在跑（启动失败或全部停用） |
| `no input received` | 进程运行超过阈值却从未收到更新/轮询结果 |
| `input silent for ...` | 最近一次输入超过阈值 |

阈值：轮询模式 2 分钟（getUpdates 每 25 秒必有一次返回，空的也算）；
webhook 模式 24 小时（安静的群本来就可能整夜没有消息，不能用生产
环境的自然静默把实例摘掉）。webhook 模式下「输入断流」更适合看
`menshen_last_update_timestamp_seconds` 做告警，而不是靠就绪检查。

反代与编排按 `/healthz` 摘流量即可；进程存活（liveness）仍可看端口
是否可连。

### 1.2 pprof

默认关闭。显式开启后只允许回环或 Bearer：

```bash
go tool pprof -top "http://127.0.0.1:8081/debug/pprof/profile?seconds=30"
go tool pprof -top "https://ad.example.com/debug/pprof/heap"   # 需要 Bearer 时用 -http-header
```

排障结束关掉，不要长期常开。

### 1.3 公开端点限流与安全头

浏览器可直达的端点按「每 IP 每分钟」限流，超限返回 `429` 与
`Retry-After: 60`，并计入 `menshen_rate_limited_total{route}`：

| 端点 | 上限/分钟 | 说明 |
|---|---|---|
| `/_w/*` | 120 | 申诉、验证、原文查看的数据接口与页面壳 |
| `/admin/login/*` | 30 | 登录链接本身一次性；限流挡暴力探测 |
| `/admin/api/*` | 300 | 后台页面的一次加载会并发多个请求，留足余量 |
| `/miniapp/api/*` | 300 | 同上 |
| `/cap/*` | 120 | 内置 Cap 的 challenge/redeem/siteverify |
| `/healthz` | 不限 | 编排与监控探针；限流会把它误判成实例不健康 |
| webhook `/<token>/webhook` | 不限 | 投递量由群活跃度决定，按 IP 限流会丢真实更新 |

「IP」取 `client_ip_header`（如 `CF-Connecting-IP`、`X-Real-IP`），未配置时取
对端地址。**部署在反代后面却没配这个头时，所有外部请求共用一个窗口**——
上表会变成全站总限额，高峰时可能误伤；此时必须让反代传入真实 IP，或直接
把应用监听到回环、由反代补头。

响应安全头由 HTTP 层统一添加：

| 头 | 值 | 范围 |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | 全部 |
| `Referrer-Policy` | `no-referrer` | 全部 |
| `X-Frame-Options` | `DENY` | 除 `/miniapp` 外全部（Telegram Web 用 iframe 承载 Mini App） |
| `Strict-Transport-Security` | `max-age=31536000` | `public_url` 是 `https://` 时 |
| `Content-Security-Policy` | 按页面 | 公开页放行验证码来源；后台 `frame-ancestors 'none'`；Mini App 只允许 Telegram 框架 |

CSP 的脚本来源都是同源产物（Telegram SDK 自托管），升级前端构建工具后
若出现内联脚本，需要同步改 CSP，否则页面会白屏但接口仍正常。

## 2. 采集配置

Prometheus 最小配置：

```yaml
scrape_configs:
  - job_name: menshen
    scrape_interval: 30s
    scheme: https
    authorization:
      type: Bearer
      credentials_file: /etc/prometheus/menshen-token
    static_configs:
      - targets: ["ad.example.com"]
```

`/metrics` 的抓取会查询几条 SQLite 计数与目录体积；归档目录体积有 30 秒
缓存，抓取间隔不必低于 30 秒。

## 3. 指标清单

标签纪律：只允许 bot 内部 ID、路由、模型、上游、状态、队列名这类低基数
取值；**不暴露** token、chat_id、用户 ID、消息正文、申诉签名。模型与
上游标签来自配置，条目数有界。

### 3.1 进程

| 指标 | 类型 | 标签 | 说明 |
|---|---|---|---|
| `menshen_build_info` | gauge | version | 恒 1 |
| `menshen_start_time_seconds` | gauge | — | 进程启动 unix 秒 |
| `menshen_goroutines` | gauge | — | goroutine 数 |
| `menshen_memory_bytes` | gauge | kind | alloc/sys/heap_alloc/heap_sys/heap_inuse/stack_inuse |
| `menshen_bots_running` | gauge | — | 运行中的 bot 实例 |
| `menshen_panics_total` | counter | component | 被隔离的后台 panic（ad_worker/update_worker/polling_dispatch） |

### 3.2 入站与队列

| 指标 | 类型 | 标签 |
|---|---|---|
| `menshen_http_requests_total` | counter | route, method, status |
| `menshen_http_request_duration_seconds` | histogram | route, method |
| `menshen_rate_limited_total` | counter | route |
| `menshen_webhook_updates_total` | counter | bot, result=accepted/duplicate/dropped/unauthorized/bad_body |
| `menshen_queue_depth` | gauge | bot, queue=updates/ad/review |
| `menshen_ad_busy` | gauge | bot |
| `menshen_review_gate_used` | gauge | — | 复判全局并发闸占用（上限 50） |
| `menshen_last_update_timestamp_seconds` | gauge | — |
| `menshen_last_poll_timestamp_seconds` | gauge | — |

### 3.3 判定与 AI

| 指标 | 类型 | 标签 |
|---|---|---|
| `menshen_judgements_total` | counter | bot, verdict=ad/clean/error/skipped, action |
| `menshen_judgement_duration_seconds` | histogram | bot |
| `menshen_ai_requests_total` | counter | endpoint, model, upstream, status |
| `menshen_ai_request_duration_seconds` | histogram | endpoint, model, upstream |
| `menshen_ai_tokens_total` | counter | endpoint, model, kind=prompt/completion/cache_read/cache_write |
| `menshen_ai_cost_quota_total` | counter | endpoint, model |
| `menshen_ai_retries_total` | counter | endpoint, model |
| `menshen_ai_fail_streak` | gauge | — |
| `menshen_hedge_active` | gauge | endpoint, models |

`judgement_duration_seconds` 是整条判定链路（识图 → 初判 → 复判 →
处置）；AI 请求耗时按每次真实上游尝试记录，重试与并发各记一笔。

### 3.4 识图

| 指标 | 类型 | 标签 |
|---|---|---|
| `menshen_localvision_requests_total` | counter | group=ocr/nsfw, result=ok/error |
| `menshen_localvision_duration_seconds` | histogram | group |
| `menshen_localvision_queue_depth` | gauge | — |

只统计真正送进 Python worker 的调用；命中内存缓存的不算请求。槽位上限
是 4，占满时新请求直接失败（不计入排队）。

### 3.5 容量与业务积压

| 指标 | 类型 | 说明 |
|---|---|---|
| `menshen_db_size_bytes` | gauge | 主库文件 |
| `menshen_db_wal_size_bytes` | gauge | `-wal` 文件 |
| `menshen_db_free_bytes` | gauge | `freelist_count × page_size`，只删行不缩文件时升高 |
| `menshen_archive_size_bytes` | gauge | 归档目录体积（30 秒缓存） |
| `menshen_backup_last_success_timestamp_seconds` | gauge | 备份目录最新文件时间；没有备份时**无样本** |
| `menshen_appeals_open` | gauge | 未结申诉 |
| `menshen_join_verify_pending` | gauge | 待验证入群 |

备份指标从数据库同目录的 `backups/` 读取，由每日备份任务写入（见 §6）。
备份任务尚未跑过时该指标没有样本，用 `absent()` 告警即可，不会把「从未备份」
伪装成 epoch 0；成功备份过的旧目录在保留轮转后仍然计入最新时间。

## 4. 告警阈值建议

阈值按单群量级调；先观察一周再收紧。

```yaml
groups:
  - name: menshen
    rules:
      - alert: MenshenDown
        expr: up{job="menshen"} == 0
        for: 2m

      - alert: MenshenNotReady
        expr: probe_success{job="menshen-healthz"} == 0   # blackbox_exporter 探 /healthz
        for: 5m

      - alert: MenshenInputSilent
        expr: time() - menshen_last_update_timestamp_seconds > 3600
        for: 10m
        # 安静的小群可调大；webhook 模式才适用

      - alert: MenshenWebhookDrops
        expr: increase(menshen_webhook_updates_total{result="dropped"}[5m]) > 0
        for: 5m

      - alert: MenshenQueueBacklog
        expr: menshen_queue_depth{queue="updates"} > 200
        for: 5m
      - alert: MenshenJudgeBacklog
        expr: menshen_queue_depth{queue=~"ad|review"} > 800
        for: 10m

      - alert: MenshenAIErrorRate
        expr: |
          sum(rate(menshen_ai_requests_total{status="error"}[10m]))
            / sum(rate(menshen_ai_requests_total[10m])) > 0.2
        for: 10m

      - alert: MenshenAIFailStreak
        expr: menshen_ai_fail_streak >= 5
        for: 5m

      - alert: MenshenJudgementSlow
        expr: histogram_quantile(0.95,
          sum by (le) (rate(menshen_judgement_duration_seconds_bucket[10m]))) > 20
        for: 10m

      - alert: MenshenPanics
        expr: increase(menshen_panics_total[10m]) > 0

      - alert: MenshenDBFreelistHigh
        expr: menshen_db_free_bytes / menshen_db_size_bytes > 0.5
        for: 1h

      - alert: MenshenArchiveGrowing
        expr: deriv(menshen_archive_size_bytes[6h]) > 1e8   # 100 MB/h，按盘量调
        for: 1h

      - alert: MenshenBackupMissing
        expr: absent(menshen_backup_last_success_timestamp_seconds)
        for: 26h
      - alert: MenshenBackupStale
        expr: time() - menshen_backup_last_success_timestamp_seconds > 172800
        for: 1h

      - alert: MenshenGoroutineLeak
        expr: menshen_goroutines > 2000
        for: 30m
```

## 5. 数据分布与权限

门神只有一份 SQLite（`data.db`）和一个归档目录（默认 `archive/`），没有
外部数据库。命令里的路径按默认部署（库在 `/app/data`）写，实际以
`config.yaml` / 环境变量里的 `db_path`、`archive_dir` 为准。

| 路径 | 内容 | 权限 |
|---|---|---|
| `<db_path>` | 配置、上游密钥、bot token、名单、申诉、判定流水 | `0600` |
| `<db_path>-wal` / `-shm` | SQLite 边车 | `0600` |
| `<db_path 去掉扩展名>.log` | 运行日志（滚动 `.1`…） | `0600` |
| `archive/`（或 `archive_dir`） | 群消息与判定 JSONL、图片、头像 | 目录 `0700`，文件 `0600` |
| `backups/`（默认库同目录） | 每日备份，整目录 | 目录 `0700`，文件 `0600` |

启动时会把库、WAL/SHM、数据目录、日志文件的权限纠正到上表；归档目录由
小时维护任务遍历纠正（文件 `0600`、目录 `0700`）。容器部署请给数据卷设
`umask 077`，避免进程外写出的临时文件落到 `0644`。

### 5.1 密钥与凭据

库、日志与备份里都有明文凭据，按「等同生产密码」对待：备份外发前先加密，
不要把 `data.db`、`data.db-wal`、`backups/` 或 `archive/` 直接发到聊天、工单
或公开对象存储。

| 凭据 | 存放 | 用途 | 轮换 |
|---|---|---|---|
| `web_secret` | `settings` 表，明文，32 字节随机 hex | 申诉/入群验证链接、后台登录链接与会话、内置 Cap 令牌的 HMAC 密钥 | 停服 → 删除该行 → 起服自动重生；所有已发链接、后台会话、未兑换的 Cap 令牌同时失效 |
| bot token | `bots` 表，明文；日志只出现 `123456789:***` | bot 的完整控制权 | BotFather `/revoke` 后立即失效；在面板移除旧 bot、重新登记新 token，回调会重注册 |
| Turnstile / 入群验证 Secret | `turnstile_secret` 在配置文件；`captcha_secret` 在 `settings` 表 | 服务端校验人机验证令牌 | 在各家后台轮换 → 更新配置/环境变量或面板 → 重启；旧令牌全部失效 |
| 上游 API Key | `upstreams` 表，明文；面板只显示 `MaskKey` 结果 | 调用 AI 上游 | 在服务商后台轮换 → 面板更新对应上游 |

`web_secret` 轮换（随机密钥只由进程生成，不要在面板或配置文件里手填）：

```sh
systemctl stop menshen            # 或 docker compose stop menshen
sqlite3 /app/data/data.db "DELETE FROM settings WHERE k='web_secret';"
systemctl start menshen           # webhook 启动时重新生成并写回
```

容器内没有 `sqlite3` CLI 时用 Python：`python3 -c "import sqlite3;c=sqlite3.connect('/app/data/data.db');c.execute(\"DELETE FROM settings WHERE k='web_secret'\");c.commit()"`。
轮换后提醒用户从 bot 重新获取登录/申诉链接。

登记 bot token 只在 bot 私聊里进行：收到后立即删除该条消息，落库后不再回显。
webhook 路径本身含 token（`<public_url>/<token>/webhook`），反代访问日志要
关闭路径记录或在日志层掩码 token；应用内日志已统一走 `config.MaskToken`。

代码侧约束（新增日志时沿用）：

- 不打印请求头、`initData`、申诉理由正文、验证码令牌或上游响应全文；
- 错误响应只给通用中文提示，不回显 token、签名、会话 cookie；
- `/metrics` 标签只用路由、bot 内部 ID、模型/上游名，不含原始路径或用户 ID；
- 密钥类设置（`web_secret`、`captcha_secret`）永不下发给浏览器或 Mini App。

## 6. 备份

### 6.1 默认行为

- **每天一份**（`backup_interval_hours`，默认 24），由进程内 goroutine 执行，
  不另起服务；失败每 10 分钟重试，最多 3 次，然后等下一个周期。
- 落在 `<db_path 同目录>/backups/<UTC 时间戳>/`：
  - `data.db`：`VACUUM INTO` 得到的一致性快照（读事务，WAL 下不挡写）；
  - `archive.tar`：归档目录打包（归档为空时没有这个文件）。
- **保留 7 份**（`backup_keep`），超出后从最旧的整目录删除。
- 顺序固定：先取库快照，再打包归档。归档只会比库里的去重索引新，
  不会出现「索引说已入档、文件却不在备份里」；恢复后 `/export` 还会按
  目标文件内容去重，不会追加重复行。
- 周期从磁盘上最新一份备份算起，进程重启不会把每日备份一直往后推。
- 备份失败写 `slog` 并私聊全部主管理员；不影响消息处理。

可在面板（全局设置 → **备份与维护**）调整：

| 设置 | 默认 | 说明 |
|---|---|---|
| `backup_enabled` | `1` | 关闭后不再自动备份（手动命令仍可用） |
| `backup_interval_hours` | `24` | 1–8760 小时 |
| `backup_keep` | `7` | 保留份数；备份目录的占用随它增长 |
| `archive_retention_days` | `90` | 归档文件保留天数，`0` = 永久 |

### 6.2 立即备份

```sh
./menshen -config /app/config.yaml -backup-now
# 输出备份目录，例如 /app/data/backups/20261124T030000Z
```

容器：

```sh
docker exec <容器> /app/menshen -config /app/config.yaml -backup-now
```

该命令不需要 Telegram 凭据；token 失效时也能取到最新快照。它同样执行
完整性校验与保留轮转。

### 6.3 异地保留

备份默认和库在同一个数据卷，**同卷损坏会一起丢**。生产至少把
`<data>/backups/` 定期同步到另一台机器或对象存储（`restic`、`rclone`、
宿主机 cron 均可），或把独立卷挂到 `backups/`。

## 7. 完整性校验

| 时机 | 命令 | 失败动作 |
|---|---|---|
| 启动 | `PRAGMA quick_check` | 写 `slog` + 私聊主管理员；服务不退出，按 §8 恢复 |
| 每次备份完成后 | 对备份文件 `PRAGMA integrity_check` | 该次备份作废，不进入保留轮转；告警 |
| 手动 | `./menshen -verify-db <path>` | 退出码非 0 |

手动校验任意库文件（包括恢复前先验备份）：

```sh
./menshen -verify-db /app/data/backups/20261124T030000Z/data.db
# INFO 完整性校验通过 db=... check=integrity_check
```

## 8. 恢复

**先停服，再替换。** 运行中的进程持有 WAL，边跑边换文件会得到不一致的库。

```sh
# 1) 停服
systemctl stop menshen
#   或 docker compose stop menshen

# 2) 列出备份，选一份（目录名是 UTC 时间）
ls -1 /app/data/backups

# 3) 恢复（脚本会：校验备份 → 旧库/归档挪到 .bak-<时间戳> → 替换并解包 → 再校验）
BIN=/app/menshen scripts/restore.sh \
    /app/data/backups/20261124T030000Z /app/data data.db

# 4) 起服
systemctl start menshen
```

恢复后的确认项：

1. 日志出现 `数据库完整性校验通过 check=quick_check`，无告警私聊；
2. 管理员私聊 `/status` 正常，且「数据盘」一行显示库/备份体积；
3. 抽查群配置、名单与申诉（`/export`、面板列表）；
4. 旧数据保留在 `data.db.bak-<时间戳>` 与 `archive.bak-<时间戳>`，确认
   无误后再删。

归档目录不是默认 `data_dir/archive` 时，先按 `archive_dir` 移回原处再
起服；恢复脚本只处理数据目录下的 `archive/`。

## 9. 恢复演练

验收脚本在临时目录里跑完整链路，不碰生产数据：

```sh
go build -o menshen .
scripts/backup-drill.sh
```

它依次执行：`-backup-now` → 删除库与归档 → `scripts/restore.sh` →
`-verify-db` → 核对归档 JSONL 仍在。任何一步失败都会非 0 退出。

## 10. 磁盘回收

### 10.1 空闲页

保留期清理只 `DELETE` 不还页，文件会只增不减。当前行为：

- 新库在 `store.Open` 时打开 `auto_vacuum=INCREMENTAL`；
- 每小时清理后执行 `PRAGMA incremental_vacuum(1000)`（约 4 MB/轮），
  持锁时间可忽略；
- 老库（`auto_vacuum=0`）只有在空闲页 ≥ 32 MB 且 ≥ 25% 时才做一次
  `VACUUM`，同时永久打开增量回收。`VACUUM` 会持写锁重写全库，库越大越久，
  这是老库迁移的一次性代价。

观测：管理员 `/status` 的「数据盘」一行给出 `库 / WAL / 备份 N 份 / 空闲页`
体积；小时日志 `数据空间统计` 同样有页大小、空闲页与 `auto_vacuum`。

### 10.2 归档保留

`archive_retention_days`（默认 90）按文件名日期清理 `archive/` 下的 JSONL
与图片；头像没有日期，按 mtime。`archive_items` 去重索引与归档文件同寿，
避免「索引删了、文件还在 → `/export` 重复追加」。`/export` 也会跳过保留期
之外的记录，并向目标文件内容去重。`0` = 永久保留。

### 10.3 备份占用

`backups/` 是独立目录，整目录参与保留轮转；保留份数 × (库 + 归档) 是它的
上限。归档很大时优先调小 `backup_keep` 或 `archive_retention_days`，并确认
数据卷余量。

## 11. 排障与故障处置

### 11.1 指标排障顺序

1. `/healthz` 503：先看原因，再看进程日志。`database unreadable` 优先查
   磁盘、权限、文件是否被移走。
2. 判定变慢：看 `menshen_judgement_duration_seconds` 的 p95，再拆
   `menshen_ai_request_duration_seconds`（上游慢）与
   `menshen_localvision_duration_seconds`（识图慢）。
3. 队列涨：`queue_depth{queue="updates"}` 涨说明更新处理被卡住；
   `ad`/`review` 涨说明判定 worker 被上游拖住。配合 `ai_fail_streak` 与
   `webhook_updates_total{result="dropped"}` 判断是否在丢更新。
4. 磁盘涨：对比 `db_size_bytes`、`db_wal_size_bytes`、`db_free_bytes`、
   `archive_size_bytes`、备份目录。`db_free_bytes` 占比高说明需要
   空间回收（见 §10.1）。
5. 进程异常：`panics_total` 增量 + 日志里的 `后台任务 panic，已隔离`，
   必要时临时开 pprof 抓 goroutine / heap，抓完关掉。

### 11.2 故障处置

| 现象 | 处理 |
|---|---|
| 收到「数据库备份失败」私聊 | 看日志里的错误：目录不可写 / 磁盘满最常见；腾空间或修权限后等下一轮（10 分钟内重试） |
| 启动告警「数据库完整性校验失败」 | 立即停写，按 §8 恢复；恢复前用 `-verify-db` 逐个验备份，选最新一份通过校验的 |
| `/status` 空闲页持续增长 | 老库未完成一次 `VACUUM`；检查日志是否报 `回收 SQLite 空闲页失败`（常见为写锁超时） |
| 归档目录被删错 | 从最近一份 `archive.tar` 解到 `archive_dir`；库里的索引会与文件对齐 |
| 恢复后 `/export` 少补了某天 | 该记录可能仍在保留期外；这是有意行为，见 §10.2 |
