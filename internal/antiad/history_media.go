package antiad

// ---- 从 MTProto 群历史回捞图片 ----
//
// Bot API 没有历史消息接口：消息处理时没存 file_id，事后就取不回来。
// bot 自己的 token 可以登录 MTProto（与入群时间补全同一套会话），用
// channels.getMessages 按 message_id 取回仍留在群里的消息并下载图片。
//
// 这条路径补的是 ai_log 里没有/被 64 KB 截断的图。它只对「消息还在群里」
// 且 bot 能看到历史的情况有效；已删除、或被限制读历史的群无从找回。
//
// 用纯 Go 的 gotd/td 登录 MTProto，不再依赖 python / telethon。

import (
	"context"
	"log/slog"
	"strings"
	"time"

	"menshen/internal/archive"
	"menshen/internal/core"
	"menshen/internal/mtproto"
)

const (
	// historyFetchLimit 是一次导出里每个群最多回捞多少条消息。上限存在的
	// 意义是避免一次 /export 变成几千次 MTProto 下载。
	historyFetchLimit = 200
	// historyFetchRetry 是失败后重新尝试的间隔。empty（消息已删/不是图片）
	// 不再重试。
	historyFetchRetry = 24 * time.Hour
	// historyMediaTimeout 是一次回捞的整体超时。
	historyMediaTimeout = 10 * time.Minute
)

// historyMediaRow 是脚本回传的一张图片。Data 读进内存而不是保留路径：
// 脚本的临时目录在返回前就删掉，调用方只需要字节。
type historyMediaRow struct {
	MessageID int64
	MIME      string
	Data      []byte
	// Failed 表示脚本找到了图片但下载失败：与「消息里没有图片」区分开，
	// 这种要记 error 并在 24 小时后重试。
	Failed bool
}

// historyMediaRunner 跑一批下载，测试里会替换掉。
var historyMediaRunner = runHistoryMediaMTProto

type historyCandidate struct {
	messageID int64
	at        int64
}

type historyFetchResult struct {
	Candidates int
	Saved      int
	Empty      int
	Failed     int
	Reason     string
}

// fetchHistoryImages 对指定群做一次 MTProto 历史图片回捞。
func fetchHistoryImages(b *core.Bot, chatID int64) historyFetchResult {
	var res historyFetchResult
	if b.Cache.Snap().BotSettingInt(b.BotID(), "archive_fetch_history", 0) != 1 {
		return res
	}
	if b.Cfg.TGAPIID == 0 || strings.TrimSpace(b.Cfg.TGAPIHash) == "" {
		res.Reason = "未配置 tg_api_id / tg_api_hash"
		return res
	}

	cands, err := historyCandidates(b, chatID)
	if err != nil {
		res.Reason = "筛选历史消息失败: " + err.Error()
		return res
	}
	res.Candidates = len(cands)
	if len(cands) == 0 {
		return res
	}

	atByID := make(map[int64]int64, len(cands))
	ids := make([]int64, 0, len(cands))
	for _, c := range cands {
		atByID[c.messageID] = c.at
		ids = append(ids, c.messageID)
	}

	rows, err := historyMediaRunner(b, chatID, ids)
	if err != nil {
		res.Failed += len(ids)
		res.Reason = err.Error()
		slog.Warn("存档：历史图片回捞失败", "chat", chatID,
			"candidates", len(ids), "err", err)
		for _, id := range ids {
			markFetchStatus(b, chatID, id, "error")
		}
		return res
	}
	got := make(map[int64]historyMediaRow, len(rows))
	for _, r := range rows {
		got[r.MessageID] = r
	}
	for _, id := range ids {
		r, ok := got[id]
		if !ok {
			markFetchStatus(b, chatID, id, "empty")
			res.Empty++
			continue
		}
		if r.Failed {
			markFetchStatus(b, chatID, id, "error")
			res.Failed++
			res.Reason = "部分图片下载失败"
			continue
		}
		saved, err := archive.SaveHistoryImage(b, chatID, id, atByID[id], r.Data, r.MIME)
		if err != nil {
			markFetchStatus(b, chatID, id, "error")
			res.Failed++
			res.Reason = err.Error()
			continue
		}
		markFetchStatus(b, chatID, id, "ok")
		if saved {
			res.Saved++
		} else {
			res.Empty++
		}
	}
	return res
}

