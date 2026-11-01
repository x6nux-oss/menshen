// 一次性修复工具：按 antiad_log.id 逐条撤销误判，与面板「误判」按钮走同一条
// UndoVerdict 路径（改判 undone、撤内容哈希、回退命中数、撤派生的联合封禁、
// 解除禁言/封禁），保证所有清理不变式都被执行。
//
// -keep-gban 用于特例：该用户另有**与这条误判无关的**联合封禁挂账时，
// 只撤销记录与限制，不动名单。
package main

import (
	"flag"
	"fmt"
	"os"
	"strconv"
	"strings"

	"menshen/internal/antiad"
	"menshen/internal/config"
	"menshen/internal/core"
	"menshen/internal/store"
	"menshen/internal/tg"
)

func main() {
	cfgPath := flag.String("config", "config.yaml", "配置文件路径")
	idsFlag := flag.String("ids", "", "要撤销的 antiad_log id，逗号分隔")
	actorFlag := flag.Int64("actor", 0, "执行人 user_id（必须是主管理员）")
	keepGban := flag.Bool("keep-gban", false, "不动联合封禁名单（仅撤记录与限制）")
	flag.Parse()

	if *idsFlag == "" || *actorFlag == 0 {
		fmt.Println("用法: repairvision -config config.yaml -ids <id[,id...]> -actor <主管理员user_id> [-keep-gban]")
		os.Exit(2)
	}

	cfg, err := config.Load(*cfgPath)
	if err != nil {
		fmt.Println("加载配置失败:", err)
		os.Exit(1)
	}
	if !cfg.IsAdmin(*actorFlag) {
		fmt.Printf("-actor %d 不是配置里的主管理员，拒绝执行\n", *actorFlag)
		os.Exit(1)
	}
	db, err := store.Open(cfg.DBPath)
	if err != nil {
		fmt.Println("打开数据库失败:", err)
		os.Exit(1)
	}
	defer db.Close()
	cache, err := store.NewCache(db)
	if err != nil {
		fmt.Println("构建缓存失败:", err)
		os.Exit(1)
	}
	sh := core.NewShared(cfg, db, cache)

	// 联合封禁的跨群解除要遍历全部 bot 实例，这里照启动路径把启用的
	// bot 都拉起来（不接 webhook，只提供 TG 调用与配置视图）。
	stop := make(chan struct{})
	reg := core.NewRegistry(sh, stop, func(*core.Bot, *tg.Update) {})
	reg.LoadAll()

	for _, idStr := range strings.Split(*idsFlag, ",") {
		id, err := strconv.ParseInt(strings.TrimSpace(idStr), 10, 64)
		if err != nil {
			fmt.Printf("id %q 不是数字，跳过\n", idStr)
			continue
		}
		row, ok := antiad.LoadAdLog(db, id)
		if !ok {
			fmt.Printf("记录 %d 不存在\n", id)
			continue
		}
		fmt.Printf("记录 %d: bot=%d chat=%d user=%d action=%s verdict=%s conf=%.2f\n",
			id, row.BotID, row.ChatID, row.UserID, row.Action, row.Verdict, row.Confidence)
		if row.Action == "undone" {
			fmt.Printf("  记录 %d 已是 undone，跳过\n", id)
			continue
		}
		b, found := reg.LookupID(row.BotID)
		if !found {
			fmt.Printf("  bot %d 未启用，无法解除 TG 侧限制，跳过\n", row.BotID)
			continue
		}
		if *keepGban {
			// 特例路径：与 UndoVerdict 相同的数据侧改判与命中数回退，
			// 但不碰联合封禁名单（该用户另有无关挂账）。
			antiad.UpdateAdLog(b, row.ID, "undone", row.Reason+"；管理员标记误判")
			antiad.ForgetAdHash(b, row.Text)
			if antiad.AdHitsCounted(row) {
				antiad.BumpAdHits(b, row.ChatID, row.UserID, -1)
			}
			ok, desc := antiad.LiftMute(b, row.ChatID, row.UserID)
			fmt.Printf("  已改判 undone 并解除限制: ok=%v desc=%q（名单未动）\n", ok, desc)
			continue
		}
		lifted, ok, desc := antiad.UndoVerdict(b, row, *actorFlag)
		fmt.Printf("  UndoVerdict: lifted=%q ok=%v desc=%q\n", lifted, ok, desc)
	}
	close(stop)
}
