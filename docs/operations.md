# 运维：指标、告警与排障

面向部署与值班：如何采集 `/metrics`、哪些告警值得开、就绪检查与 pprof
的边界。判定逻辑见 [判定链路](how-it-works.md)，部署见
[部署与接入](deployment.md)。

## 端点与鉴权

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

### 就绪检查

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

### pprof

默认关闭。显式开启后只允许回环或 Bearer：

```bash
go tool pprof -top "http://127.0.0.1:8081/debug/pprof/profile?seconds=30"
go tool pprof -top "https://ad.example.com/debug/pprof/heap"   # 需要 Bearer 时用 -http-header
```

排障结束关掉，不要长期常开。

## 采集配置

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

## 指标清单

标签纪律：只允许 bot 内部 ID、路由、模型、上游、状态、队列名这类低基数
取值；**不暴露** token、chat_id、用户 ID、消息正文、申诉签名。模型与
上游标签来自配置，条目数有界。

### 进程

| 指标 | 类型 | 标签 | 说明 |
|---|---|---|---|
| `menshen_build_info` | gauge | version | 恒 1 |
| `menshen_start_time_seconds` | gauge | — | 进程启动 unix 秒 |
| `menshen_goroutines` | gauge | — | goroutine 数 |
| `menshen_memory_bytes` | gauge | kind | alloc/sys/heap_alloc/heap_sys/heap_inuse/stack_inuse |
| `menshen_bots_running` | gauge | — | 运行中的 bot 实例 |
| `menshen_panics_total` | counter | component | 被隔离的后台 panic（ad_worker/update_worker/polling_dispatch） |

### 入站与队列

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

### 判定与 AI

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

### 识图

| 指标 | 类型 | 标签 |
|---|---|---|
| `menshen_localvision_requests_total` | counter | group=ocr/nsfw, result=ok/error |
| `menshen_localvision_duration_seconds` | histogram | group |
| `menshen_localvision_queue_depth` | gauge | — |

只统计真正送进 Python worker 的调用；命中内存缓存的不算请求。槽位上限
是 4，占满时新请求直接失败（不计入排队）。

### 容量与业务积压

| 指标 | 类型 | 说明 |
|---|---|---|
| `menshen_db_size_bytes` | gauge | 主库文件 |
| `menshen_db_wal_size_bytes` | gauge | `-wal` 文件 |
| `menshen_db_free_bytes` | gauge | `freelist_count × page_size`，只删行不缩文件时升高 |
| `menshen_archive_size_bytes` | gauge | 归档目录体积（30 秒缓存） |
| `menshen_backup_last_success_timestamp_seconds` | gauge | 备份目录最新文件时间；没有备份时**无样本** |
| `menshen_appeals_open` | gauge | 未结申诉 |
| `menshen_join_verify_pending` | gauge | 待验证入群 |

备份指标从数据库同目录的 `backups/` 读取，由 M1（CODE-40）的备份任务写入。
在备份任务落地前该指标没有样本，用 `absent()` 告警即可，不会把「从未备份」
伪装成 epoch 0。

## 告警阈值建议

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

## 排障顺序

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
   `VACUUM`/空间回收（见 M1）。
5. 进程异常：`panics_total` 增量 + 日志里的 `后台任务 panic，已隔离`，
   必要时临时开 pprof 抓 goroutine / heap，抓完关掉。
