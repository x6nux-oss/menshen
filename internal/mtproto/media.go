package mtproto

import (
	"bytes"
	"context"
	"strings"

	"github.com/gotd/td/tg"
)

// MediaRow 是一条消息里下载到的图片。Failed 表示找到了图片但下载失败，
// 调用方据此决定是否隔一段时间重试；没有 MediaRow 则表示该消息不存在
// 或不是图片。
type MediaRow struct {
	MessageID int64
	MIME      string
	Data      []byte
	Failed    bool
}

// maxMediaBytes 与消息存档的下载上限一致：Bot API/MTProto 的常见图片远小于它。
const maxMediaBytes = 20 << 20

// FetchImages 按消息 ID 从群历史里下载图片。IDs 会被分成 100 条一批
// （channels.getMessages 的上限），但整次调用只登录一次 MTProto。
func FetchImages(ctx context.Context, c *Client, chatID int64,
	username string, ids []int64) ([]MediaRow, error) {
	in, err := ResolveChannel(ctx, c, chatID, username)
	if err != nil {
		return nil, err
	}
	var out []MediaRow
	for start := 0; start < len(ids); start += 100 {
		end := start + 100
		if end > len(ids) {
			end = len(ids)
		}
		batch := ids[start:end]
		req := &tg.ChannelsGetMessagesRequest{Channel: in}
		for _, id := range batch {
			req.ID = append(req.ID, &tg.InputMessageID{ID: int(id)})
		}
		res, err := c.API.ChannelsGetMessages(ctx, req)
		if err != nil {
			return out, err
		}
		msgs := messageByID(res)
		for _, id := range batch {
			m := msgs[int(id)]
			if m == nil {
				continue
			}
			if row, ok := fetchMessageImage(ctx, c, m); ok {
				out = append(out, row)
			}
		}
	}
	return out, nil
}

func messageByID(res tg.MessagesMessagesClass) map[int]*tg.Message {
	var list []tg.MessageClass
	switch v := res.(type) {
	case *tg.MessagesChannelMessages:
		list = v.Messages
	case *tg.MessagesMessages:
		list = v.Messages
	case *tg.MessagesMessagesSlice:
		list = v.Messages
	}
	out := make(map[int]*tg.Message, len(list))
	for _, item := range list {
		if m, ok := item.(*tg.Message); ok {
			out[m.ID] = m
		}
	}
	return out
}

func fetchMessageImage(ctx context.Context, c *Client, m *tg.Message) (MediaRow, bool) {
	switch media := m.Media.(type) {
	case *tg.MessageMediaPhoto:
		photo, ok := media.Photo.(*tg.Photo)
		if !ok || photo == nil || photo.ID == 0 {
			return MediaRow{}, false
		}
		data, skip, err := downloadPhoto(ctx, c, photo)
		if skip {
			return MediaRow{}, false
		}
		if err != nil || len(data) == 0 {
			return MediaRow{MessageID: int64(m.ID), MIME: "image/jpeg", Failed: true}, true
		}
		return MediaRow{MessageID: int64(m.ID), MIME: "image/jpeg", Data: data}, true

	case *tg.MessageMediaDocument:
		doc, ok := media.Document.(*tg.Document)
		if !ok || doc == nil || doc.ID == 0 {
			return MediaRow{}, false
		}
		if !strings.HasPrefix(strings.ToLower(doc.MimeType), "image/") {
			return MediaRow{}, false
		}
		if doc.Size > maxMediaBytes {
			return MediaRow{}, false
		}
		loc := doc.AsInputDocumentFileLocation("")
		if loc == nil {
			return MediaRow{}, false
		}
		data, err := download(ctx, c, loc)
		if err != nil || len(data) == 0 {
			return MediaRow{MessageID: int64(m.ID), MIME: doc.MimeType, Failed: true}, true
		}
		return MediaRow{MessageID: int64(m.ID), MIME: doc.MimeType, Data: data}, true
	}
	return MediaRow{}, false
}

func downloadPhoto(ctx context.Context, c *Client, p *tg.Photo) ([]byte, bool, error) {
	loc, cached := photoLocation(p)
	if loc == nil {
		if len(cached) > 0 {
			return cached, false, nil
		}
		// 没有可用档位，或最大档超过下载上限：跳过，不当作可重试的失败。
		return nil, true, nil
	}
	data, err := download(ctx, c, loc)
	return data, false, err
}

func photoLocation(p *tg.Photo) (tg.InputFileLocationClass, []byte) {
	var (
		bestType string
		bestArea int
		bestSize int
		cached   []byte
	)
	for _, item := range p.Sizes {
		switch v := item.(type) {
		case *tg.PhotoSize:
			if area := v.W * v.H; area > bestArea {
				bestArea, bestType, bestSize = area, v.Type, v.Size
			}
		case *tg.PhotoSizeProgressive:
			if area := v.W * v.H; area > bestArea {
				bestArea, bestType = area, v.Type
				bestSize = 0
				if n := len(v.Sizes); n > 0 {
					bestSize = v.Sizes[n-1]
				}
			}
		case *tg.PhotoCachedSize:
			if cached == nil {
				cached = v.Bytes
			}
		}
	}
	if bestType == "" || bestSize > maxMediaBytes {
		return nil, cached
	}
	return p.AsInputPhotoFileLocation(bestType), nil
}

func download(ctx context.Context, c *Client, loc tg.InputFileLocationClass) ([]byte, error) {
	var buf bytes.Buffer
	if _, err := c.TG.Download(loc).Stream(ctx, &buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
