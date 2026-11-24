# 运维：备份、恢复与数据面维护

门神只有一份 SQLite（`data.db`）和一个归档目录（默认 `archive/`），没有
外部数据库。这份文档覆盖四件事：**每日备份、完整性校验、恢复演练、磁盘
回收**。命令里的路径按默认部署（库在 `/app/data`）写，实际以
`config.yaml` / 环境变量里的 `db_path`、`archive_dir` 为准。

## 1. 数据分布与权限

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

## 2. 备份

### 2.1 默认行为

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

### 2.2 立即备份

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

### 2.3 异地保留

备份默认和库在同一个数据卷，**同卷损坏会一起丢**。生产至少把
`<data>/backups/` 定期同步到另一台机器或对象存储（`restic`、`rclone`、
宿主机 cron 均可），或把独立卷挂到 `backups/`。

## 3. 完整性校验

| 时机 | 命令 | 失败动作 |
|---|---|---|
| 启动 | `PRAGMA quick_check` | 写 `slog` + 私聊主管理员；服务不退出，按 §4 恢复 |
| 每次备份完成后 | 对备份文件 `PRAGMA integrity_check` | 该次备份作废，不进入保留轮转；告警 |
| 手动 | `./menshen -verify-db <path>` | 退出码非 0 |

手动校验任意库文件（包括恢复前先验备份）：

```sh
./menshen -verify-db /app/data/backups/20261124T030000Z/data.db
# INFO 完整性校验通过 db=... check=integrity_check
```

## 4. 恢复

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

## 5. 恢复演练

验收脚本在临时目录里跑完整链路，不碰生产数据：

```sh
go build -o menshen .
scripts/backup-drill.sh
```

它依次执行：`-backup-now` → 删除库与归档 → `scripts/restore.sh` →
`-verify-db` → 核对归档 JSONL 仍在。任何一步失败都会非 0 退出。

## 6. 磁盘回收

### 6.1 空闲页

保留期清理只 `DELETE` 不还页，文件会只增不减。当前行为：

- 新库在 `store.Open` 时打开 `auto_vacuum=INCREMENTAL`；
- 每小时清理后执行 `PRAGMA incremental_vacuum(1000)`（约 4 MB/轮），
  持锁时间可忽略；
- 老库（`auto_vacuum=0`）只有在空闲页 ≥ 32 MB 且 ≥ 25% 时才做一次
  `VACUUM`，同时永久打开增量回收。`VACUUM` 会持写锁重写全库，库越大越久，
  这是老库迁移的一次性代价。

观测：管理员 `/status` 的「数据盘」一行给出 `库 / WAL / 备份 N 份 / 空闲页`
体积；小时日志 `数据空间统计` 同样有页大小、空闲页与 `auto_vacuum`。

### 6.2 归档保留

`archive_retention_days`（默认 90）按文件名日期清理 `archive/` 下的 JSONL
与图片；头像没有日期，按 mtime。`archive_items` 去重索引与归档文件同寿，
避免「索引删了、文件还在 → `/export` 重复追加」。`/export` 也会跳过保留期
之外的记录，并向目标文件内容去重。`0` = 永久保留。

### 6.3 备份占用

`backups/` 是独立目录，整目录参与保留轮转；保留份数 × (库 + 归档) 是它的
上限。归档很大时优先调小 `backup_keep` 或 `archive_retention_days`，并确认
数据卷余量。

## 7. 故障处置

| 现象 | 处理 |
|---|---|
| 收到「数据库备份失败」私聊 | 看日志里的错误：目录不可写 / 磁盘满最常见；腾空间或修权限后等下一轮（10 分钟内重试） |
| 启动告警「数据库完整性校验失败」 | 立即停写，按 §4 恢复；恢复前用 `-verify-db` 逐个验备份，选最新一份通过校验的 |
| `/status` 空闲页持续增长 | 老库未完成一次 `VACUUM`；检查日志是否报 `回收 SQLite 空闲页失败`（常见为写锁超时） |
| 归档目录被删错 | 从最近一份 `archive.tar` 解到 `archive_dir`；库里的索引会与文件对齐 |
| 恢复后 `/export` 少补了某天 | 该记录可能仍在保留期外；这是有意行为，见 §6.2 |
