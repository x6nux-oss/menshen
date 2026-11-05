package antiad

import (
	"fmt"
	"html"
	"log/slog"
	"strconv"
	"strings"

	"menshen/internal/archive"
	"menshen/internal/core"
	"menshen/internal/tg"
)

// ---- 历史记录导出（/export）----
//
// 文件存档上线前，群消息留底与判定流水都只存在 SQLite 里，并且会随保留
// 天数被清掉。 /export 把这些历史补写进同一套按群分目录的存档：
//
//	<root>/<chat_id>/messages-YYYY-MM-DD.jsonl
//	<root>/<chat_id>/judgments-YYYY-MM-DD.jsonl
//
// 导出与实时存档共用 archive_items 去重，重复执行只补没导过的部分。
// 历史图片的文件 ID 当时没有落库，Bot API 也取不回来，所以旧记录只有文字。

const exportDMCmdUsage = "用法：<code>/export</code> 列出你能导出的群，" +
	"点按钮选目标群；也可直接发 <code>/export &lt;chat_id&gt;</code> 或 " +
	"<code>/export all</code>。\n" +
	"导出内容：群消息留底与判定流水（写入存档目录，已导过的不会重复写）。\n" +
	"历史图片在旧库里没有文件 ID，只有文字能补出来；此后的实时消息会连图片一起存。"

// exportCbPrefix 是私聊导出按钮的回调前缀，目标群 0 表示全部。
const exportCbPrefix = "a:ex:"

// HandleExportCommandDM 处理管理员私聊里的 /export。
func HandleExportCommandDM(b *core.Bot, m *tg.Message, arg string) {
	actor := m.From.ID
	if !b.IsStaff(actor) {
		return
	}
	dm := m.Chat.ID
	if !b.AdLimits.Allow(fmt.Sprintf("export:%d", actor),
		b.Cache.Snap().BotSettingInt(b.BotID(), "antiad_cmd_rpm", 3)) {
		b.Send(dm, "操作太频繁，请稍后再试。", nil)
		return
	}

	targets := clearTargets(b.Shared, actor)

	switch arg = strings.TrimSpace(arg); {
	case arg == "":
		if len(targets) == 0 {
			b.Send(dm, "没有你能导出的群。也可以直接发 <code>/export &lt;chat_id&gt;</code>。", nil)
			return
		}
		b.Send(dm, exportPickText(targets), exportPickKB(targets))
	case arg == "all" || arg == "全部" || arg == "全部群":
		if len(targets) == 0 {
			b.Send(dm, "没有你能导出的群。", nil)
			return
		}
		runExport(b, actor, "全部群", true, targets,
			func(text string) { b.Send(dm, text, nil) })
	default:
		chatID, err := strconv.ParseInt(arg, 10, 64)
		if err != nil {
			b.Send(dm, exportDMCmdUsage, nil)
			return
		}
		t, ok := exportTargetFor(b, actor, targets, chatID)
		if !ok {
			b.Send(dm, "这个群不在你能导出的范围内。发 <code>/export</code> 看可选的群。", nil)
			return
		}
		runExport(b, actor, t.Name, false, []clearTarget{t},
			func(text string) { b.Send(dm, text, nil) })
	}
}

// HandleExportCallback 处理私聊导出清单上的按钮。
func HandleExportCallback(b *core.Bot, q *tg.CallbackQuery) {
	actor := q.From.ID
	if !b.IsStaff(actor) {
		b.AnswerCallback(q.ID, "")
		return
	}
	chatID, ok := parseExportCallback(q.Data)
	if !ok {
		b.AnswerCallback(q.ID, "")
		return
	}
	if !b.AdLimits.Allow(fmt.Sprintf("export:%d", actor),
		b.Cache.Snap().BotSettingInt(b.BotID(), "antiad_cmd_rpm", 3)) {
		b.AnswerCallback(q.ID, "操作太频繁，请稍后再试")
		return
	}

	targets := clearTargets(b.Shared, actor)
	if len(targets) == 0 {
		b.AnswerCallback(q.ID, "没有你能导出的群")
		return
	}
	label := "全部群"
	picked := targets
	if chatID != 0 {
		t, found := findClearTarget(targets, chatID)
		if !found {
			b.AnswerCallback(q.ID, "这个群不在你能导出的范围内")
			return
		}
		picked, label = []clearTarget{t}, t.Name
	}

	b.AnswerCallback(q.ID, "开始导出")
	runExport(b, actor, label, chatID == 0, picked, func(text string) {
		b.EditOrSend(q.Message.Chat.ID, q.Message.MessageID, text, nil)
	})
}

type exportTotals struct {
	Messages  int64
	Judgments int64
	Skipped   int64
	Recovered int64
	Partial   int64
	// Rewritten 是历史 ai_log.input 里被改写成存档占位符的行数。
	Rewritten int64
	// FromTelegram 是从 MTProto 历史消息下载的图片数；FetchReason 是回捞
	// 失败/未启用的原因（只在开启了 archive_fetch_history 时出现）。
	FromTelegram int64
	FetchReason  string
	Groups       int
	Failed       int
	Dirs         []string
	LastErr      string
}

