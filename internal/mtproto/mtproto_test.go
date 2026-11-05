package mtproto

import (
	"context"
	"strings"
	"testing"

	"github.com/gotd/td/tg"
)

func TestParticipantDate(t *testing.T) {
	cases := []struct {
		name string
		p    tg.ChannelParticipantClass
		uid  int64
		ts   int
		ok   bool
	}{
		{"member", &tg.ChannelParticipant{UserID: 1, Date: 100}, 1, 100, true},
		{"admin", &tg.ChannelParticipantAdmin{UserID: 2, Date: 200}, 2, 200, true},
		{"banned-still-in", &tg.ChannelParticipantBanned{
			Left: false, Peer: &tg.PeerUser{UserID: 3}, Date: 300}, 3, 300, true},
		{"banned-left", &tg.ChannelParticipantBanned{
			Left: true, Peer: &tg.PeerUser{UserID: 4}, Date: 400}, 0, 0, false},
		{"creator-no-date", &tg.ChannelParticipantCreator{UserID: 5}, 0, 0, false},
	}
	for _, c := range cases {
		uid, ts, ok := participantDate(c.p)
		if ok != c.ok || uid != c.uid || ts != c.ts {
			t.Errorf("%s: got (%d,%d,%v)，期望 (%d,%d,%v)",
				c.name, uid, ts, ok, c.uid, c.ts, c.ok)
		}
	}
}

func TestPhotoLocationPicksLargest(t *testing.T) {
	p := &tg.Photo{
		ID: 1, AccessHash: 2,
		Sizes: []tg.PhotoSizeClass{
			&tg.PhotoSize{Type: "s", W: 100, H: 100, Size: 1000},
			&tg.PhotoSize{Type: "m", W: 800, H: 600, Size: 5000},
			&tg.PhotoSizeProgressive{Type: "x", W: 1280, H: 720, Sizes: []int{100, 9000}},
		},
	}
	loc, cached := photoLocation(p)
	if cached != nil {
		t.Fatal("不应走缓存")
	}
	il, ok := loc.(*tg.InputPhotoFileLocation)
	if !ok || il.ThumbSize != "x" || il.ID != 1 || il.AccessHash != 2 {
		t.Errorf("应选最大一档 x，得到 %+v", loc)
	}
}

func TestPhotoLocationCachedFallback(t *testing.T) {
	p := &tg.Photo{ID: 1, AccessHash: 2, Sizes: []tg.PhotoSizeClass{
		&tg.PhotoCachedSize{Type: "c", W: 10, H: 10, Bytes: []byte("img")},
	}}
	loc, cached := photoLocation(p)
	if loc != nil || string(cached) != "img" {
		t.Errorf("只有缓存图时应返回缓存字节，loc=%v cached=%q", loc, cached)
	}
}

func TestPeerCacheRoundTrip(t *testing.T) {
	dir := t.TempDir()
	rememberChannel(dir, &tg.Channel{ID: 2124027757, AccessHash: 42})
	c := loadPeerCache(peerCachePath(dir))
	if got := c.Channels["-1002124027757"]; got != 42 {
		t.Errorf("缓存 access_hash=%d，期望 42", got)
	}
}

func TestChannelIDMapping(t *testing.T) {
	const raw, api = int64(2124027757), int64(-1002124027757)
	if got := botAPIChatID(raw); got != api {
		t.Errorf("botAPIChatID(%d)=%d，期望 %d", raw, got, api)
	}
	if got := rawChannelID(api); got != raw {
		t.Errorf("rawChannelID(%d)=%d，期望 %d", api, got, raw)
	}
}

func TestResolveRejectsBasicGroup(t *testing.T) {
	err := func() error {
		_, err := ResolveChannel(context.Background(), &Client{
			Opts: Options{Dir: t.TempDir()},
		}, -123456, "")
		return err
	}()
	if err == nil || !strings.Contains(err.Error(), "超级群") {
		t.Errorf("普通群应直接报错，得到 %v", err)
	}
}

func TestOptionsValidate(t *testing.T) {
	if err := (Options{}).validate(); err == nil {
		t.Error("空配置应报错")
	}
	ok := Options{AppID: 1, AppHash: "h", Token: "t", Dir: "d"}
	if err := ok.validate(); err != nil {
		t.Errorf("完整配置不应报错: %v", err)
	}
}
