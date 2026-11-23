#!/bin/sh
# 从一份备份恢复 menshen 的数据目录。
#
# 用法：
#   scripts/restore.sh <备份目录> <数据目录> [库文件名]
#
#   scripts/restore.sh ./data/backups/20261124T030000Z ./data
#   BIN=/app/menshen scripts/restore.sh /backup/20261124T030000Z /app/data data.db
#
# 备份目录形如 <data-dir>/backups/20261124T030000Z，内含 data.db 与
# archive.tar。脚本做四件事：校验备份、把现有库/归档挪到一边、替换并解包、
# 再校验恢复后的库。**运行前先停服**；脚本不会替你停进程。
set -eu

usage() {
	echo "用法: $0 <备份目录> <数据目录> [库文件名]" >&2
	exit 2
}

[ $# -ge 2 ] || usage
backup=$1
data_dir=$2
db_name=${3:-data.db}

BIN=${BIN:-menshen}
if ! command -v "$BIN" >/dev/null 2>&1 && [ ! -x "$BIN" ]; then
	echo "找不到可执行的 menshen（设置 BIN=/path/to/menshen）" >&2
	exit 1
fi
[ -f "$backup/data.db" ] || { echo "备份缺少 data.db: $backup" >&2; exit 1; }
[ -d "$data_dir" ] || { echo "数据目录不存在: $data_dir" >&2; exit 1; }

echo "==> 校验备份"
"$BIN" -verify-db "$backup/data.db"

ts=$(date -u +%Y%m%dT%H%M%SZ)
db_path=$data_dir/$db_name
if [ -f "$db_path" ]; then
	# 旧库连同 WAL/SHM 一起挪走：残留的 WAL 属于旧库，不能陪着新库启动。
	mv "$db_path" "$db_path.bak-$ts"
	[ -f "$db_path-wal" ] && mv "$db_path-wal" "$db_path-wal.bak-$ts"
	[ -f "$db_path-shm" ] && mv "$db_path-shm" "$db_path-shm.bak-$ts"
	echo "==> 旧库已移到 $db_path.bak-$ts"
fi

echo "==> 写入备份库"
cp "$backup/data.db" "$db_path"
chmod 600 "$db_path"

if [ -f "$backup/archive.tar" ]; then
	archive_dir=$data_dir/archive
	if [ -d "$archive_dir" ]; then
		mv "$archive_dir" "$archive_dir.bak-$ts"
	fi
	mkdir -p "$archive_dir"
	echo "==> 解包归档"
	tar -xf "$backup/archive.tar" -C "$archive_dir"
	chmod 700 "$archive_dir"
else
	echo "==> 备份不含归档（archive.tar）"
fi

echo "==> 校验恢复后的库"
"$BIN" -verify-db "$db_path"

cat <<'EOF'
==> 完成
下一步：
  1. 启动服务，确认 /healthz 与管理员私聊 /status 正常；
  2. /status 的「数据盘」应显示库与备份体积；
  3. 旧库保留为 .bak-<时间戳>，确认无误后再删。
EOF