// exportGate 保证同一时刻只跑一个导出：导出要逐行读库并写文件，同时跑
// 两份只会互相抢写连接。用带缓冲的 channel 而不是 mutex，取不到时能立刻
// 给管理员一句「正在导出」，不必排队。
var exportGate = make(chan struct{}, 1)

// runExport 在后台跑一次导出。更新处理是按 bot 串行的，历史导出可能读
// 几万行；同步跑会把群消息处理一起卡住，广告照发、判定却停摆。
func runExport(b *core.Bot, actor int64, label string, all bool,
	targets []clearTarget, send func(string)) {
	select {
	case exportGate <- struct{}{}:
	default:
		send("已有导出任务正在进行，请稍后再试。")
		return
	}
	send("📦 正在导出…")
	slog.Info("反广告：开始导出历史记录", "by", actor, "目标", label,
		"群数", len(targets))
	go func() {
		defer func() { <-exportGate }()
		res := exportMany(b, actor, targets)
		send(exportResultText(res, label, all))
		slog.Info("反广告：导出历史记录", "by", actor, "目标", label,
			"群数", len(targets), "消息", res.Messages, "判定", res.Judgments)
	}()
}

// exportMany 逐群导出。范围与 /clear、/ban 一致：主管理员=全部群，
// 次管=自己名下 bot 的群。
func exportMany(b *core.Bot, actor int64, targets []clearTarget) exportTotals {
	var out exportTotals
	botIDs := exportBotIDs(b.Shared, actor)
	for _, t := range targets {
		// 先走 MTProto 回捞：完整图先落盘，后面的 ai_log 截断图找回会
		// 看到已有完整图而跳过，不会用半张图覆盖。
		//
		// 必须用**这个群的工作 bot**：导出命令通常由主 bot 收到，而主 bot
		// 不入群，拿它的 token 解析不到群的 access_hash。
		if b.Cache.Snap().BotSettingInt(b.BotID(), "archive_fetch_history", 0) == 1 {
			if hb := historyBotForChat(b.Shared, t.ChatID); hb != nil {
				if hr := fetchHistoryImages(hb, t.ChatID); hr.Saved > 0 || hr.Reason != "" {
					out.FromTelegram += int64(hr.Saved)
					if hr.Reason != "" {
						out.FetchReason = hr.Reason
					}
				}
			} else {
				out.FetchReason = "没有在线的工作 bot 可执行 MTProto 回捞"
			}
		}
		st, err := archive.ExportChat(b, t.ChatID, botIDs)
		if err != nil {
			out.Failed++
			out.LastErr = err.Error()
			slog.Warn("反广告：导出群记录失败", "chat", t.ChatID, "err", err)
			continue
		}
		out.Messages += st.Messages
		out.Judgments += st.Judgments
		out.Skipped += st.Skipped
		out.Recovered += st.Recovered
		out.Partial += st.Partial
		out.Rewritten += st.Rewritten
		out.Groups++
		if len(out.Dirs) < 8 && (st.Messages > 0 || st.Judgments > 0) {
			out.Dirs = append(out.Dirs, st.Dir)
		}
	}
	return out
}

// historyBotForChat 找负责这个群的工作 bot。主 bot 不入群、没有群配置，
// 不能用来做 MTProto 群操作；多个工作 bot 时取第一个在线的。
func historyBotForChat(sh *core.Shared, chatID int64) *core.Bot {
	for _, b := range botsOfChat(sh, chatID) {
		if !b.IsMainBot() {
			return b
		}
	}
	return nil
}

// exportTargetFor 解析 /export <chat_id> 的目标。
//
// 优先用当前启用群清单里的名字；不在清单里（群已从 bot 名下移除）时，
// 主管理员可以按 chat_id 直接导出，次管则要求 antiad_log 里确实有他名下
// bot 在这个群的判定记录 —— 否则等于允许他按 ID 猜别家租户的群。
func exportTargetFor(b *core.Bot, actor int64, targets []clearTarget, chatID int64) (clearTarget, bool) {
	if t, ok := findClearTarget(targets, chatID); ok {
		return t, true
	}
	if !exportAllowedChat(b, actor, chatID) {
		return clearTarget{}, false
	}
	name := strconv.FormatInt(chatID, 10)
	if c, ok := b.Cache.Snap().ChatConf(b.BotID(), chatID); ok {
		name = chatDisplayName(c)
	}
	return clearTarget{ChatID: chatID, Name: name}, true
}

func exportAllowedChat(b *core.Bot, actor int64, chatID int64) bool {
	if b.Shared.IsMain(actor) {
		return true
	}
	ids := exportBotIDs(b.Shared, actor)
	if len(ids) == 0 {
		return false
	}
	ph := make([]string, len(ids))
	args := []any{chatID}
	for i, id := range ids {
		ph[i] = "?"
		args = append(args, id)
	}
	var one int
	err := b.Store.Read.QueryRow(`SELECT 1 FROM antiad_log WHERE chat_id=? AND bot_id IN (`+
		strings.Join(ph, ",")+`) LIMIT 1`, args...).Scan(&one)
	return err == nil
}

