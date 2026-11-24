#!/usr/bin/env bash
# M3 可复跑基线：本地合成库 + 假上游，不连真实模型/生产库。
#
#   ./scripts/perf-baseline.sh
#   MENSHEN_PERF_ROWS=50000 MENSHEN_PERF_ITERS=10 ./scripts/perf-baseline.sh
#
# 数字与 docs/performance.md 同口径；环境不同（CPU、磁盘、并发负载）
# 绝对值会变，比较 before/after 时必须在同一台机器、同一负载下跑。
set -euo pipefail
cd "$(dirname "$0")/.."
export MENSHEN_PERF=1

go test ./internal/panel -run TestPerfSQLBaseline -v -count=1
go test ./internal/antiad -run 'TestPerfJudgeBaseline|TestPerfWriteBaseline' -v -count=1
(cd internal/localvision && python3 -m unittest worker_test.OcrPreprocessTest -v)
