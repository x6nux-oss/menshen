# 性能与成本基线（M3，2026-11-24）

> 对象：`x6nux-oss/menshen`，`main@2181682` + 本分支。
> 方法：本地合成 SQLite + 假 AI 上游，不连真实模型、不碰生产库。
> 审计依据：`docs/reviews/2026-11-23-menshen-optimization-audit.md` §4/§9。

## 0. 结论

1. **面板最贵的是 COUNT 与无索引筛选，不是列表本身。** 修复后默认「已删除」
   列表 p50 从 53~61 ms 降到 13~27 ms，`verdict=ad` 从 45~48 ms 降到
   1.0~1.2 ms，次管申诉列表从 19~25 ms 降到 1.3 ms（20 万行合成库）。
2. **默认采信线 95 在合成误差模型下是唯一 0 漏判的点。** 降到 90/85
   省 22%/49% 成本，但漏判率从 0% 升到 10.7%/27.7%。广告结论因要处罚
   本来就会复判，采信线只影响正常消息，所以它不是一个有效的「省钱旋钮」。
3. **初判没有全局闸的扇出被实测确认。** 2 个 bot、每 bot 100 条突发时
   观测到 106 个同时在飞的上游请求（32 初判 + 32 复判 worker 各自扇出）。
   没有真实上游配额数据前不引入全局闸，避免用吞吐换一个未证明的 429 收益。
4. **写路径不是当前瓶颈。** 单写连接下 `logAd` p50 0.04 ms，`ai_log`
   满载 64 KB 行 0.24 ms；把上限砍到 16 KB 只省约 0.17 ms，不值得丢调试数据。
5. **识图的两个真问题已修**：20 MB 声明与 5 MB 实际下载上限不一致；
   OCR 前未缩图。24 MP 图在 OCR 前缩到 1.7 MP，像素数降 14 倍。

## 1. 环境与复跑

| 项 | 值 |
|---|---|
| 机器 | Apple M4，10 核，16 GB，macOS（darwin/arm64） |
| Go | 工具链 go1.27.3；`go.mod` 声明 1.25.5 |
| SQLite | `modernc.org/sqlite v1.56.0`，WAL，`synchronous=NORMAL`，单写连接 |
| 负载 | 测试期间共享主机 load average 22~51（10 核），绝对延迟是偏保守的上界 |
| 合成库 | 20 万 `antiad_log`、5 万 `appeals`、20 万 `group_messages`、2 万 `ai_log`，约 100 MB |

```bash
# 全部基线（约 1 分钟；默认 20 万行、30 次采样）
./scripts/perf-baseline.sh

# 单独跑 / 调整规模
MENSHEN_PERF=1 go test ./internal/panel -run TestPerfSQLBaseline -v -count=1
MENSHEN_PERF=1 go test ./internal/antiad -run TestPerfJudgeBaseline -v -count=1
MENSHEN_PERF=1 go test ./internal/antiad -run TestPerfWriteBaseline -v -count=1

# 真实 localvision 模型（需要本机模型目录；本机未跑）
MENSHEN_PERF=1 MENSHEN_LOCAL_MODELS_TEST_DIR=/path/to/models \
  go test ./internal/localvision -run TestPerfRealOfflineModels -v -count=1
```

比较 before/after 必须在同一台机器、同一负载下跑；共享主机上的单次 p95
会被邻居任务放大，优先看 p50 与同进程 A/B 的比例。

## 2. 面板 SQL

合成库：4 个 bot、20 个群、5,000 个用户；10% 的 `antiad_log` 带
`deleted%` 处置；50,000 张申诉单。每次调用走完整 Mini App 鉴权 + JSON 编码。

### 2.1 基线（M3 前索引）

