package mtproto

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"github.com/gotd/td/tg"
)

// ---- 群实体解析 ----
//
// MTProto 调 channels.* 需要一个带 access_hash 的 InputChannel；Bot API 的
// chat_id 不带 access_hash。解析顺序：
//   1. 本地缓存（上次成功解析的结果）
//   2. 公开用户名 contacts.resolveUsername
//   3. updates.getDifference / messages.getDialogs 里带的 Chat 实体
//   4. access_hash=0 直接试一次（部分成员 bot 可成功）
// 任何一步成功都会写回 peermanager.json，下次直接复用。

var peerMu sync.Mutex

type peerCache struct {
	Channels map[string]int64 `json:"channels"`
}

func peerCachePath(dir string) string { return filepath.Join(dir, "peers.json") }

func loadPeerCache(path string) peerCache {
	c := peerCache{Channels: map[string]int64{}}
	data, err := os.ReadFile(path)
	if err == nil && json.Unmarshal(data, &c) == nil && c.Channels != nil {
		return c
	}
	return peerCache{Channels: map[string]int64{}}
}

func savePeerCache(path string, c peerCache) {
	data, err := json.Marshal(c)
	if err != nil {
		return
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return
	}
	_ = os.Rename(tmp, path)
}

func rememberChannel(dir string, ch *tg.Channel) {
	if ch == nil || ch.ID == 0 || ch.AccessHash == 0 {
		return
	}
	peerMu.Lock()
	defer peerMu.Unlock()
	path := peerCachePath(dir)
	c := loadPeerCache(path)
	c.Channels[strconv.FormatInt(botAPIChatID(ch.ID), 10)] = ch.AccessHash
	savePeerCache(path, c)
}

// botAPIChatID 把 MTProto 的正数 channel ID 转成 Bot API 的 -100... 形式。
// 例：channel 2124027757 → -1002124027757。
func botAPIChatID(channelID int64) int64 { return -1_000_000_000_000 - channelID }

// rawChannelID 是 botAPIChatID 的逆运算。
func rawChannelID(chatID int64) int64 { return -chatID - 1_000_000_000_000 }

// ResolveChannel 把 Bot API 的 chat_id 解析成 MTProto 的 InputChannel。
// username 是 bot_chats 里保存的公开 @ 名（私有群为空）。
func ResolveChannel(ctx context.Context, c *Client, chatID int64, username string) (*tg.InputChannel, error) {
	// 超级群/频道 id 形如 -100xxxxxxxxxx；普通群没有 channels.* 接口。
	if chatID > -1_000_000_000_000 {
		return nil, fmt.Errorf("群 %d 不是超级群/频道（MTProto 只支持 -100 开头的 id）", chatID)
	}
	channelID := rawChannelID(chatID)

	path := peerCachePath(c.Opts.Dir)
	peerMu.Lock()
	cache := loadPeerCache(path)
	peerMu.Unlock()
	if h := cache.Channels[strconv.FormatInt(chatID, 10)]; h != 0 {
		if ch, err := channelByID(ctx, c.API, channelID, h); err == nil {
			return inputChannel(ch), nil
		}
		peerMu.Lock()
		cache = loadPeerCache(path)
		delete(cache.Channels, strconv.FormatInt(chatID, 10))
		savePeerCache(path, cache)
		peerMu.Unlock()
	}

	if username = strings.TrimPrefix(strings.TrimSpace(username), "@"); username != "" {
		if ch, err := channelByUsername(ctx, c.API, username); err == nil && ch != nil {
			if ch.ID != channelID {
				return nil, fmt.Errorf("用户名 @%s 解析到群 %d，与配置的 %d 不符",
					username, botAPIChatID(ch.ID), chatID)
			}
			rememberChannel(c.Opts.Dir, ch)
			return inputChannel(ch), nil
		}
	}

	if ch := channelFromDifference(ctx, c.API, channelID, false); ch != nil {
		rememberChannel(c.Opts.Dir, ch)
		return inputChannel(ch), nil
	}
	if ch := channelFromDifference(ctx, c.API, channelID, true); ch != nil {
		rememberChannel(c.Opts.Dir, ch)
		return inputChannel(ch), nil
	}
	if ch := channelFromDialogs(ctx, c.API, channelID); ch != nil {
		rememberChannel(c.Opts.Dir, ch)
		return inputChannel(ch), nil
	}
	if ch, err := channelByID(ctx, c.API, channelID, 0); err == nil {
		rememberChannel(c.Opts.Dir, ch)
		return inputChannel(ch), nil
	}
	return nil, fmt.Errorf("无法解析群 %d 的 MTProto access_hash"+
		"（私有群需要会话缓存过该群，或在面板里补上公开用户名）", chatID)
}