// historyCandidates 取可能带图片、且还没尝试过（或失败已过重试期）的消息。
//
// 只认留底正文里带媒体标签的消息：图片/实况照片/贴纸/文件。没有识图结果
// 的纯图消息正文是空的，从旧库里无法判断它是不是图片，只能放弃。
func historyCandidates(b *core.Bot, chatID int64) ([]historyCandidate, error) {
	rows, err := b.Store.Read.Query(`SELECT gm.message_id, gm.at
		FROM group_messages gm
		LEFT JOIN archive_fetches af
		  ON af.chat_id=gm.chat_id AND af.message_id=gm.message_id
		WHERE gm.chat_id=? AND gm.text<>''
		  AND (gm.text LIKE '%<image%' OR gm.text LIKE '%<live_photo%'
		       OR gm.text LIKE '%<sticker%' OR gm.text LIKE '%<file%'
		       OR gm.text LIKE '%［图片］%' OR gm.text LIKE '%［实况照片］%'
		       OR gm.text LIKE '%［贴纸］%' OR gm.text LIKE '%［文件］%')
		  AND (af.message_id IS NULL OR (af.status='error' AND af.tried_at < ?))
		ORDER BY gm.at DESC LIMIT ?`,
		chatID, time.Now().Add(-historyFetchRetry).Unix(), historyFetchLimit*3)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []historyCandidate
	for rows.Next() {
		var c historyCandidate
		if err := rows.Scan(&c.messageID, &c.at); err != nil {
			continue
		}
		// 已经有完整图片（实时存档 / 上次 MTProto / ai_log 找回）就跳过，
		// 不再为它花一次 MTProto 往返。
		if archive.HasImage(b, chatID, c.messageID, c.at) {
			continue
		}
		out = append(out, c)
		if len(out) >= historyFetchLimit {
			break
		}
	}
	return out, rows.Err()
}

// markFetchStatus 记录一次尝试。error 会在 24 小时后重新进候选。
func markFetchStatus(b *core.Bot, chatID, msgID int64, status string) {
	if _, err := b.Store.Write.Exec(`INSERT INTO archive_fetches
		(chat_id,message_id,status,tried_at) VALUES (?,?,?,?)
		ON CONFLICT(chat_id,message_id) DO UPDATE SET
			status=excluded.status, tried_at=excluded.tried_at`,
		chatID, msgID, status, time.Now().Unix()); err != nil {
		slog.Error("存档：写历史图片回捞状态失败", "chat", chatID, "msg", msgID, "err", err)
	}
}

// runHistoryMediaMTProto 用纯 Go 的 MTProto 客户端下载一批历史图片。
func runHistoryMediaMTProto(b *core.Bot, chatID int64, ids []int64) ([]historyMediaRow, error) {
	// 与入群时间补全共用同一个 MTProto 会话文件，同一时刻只能有一个
	// 客户端在用。这里用阻塞锁而不是 TryLock：导出本身就在后台 goroutine
	// 上，短暂等正在跑的单人查询结束即可，不该因为一次抢占就整批记 error
	// 再等 24 小时。
	joinBackfillRunning.Lock()
	defer joinBackfillRunning.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), historyMediaTimeout)
	defer cancel()

	var rows []mtproto.MediaRow
	err := mtproto.Run(ctx, mtprotoOptions(b), func(ctx context.Context, c *mtproto.Client) error {
		var err error
		rows, err = mtproto.FetchImages(ctx, c, chatID, chatUsername(b, chatID), ids)
		return err
	})
	if err != nil {
		return nil, err
	}
	out := make([]historyMediaRow, 0, len(rows))
	for _, r := range rows {
		out = append(out, historyMediaRow{
			MessageID: r.MessageID, MIME: r.MIME, Data: r.Data, Failed: r.Failed,
		})
	}
	return out, nil
}