| 操作 | p50 | p95 |
|---|---|---|
| 流水全部 p1 | 3.59 ms | 5.03 ms |
| 流水已删除 p1 | 60.95 ms | 69.69 ms |
| 流水已删除 p500（OFFSET 9980） | 75.72 ms | 79.47 ms |
| 流水 ad p1 | 45.41 ms | 49.65 ms |
| 流水 clean p1 | 47.87 ms | 48.86 ms |
| 流水搜索 `q=推广` | 101.25 ms | 107.48 ms |
| 流水按用户 | 0.17 ms | 0.30 ms |
| 次管流水 p1（2 个 bot） | 116.90 ms | 132.15 ms |
| 次管流水 p500 | 123.82 ms | 138.38 ms |
| 申诉 p1 | 0.99 ms | 1.64 ms |
| 申诉未结 p1 | 2.28 ms | 2.84 ms |
| 次管申诉 p1 | 18.64 ms | 26.71 ms |
| 次管申诉 p500 | 96.76 ms | 132.61 ms |
| `state` 工作台 | 5.17 ms | 7.37 ms |
| 用户资料 + 流水 | 0.22 ms | 0.96 ms |

关键查询计划（M3 前）：

| 查询 | 计划 |
|---|---|
| 次管流水列表 | `SEARCH antiad_log USING COVERING INDEX idx_antiad_bot_time (bot_id=?)` + `USE TEMP B-TREE FOR ORDER BY` |
| 次管申诉列表 | `SEARCH appeals USING COVERING INDEX idx_appeal_user (bot_id=?)` + `USE TEMP B-TREE FOR ORDER BY` |
| 流水搜索 | `SCAN antiad_log` |
| recent_context | `SEARCH group_messages USING INDEX idx_gmsg_user ...` + `USE TEMP B-TREE FOR LAST TERM OF ORDER BY` |
| 未结申诉计数 | `SCAN appeals` |

### 2.2 索引后的 before/after

同进程、同数据、同一轮测试，只切索引：

| 操作 | before p50 | after p50 | 变化 |
|---|---|---|---|
| 流水已删除 p1 | 60.95 ms | 13.53 ms | -78% |
| 流水已删除 p500 | 75.72 ms | 34.92 ms | -54% |
| 流水 ad p1 | 45.41 ms | 1.19 ms | -97% |
| 流水 clean p1 | 47.87 ms | 8.40 ms | -82% |
| 次管申诉 p1 | 18.64 ms | 1.30 ms | -93% |
| 次管申诉 p500 | 96.76 ms | 23.79 ms | -75% |

查询级 A/B（10 次取样，排除 HTTP/JSON 噪声）：

| 查询 | 无索引 | `(action,id)` | `(verdict,id)` |
|---|---|---|---|
| `action LIKE 'deleted%'` COUNT | 37~114 ms | 16~19 ms | — |
| `verdict='ad'` COUNT | 24~69 ms | — | 0.9~1.8 ms |
| `verdict IN ('clean','none')` COUNT | 25~57 ms | — | 12~16 ms |

已采用：

```sql
CREATE INDEX IF NOT EXISTS idx_appeal_bot_id   ON appeals(bot_id, id);
CREATE INDEX IF NOT EXISTS idx_antiad_action_id ON antiad_log(action, id);
CREATE INDEX IF NOT EXISTS idx_antiad_verdict_id ON antiad_log(verdict, id);
```

`idx_antiad_action_id` 对次管视角的 COUNT 没有稳定收益（`bot_id IN` 仍要
过滤），但对主管理员的默认「已删除」视图是 2~4 倍；写成本在下一节测为噪声级。

**仍未解决**：次管流水 p1 仍在 160 ms 量级，因为 `COUNT(*)` 要扫其名下
10 万行；`q` 搜索是 `LIKE '%…%'` 全表扫描（70~100 ms）。这两项需要
「默认 30 天时间窗」或 FTS5/keyset，属于产品与 API 语义改动，见 §8。

## 3. 判定链路

假上游零延迟；300 条样本/档，40% 广告，其中 25% 被初判漏掉（`clean`
置信度 0.86~0.94），15% 正常消息被初判误判为广告。复判按 ground truth
给出结论，因此「漏判」只来自采信线以下没有送复判的初判漏判。

| 采信线 | 复判率 | 漏判率 | 误判率 | 单条成本 | 同步段 p50/p95 | 端到端 p50/p95 |
|---|---|---|---|---|---|---|
| 95 | 87.3% | 0.0% | 0.0% | $0.003479 | 0.13/0.23 ms | 0.66/1.49 ms |
| 90 | 67.3% | 10.7% | 0.0% | $0.002719 | 0.15/0.29 ms | 0.66/1.63 ms |
| 85 | 42.7% | 27.7% | 0.0% | $0.001781 | 0.15/0.27 ms | 0.58/1.76 ms |

