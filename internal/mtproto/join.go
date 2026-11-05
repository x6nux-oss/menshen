package mtproto

import (
	"context"

	"github.com/gotd/td/tg"
	"github.com/gotd/td/tgerr"
)

// JoinRow 是一个成员的入群时间。
type JoinRow struct {
	ChatID int64
	UserID int64
	Joined int64
}

// JoinTimes 扫一遍群成员，取每人的入群时间（秒）。只返回拿得到时间的
// 成员；已退群、创建者（MTProto 没给 date）会被跳过。
func JoinTimes(ctx context.Context, c *Client, chatID int64, username string) ([]JoinRow, error) {
	in, err := ResolveChannel(ctx, c, chatID, username)
	if err != nil {
		return nil, err
	}
	const limit = 200
	var out []JoinRow
	for offset := 0; offset < 100000; {
		res, err := c.API.ChannelsGetParticipants(ctx, &tg.ChannelsGetParticipantsRequest{
			Channel: in,
			// 空查询能覆盖不发言的成员；Recent 只按最近活跃排序，
			// 潜水成员可能被挤出前一万条。
			Filter: &tg.ChannelParticipantsSearch{Q: ""},
			Offset: offset,
			Limit:  limit,
			Hash:   0,
		})
		if err != nil {
			return out, err
		}
		var parts []tg.ChannelParticipantClass
		switch v := res.(type) {
		case *tg.ChannelsChannelParticipants:
			parts = v.Participants
		case *tg.ChannelsChannelParticipantsNotModified:
			return out, nil
		default:
			return out, nil
		}
		for _, p := range parts {
			if uid, ts, ok := participantDate(p); ok && uid > 0 && ts > 0 {
				out = append(out, JoinRow{ChatID: chatID, UserID: uid, Joined: int64(ts)})
			}
		}
		if len(parts) < limit {
			return out, nil
		}
		offset += len(parts)
	}
	return out, nil
}

// LookupJoinTime 实时查一个人的入群时间。直接查 participant 拿不到时，
// 用 nameHints 回调返回的名字搜索成员列表（回调里通常走 Bot API getChatMember，
// 与旧实现一致）。找不到返回 (0, nil)。
func LookupJoinTime(ctx context.Context, c *Client, chatID int64, username string,
	uid int64, nameHints func(context.Context) []string) (int64, error) {
	in, err := ResolveChannel(ctx, c, chatID, username)
	if err != nil {
		return 0, err
	}
	ts, err := joinTimeWithChannel(ctx, c.API, in, uid)
	if err == nil && ts > 0 {
		return ts, nil
	}
	if err != nil && !participantNotFound(err) {
		return 0, err
	}
	if nameHints == nil {
		return 0, nil
	}
	for _, q := range nameHints(ctx) {
		if q == "" {
			continue
		}
		ts, err := searchJoinTimeWithChannel(ctx, c.API, in, q, uid)
		if err == nil && ts > 0 {
			return ts, nil
		}
	}
	return 0, nil
}

func joinTimeWithChannel(ctx context.Context, api *tg.Client,
	in *tg.InputChannel, uid int64) (int64, error) {
	res, err := api.ChannelsGetParticipant(ctx, &tg.ChannelsGetParticipantRequest{
		Channel:     in,
		Participant: &tg.InputPeerUser{UserID: uid, AccessHash: 0},
	})
	if err != nil {
		return 0, err
	}
	if uid2, ts, ok := participantDate(res.Participant); ok && uid2 == uid && ts > 0 {
		return int64(ts), nil
	}
	return 0, nil
}

func searchJoinTimeWithChannel(ctx context.Context, api *tg.Client,
	in *tg.InputChannel, query string, uid int64) (int64, error) {
	res, err := api.ChannelsGetParticipants(ctx, &tg.ChannelsGetParticipantsRequest{
		Channel: in,
		Filter:  &tg.ChannelParticipantsSearch{Q: query},
		Offset:  0,
		Limit:   200,
		Hash:    0,
	})
	if err != nil {
		return 0, err
	}
	body, ok := res.(*tg.ChannelsChannelParticipants)
	if !ok {
		return 0, nil
	}
	for _, p := range body.Participants {
		if uid2, ts, ok := participantDate(p); ok && uid2 == uid && ts > 0 {
			return int64(ts), nil
		}
	}
	return 0, nil
}

// participantDate 从成员记录里取 (user_id, 入群时间秒)。受限成员
// (ChannelParticipantBanned) 的 date 在 left=false 时就是入群时间；创建者
// 没有 date，跳过。
func participantDate(p tg.ChannelParticipantClass) (int64, int, bool) {
	switch v := p.(type) {
	case *tg.ChannelParticipant:
		return v.UserID, v.Date, true
	case *tg.ChannelParticipantAdmin:
		return v.UserID, v.Date, true
	case *tg.ChannelParticipantBanned:
		if v.Left {
			return 0, 0, false
		}
		if peer, ok := v.Peer.(*tg.PeerUser); ok {
			return peer.UserID, v.Date, true
		}
	}
	return 0, 0, false
}

func participantNotFound(err error) bool {
	return tgerr.Is(err, tg.ErrParticipantIDInvalid, tg.ErrUserInvalid, tg.ErrChannelInvalid)
}
