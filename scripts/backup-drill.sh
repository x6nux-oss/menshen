#!/bin/sh
# 恢复演练：在临时目录里跑完整链路，不碰生产数据。
#
#   备份 → 删除库与归档 → 恢复 → integrity_check ok → 数据读得回来
#
# 用法：先 `go build -o menshen .`，然后 `scripts/backup-drill.sh`。
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
BIN=${BIN:-$root/menshen}
if [ ! -x "$BIN" ]; then
	echo "找不到二进制 $BIN；先执行: go build -o menshen ." >&2
	exit 1
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT INT TERM

data=$tmp/data
mkdir -p "$data/archive/-100"
cat >"$tmp/config.yaml" <<EOF
db_path: "$data/data.db"
EOF
printf '{"type":"message","chat_id":-100,"message_id":1,"text":"drill"}\n' \
	>"$data/archive/-100/messages-1970-01-01.jsonl"

echo "==> 备份"
backup=$("$BIN" -config "$tmp/config.yaml" -backup-now | tail -n 1)
echo "    $backup"
[ -f "$backup/data.db" ] || { echo "备份缺少 data.db" >&2; exit 1; }
[ -f "$backup/archive.tar" ] || { echo "备份缺少 archive.tar" >&2; exit 1; }

echo "==> 模拟数据丢失"
rm -rf "$data/data.db" "$data/data.db-wal" "$data/data.db-shm" "$data/archive"

echo "==> 恢复"
BIN=$BIN sh "$root/scripts/restore.sh" "$backup" "$data" data.db

echo "==> 核对归档"
grep -q '"message_id":1' "$data/archive/-100/messages-1970-01-01.jsonl" \
	|| { echo "恢复后归档内容不对" >&2; exit 1; }

echo "==> 演练通过：备份、恢复、完整性校验与归档都在"