func inputChannel(ch *tg.Channel) *tg.InputChannel {
	return &tg.InputChannel{ChannelID: ch.ID, AccessHash: ch.AccessHash}
}

func channelByID(ctx context.Context, api *tg.Client, chatID, accessHash int64) (*tg.Channel, error) {
	res, err := api.ChannelsGetChannels(ctx, []tg.InputChannelClass{
		&tg.InputChannel{ChannelID: chatID, AccessHash: accessHash},
	})
	if err != nil {
		return nil, err
	}
	var chats []tg.ChatClass
	switch v := res.(type) {
	case *tg.MessagesChats:
		chats = v.Chats
	case *tg.MessagesChatsSlice:
		chats = v.Chats
	}
	for _, item := range chats {
		if ch, ok := item.(*tg.Channel); ok && ch.ID == chatID {
			return ch, nil
		}
	}
	return nil, fmt.Errorf("群 %d 不在返回结果里", chatID)
}

func channelByUsername(ctx context.Context, api *tg.Client, username string) (*tg.Channel, error) {
	res, err := api.ContactsResolveUsername(ctx, &tg.ContactsResolveUsernameRequest{
		Username: username,
	})
	if err != nil {
		return nil, err
	}
	for _, item := range res.Chats {
		if ch, ok := item.(*tg.Channel); ok {
			return ch, nil
		}
	}
	// 有些公开群会以 PeerChannel 出现，但 Chats 里没有实体；这种情况只能
	// 退回到其他解析路径。
	return nil, fmt.Errorf("用户名 @%s 没有解析出频道实体", username)
}

// channelFromDifference 从 updates.getDifference 返回的 Chat 实体里找目标群。
// withZero 为真时从零状态请求（服务端多半返回 differenceTooLong，但仍是
// 一条能拿到部分实体的兜底路径）。
func channelFromDifference(ctx context.Context, api *tg.Client,
	chatID int64, withZero bool) *tg.Channel {
	req := &tg.UpdatesGetDifferenceRequest{}
	if !withZero {
		st, err := api.UpdatesGetState(ctx)
		if err != nil {
			return nil
		}
		req.Pts, req.Qts, req.Date = st.Pts, st.Qts, st.Date
	} else {
		req.PtsTotalLimit = 1000
	}
	diff, err := api.UpdatesGetDifference(ctx, req)
	if err != nil {
		return nil
	}
	var chats []tg.ChatClass
	switch d := diff.(type) {
	case *tg.UpdatesDifference:
		chats = d.Chats
	case *tg.UpdatesDifferenceSlice:
		chats = d.Chats
	}
	for _, item := range chats {
		if ch, ok := item.(*tg.Channel); ok && ch.ID == chatID {
			return ch
		}
	}
	return nil
}

func channelFromDialogs(ctx context.Context, api *tg.Client, chatID int64) *tg.Channel {
	res, err := api.MessagesGetDialogs(ctx, &tg.MessagesGetDialogsRequest{
		OffsetPeer: &tg.InputPeerEmpty{}, Limit: 100, Hash: 0,
	})
	if err != nil {
		return nil
	}
	var chats []tg.ChatClass
	switch v := res.(type) {
	case *tg.MessagesDialogs:
		chats = v.Chats
	case *tg.MessagesDialogsSlice:
		chats = v.Chats
	}
	for _, item := range chats {
		if ch, ok := item.(*tg.Channel); ok && ch.ID == chatID {
			return ch
		}
	}
	return nil
}