- 成本按 mock 用量 900/40（初判）、1200/80（复判）token 与 models 表
  `so-model $0.15/$0.6`、`llm-model $2.5/$10` 每百万 token 折算；
  真实成本随实际用量线性变化，不能直接当生产账单。
- 误判率三档都是 0：广告结论会触发禁言/封禁，`needReview` 因 `act.Mute`
  强制复判，复判把误判纠回来；采信线只决定**正常**消息要不要多问一次。
- 端到端 p50/p95 只含本地编排、SQLite 与假 HTTP；真实模型的首字/生成
  时间不在这组数字里。SO/LLM 的 `ai_log.latency_ms` 在 mock 下都是
  `<1 ms`（整数毫秒取整），不能代表真实上游。

### 3.1 并发扇出

2 个 bot、每 bot 32 初判 + 32 复判 worker，共用同一个假上游；
每 bot 同时投 100 条，mock 每请求延迟 20 ms：

| 指标 | 实测 |
|---|---|
| 同时在飞的上游请求（峰值） | 106 |
| 200 条全部跑完 | 132 ms |

这确认了审计 §4.1：初判没有 Shared 级闸，N 个 bot 时扇出按 bot 数放大。
本轮**没有**加闸：没有真实上游的 429/超时基线，任何默认值都是猜的；
用 M2 的 `/metrics` 在真实部署里采一周 `ai_requests_active` / 429 / p95
后再定值。

## 4. 写路径

单写连接、WAL、`synchronous=NORMAL`，200 次写入取样：

| 写入 | p50 | p95 |
|---|---|---|
| `touchMember` UPSERT RETURNING | 0.03 ms | 0.13 ms |
| `recordMessage` 留底 UPSERT | 0.02 ms | 0.04 ms |
| `logAd`（无 verdict 索引） | 0.04 ms | 0.13 ms |
| `logAd`（有 verdict 索引） | 0.04 ms | 0.14 ms |
| `logAICall` 64 KB 正文 | 0.24 ms | 0.76 ms |
| `logAICall` 16 KB 正文 | 0.07 ms | 0.24 ms |

- 新索引对 `logAd` 的写成本在 0.01 ms 的测量噪声内。
- `ai_log` 满载行确实比小行慢 3 倍，但绝对值只有 0.24 ms；且固定提示词
  已被剥离，多数行远小于 64 KB。把上限从 64 KB 砍到 16 KB 只省约
  0.17 ms/次，换来的是排查上游问题时缺证据 —— 不采用。
- 归档开启时的写放大本轮没有单独压测；归档默认关闭，且审计已把
  「按日 buffered writer」列为 M3 低优先级项。当前证据不足以支持改动。

## 5. 识图

### 5.1 下载上限

`visionFileMax = 20 MB`，但 `fetchTGFile` 曾调用默认 5 MB 的
`DownloadFile`：5~20 MB 的图会先通过大小检查，再在下载时静默失败。
已改为 `DownloadFileLimit(..., visionFileMax)`，并用 6 MB 响应加了回归测试
（`TestFetchTGFileHonorsVisionLimit`）。

### 5.2 OCR 前缩图

`worker.py` 在 OCR 前把长边缩到 1600（`_OCR_MAX_SIDE`），NSFW 的 384
预处理不变。2400 万像素 → 170 万像素，RapidOCR 的检测/识别像素量降 14 倍。

本机（无模型，仅 PIL 解码 + 缩图）对 6000×4000 JPEG 的测量：

| 步骤 | p50 | p95 |
|---|---|---|
| JPEG 解码 + RGB 转换 | 150.4 ms | 155.6 ms |
| 长边缩到 1600 | 148.8 ms | 158.3 ms |
| 进程 RSS 峰值（PIL 解码 24 MP） | 339 MB | — |

这组数字不含 OCR/NSFW 模型推理；真实模型耗时需要模型文件，命令见 §1。
本机缺 `rapidocr`，所以 `TestPerfRealOfflineModels` 是 skip；它会在有模型的
部署机上测 640×360 与 6000×4000 的 p50/p95，以及 8 路突发下 4 槽位的
接受/拒绝数。

