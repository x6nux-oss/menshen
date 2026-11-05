// Package mtproto 用纯 Go 客户端（gotd/td）访问 Telegram 的 MTProto：
// 入群时间补全与按 message_id 回捞历史图片。
//
// Bot API 没有这两项能力：getChatMember 不给入群时间，getFile 只认当次更新
// 里的 file_id。这里用 bot 自己的 token 登录 MTProto（与用户账号无关），
// 不依赖 python / telethon。
package mtproto

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/gotd/td/session"
	"github.com/gotd/td/telegram"
	"github.com/gotd/td/tg"
)

// Options 是一次 MTProto 操作需要的配置。Dir 为这个 bot 的私有目录：
// gotd 的会话文件与 access_hash 缓存都放在里面。
type Options struct {
	AppID   int
	AppHash string
	Token   string
	BotID   int64
	Dir     string
}

func (o Options) validate() error {
	if o.AppID == 0 || o.AppHash == "" {
		return fmt.Errorf("未配置 tg_api_id / tg_api_hash")
	}
	if o.Token == "" {
		return fmt.Errorf("缺少 bot token")
	}
	if o.Dir == "" {
		return fmt.Errorf("缺少 MTProto 会话目录")
	}
	return nil
}

// Client 是一次 Run 里可用的 API 句柄。
type Client struct {
	API  *tg.Client
	TG   *telegram.Client
	Opts Options
}

// Run 建立 MTProto 连接，必要时用 bot token 登录，然后执行 fn。
// 会话持久化在 Options.Dir 下，重启后复用，不必每次重新登录。
func Run(ctx context.Context, opt Options, fn func(context.Context, *Client) error) error {
	if err := opt.validate(); err != nil {
		return err
	}
	if err := os.MkdirAll(opt.Dir, 0o700); err != nil {
		return fmt.Errorf("创建 MTProto 会话目录: %w", err)
	}
	client := telegram.NewClient(opt.AppID, opt.AppHash, telegram.Options{
		SessionStorage: &session.FileStorage{
			Path: filepath.Join(opt.Dir, "session.json"),
		},
	})
	return client.Run(ctx, func(ctx context.Context) error {
		status, err := client.Auth().Status(ctx)
		if err != nil {
			return fmt.Errorf("MTProto 会话状态查询失败: %w", err)
		}
		if !status.Authorized {
			if _, err := client.Auth().Bot(ctx, opt.Token); err != nil {
				return fmt.Errorf("MTProto bot 登录失败: %w", err)
			}
		} else if status.User != nil && opt.BotID != 0 && status.User.ID != opt.BotID {
			// 同一目录里残留了别的 bot 的会话。继续用会以另一个身份
			// 调接口，结果既查不到群也不好排查，直接明确报错。
			return fmt.Errorf("MTProto 会话属于 bot %d，与当前 bot %d 不符；"+
				"请删除 %s 后重试", status.User.ID, opt.BotID, opt.Dir)
		}
		return fn(ctx, &Client{API: client.API(), TG: client, Opts: opt})
	})
}