// exportBotIDs 返回 actor 能看到的判定流水归属 bot。
//
// nil 表示主管理员，导出全部 bot（不按 bot_id 过滤）。次管只导出自己名下
// bot 的行，避免从同一个群的 ID 看到别家租户的判定记录。
func exportBotIDs(sh *core.Shared, actor int64) []int64 {
	if sh.IsMain(actor) {
		return nil
	}
	snap := sh.Cache.Snap()
	ids := make([]int64, 0, 2)
	for id, rec := range snap.Bots {
		if rec != nil && !rec.IsMain && rec.OwnerID == actor {
			ids = append(ids, id)
		}
	}
	return ids
}

func exportPickText(targets []clearTarget) string {
	var sb strings.Builder
	sb.WriteString("📦 <b>导出历史记录</b>\n\n")
	sb.WriteString("把仍有留底的群消息与判定流水写进存档目录。\n" +
		"<i>已导过的不会重复写；历史图片没有文件 ID，只有文字能补出来。</i>\n\n")
	fmt.Fprintf(&sb, "可导出 %d 个群，点按钮选目标：\n", len(targets))
	if len(targets) > clearMaxButtons {
		fmt.Fprintf(&sb, "\n群较多，清单只列前 %d 个；"+
			"其余请直接用 <code>/export &lt;chat_id&gt;</code>。", clearMaxButtons)
	}
	return sb.String()
}

func exportPickKB(targets []clearTarget) map[string]any {
	rows := make([][2]string, 0, len(targets)+1)
	for i, t := range targets {
		if i >= clearMaxButtons {
			break
		}
		rows = append(rows, [2]string{core.TruncateRunes(t.Name, 30),
			exportCallbackData(t.ChatID)})
	}
	return tg.InlineKB(rows, [][2]string{
		{"📦 全部群（" + strconv.Itoa(len(targets)) + " 个）", exportCallbackData(0)},
	})
}

func exportCallbackData(chatID int64) string {
	return exportCbPrefix + strconv.FormatInt(chatID, 10)
}

func parseExportCallback(data string) (int64, bool) {
	rest, ok := strings.CutPrefix(data, exportCbPrefix)
	if !ok {
		return 0, false
	}
	id, err := strconv.ParseInt(rest, 10, 64)
	if err != nil {
		return 0, false
	}
	return id, true
}

func exportResultText(r exportTotals, label string, all bool) string {
	var sb strings.Builder
	switch {
	case all:
		fmt.Fprintf(&sb, "📦 <b>历史记录导出完成</b>（%d 个群）\n\n", r.Groups)
	case r.Groups == 0:
		fmt.Fprintf(&sb, "⚠️ <b>导出失败</b>：%s\n\n", html.EscapeString(label))
		if r.LastErr != "" {
			sb.WriteString(html.EscapeString(core.TruncateRunes(r.LastErr, 300)))
		}
		return sb.String()
	default:
		fmt.Fprintf(&sb, "📦 <b>历史记录已导出</b>：%s\n\n", html.EscapeString(label))
	}
	fmt.Fprintf(&sb, "消息：%d 条\n判定：%d 条\n", r.Messages, r.Judgments)
	if r.Recovered > 0 || r.Partial > 0 {
		fmt.Fprintf(&sb, "从识图流水找回图片：%d 张", r.Recovered)
		if r.Partial > 0 {
			fmt.Fprintf(&sb, "（另有 %d 张被截断，已按 .partial 原样保存）", r.Partial)
		}
		sb.WriteString("\n")
	}
	if r.FromTelegram > 0 {
		fmt.Fprintf(&sb, "从 Telegram 历史消息下载图片：%d 张\n", r.FromTelegram)
	}
	if r.Rewritten > 0 {
		fmt.Fprintf(&sb, "AI 请求记录转存占位符：%d 条\n", r.Rewritten)
	}
	if r.FetchReason != "" {
		sb.WriteString("历史图片回捞：" +
			html.EscapeString(core.TruncateRunes(r.FetchReason, 200)) + "\n")
	}
	if r.Skipped > 0 {
		fmt.Fprintf(&sb, "已入档跳过：%d 条\n", r.Skipped)
	}
	if r.Failed > 0 {
		fmt.Fprintf(&sb, "失败：%d 个群\n", r.Failed)
	}
	if len(r.Dirs) == 1 {
		sb.WriteString("\n目录：<code>" + html.EscapeString(r.Dirs[0]) + "</code>")
	} else if len(r.Dirs) > 1 {
		sb.WriteString("\n目录（前几个）：\n")
		for _, d := range r.Dirs {
			sb.WriteString("<code>" + html.EscapeString(d) + "</code>\n")
		}
	}
	return strings.TrimRight(sb.String(), "\n")
}