当前队列语义（未改）：`Infer` 先抢 4 个 slot，满了立即返回「队列已满」；
拿到 slot 的请求再抢单个 Python worker 的 gate，串行执行。第 5 路不会排队，
直接失败；这是审计 §4.3 的背压现状，改成独立 vision worker 池是更大的改动，
本轮不做。

## 6. 改动清单

| 文件 | 改动 | 依据 |
|---|---|---|
| `internal/store/db.go` | 新增 `idx_appeal_bot_id`、`idx_antiad_action_id`、`idx_antiad_verdict_id` | §2 的 before/after |
| `internal/antiad/vision.go` | `fetchTGFile` 改用 20 MB 上限 | 声明与实现不一致 |
| `internal/localvision/worker.py` | OCR 输入长边 1600 | §5.2 像素量 |
| `internal/panel/perf_test.go` | 面板 SQL 基线 + 索引 A/B（`MENSHEN_PERF=1`） | 可复跑 |
| `internal/antiad/perf_test.go` | 判定/写路径基线（`MENSHEN_PERF=1`） | 可复跑 |
| `internal/localvision/perf_test.go` | 真实模型基线（需模型目录） | 可复跑 |
| `scripts/perf-baseline.sh` | 一键跑全部基线 | 复跑入口 |

判定语义、处置矩阵、默认采信线、并发上限都没有改。

## 7. 未采用 / 回滚的尝试

| 尝试 | 结果 | 原因 |
|---|---|---|
| `antiad_log(action,bot_id,id)` | 未采用 | 次管 COUNT 与 `(action,id)` 同量级，索引更宽 |
| `ai_log` 上限 64 KB → 16 KB | 未采用 | 只省 0.17 ms/次，丢上游排查证据 |
| 初判全局并发闸（默认 50） | 未采用 | 无真实上游 429 基线；会直接拉高 p95 |
| `group_messages(chat_id,user_id,at DESC,message_id DESC)` | 未采用 | 现有计划只对同秒 tie-break 用临时 B-tree，LIMIT 20 下无可测收益 |
| 默认采信线 95 → 90/85 | 未采用 | 成本省 22%/49%，漏判率升到 10.7%/27.7% |
| keyset 分页 / 30 天默认时间窗 / FTS5 | 未实现 | 改 API 与产品语义，需要另行确认 |

## 8. 剩余风险与下一步

1. **次管流水与搜索仍是慢路径**：次管列表（含 COUNT）10 万行约
   120~175 ms，`LIKE '%q%'` 约 70~100 ms；百万行时分别约 1.2~1.7 s /
   0.5~1 s。优先级最高，建议下一步
   做「默认 30 天窗口 + keyset 游标」，FTS5 只在确有中文分词方案时再上。
2. **深分页仍是 O(OFFSET)**：p500 在索引后仍有 35~55 ms；UI 的无限滚动
   如果允许翻到几千页，会再次变慢。keyset 是正解。
3. **真实上游未测**：本基线不能回答「上游 429 在多少并发开始」「真实
   token 成本是多少」「真实 p95 首字延迟」。需要 M2 `/metrics` 在生产
   采一周，再决定初判全局闸与模型档位。
4. **localvision 真实模型未测**：本机缺 `rapidocr`；缩图后的 OCR 质量
   仍需在有模型的机器上跑 `TestPerfRealOfflineModels` 与真实图片样本集，
   确认长边 1600 不降识别率。
5. **共享主机噪声**：本轮 load average 22~51，绝对值偏保守；上生产前
   在目标机型复跑同一脚本，记录 CPU 型号、磁盘类型与 DB 体积。
6. **升级启动会建索引**：三个新索引在 `ensureIndexes` 里对老库执行
   `CREATE INDEX`，百万行库首次启动会多几秒并持有写锁。建议低峰升级，
   并在升级前记录 `page_count` 与表行数，升级后确认索引已存在。

## 9. 验证记录（2026-11-24）

| 命令 | 结果 |
|---|---|
| `gofmt -l .` | 空 |
| `go vet ./...` | 通过 |
| `go test ./...` | 全部包通过 |
| `python3 -m unittest worker_test.OcrPreprocessTest -v` | 3/3 通过 |
| `npm --prefix web run test` | 52 文件 / 510 用例通过 |
| `npm --prefix web run lint` / `typecheck` / `build` | 通过（三入口构建） |

