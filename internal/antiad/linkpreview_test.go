package antiad

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"menshen/internal/store"
	"menshen/internal/testutil"
	"menshen/internal/tg"
)

// withPreviewServer 起一个假预览页，并把取预览的地址/客户端指过去。
// 返回请求计数；t.Cleanup 恢复全局变量。
func withPreviewServer(t *testing.T, body string) *atomic.Int32 {
	t.Helper()
	var n atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n.Add(1)
		if r.Header.Get("User-Agent") == "" {
			t.Error("取预览页应带 User-Agent，否则页面只给精简版")
		}
		io.WriteString(w, body)
	}))
	oldBase, oldClient := linkPreviewBase, linkPreviewClient
	linkPreviewBase, linkPreviewClient = srv.URL+"/", srv.Client()
	t.Cleanup(func() {
		linkPreviewBase, linkPreviewClient = oldBase, oldClient
		srv.Close()
	})
	return &n
}

const previewHTML = `<html><head>` +
	`<meta property="og:title" content="邪王 &amp; 频道">` +
	`<meta property="og:description" content="https://t.me/TunVN_PreHub_bot?start=ref1&#10;可以免费领取一个muse ai账号">` +
	`</head></html>`

func TestTelegramLinks(t *testing.T) {
	text := strings.Join([]string{
		"看 https://t.me/Rikkasaiko0/134",
		"还有 t.me/TunVN_PreHub_bot?start=ref1",
		"私密 t.me/+abc123 和 t.me/joinchat/xyz 不算",
		"别人的 example.com/t.me/fake/1 不算",
		"重复 https://t.me/Rikkasaiko0/134",
	}, "\n")
	got := telegramLinks(text)
	if len(got) != 2 {
		t.Fatalf("应取 2 条公开链接，得到 %d 条：%+v", len(got), got)
	}
	if got[0].URL != "https://t.me/Rikkasaiko0/134" || got[0].Handle != "Rikkasaiko0" || got[0].ID != "134" {
		t.Errorf("第一条解析错误：%+v", got[0])
	}
	if got[1].URL != "https://t.me/TunVN_PreHub_bot" || got[1].Handle != "TunVN_PreHub_bot" || got[1].ID != "" {
		t.Errorf("第二条解析错误：%+v", got[1])
	}

	// 网页版预览路径指向同一帖，归一成短链接。
	if one := telegramLinks("https://t.me/s/SomeChan/88"); len(one) != 1 ||
		one[0].URL != "https://t.me/SomeChan/88" {
		t.Errorf("t.me/s/ 路径解析错误：%+v", one)
	}
}

// TestLinkSourceTextSkipsButtons：只取正文与内联链接；按钮/卡片 URL 不算
// 本人写下的链接。
func TestLinkSourceTextSkipsButtons(t *testing.T) {
	var m tg.Message
	if err := json.Unmarshal([]byte(`{"text":"看这个","reply_markup":{"inline_keyboard":`+
		`[[{"text":"点我","url":"https://t.me/AdChannel"}]]}}`), &m); err != nil {
		t.Fatal(err)
	}
	if links := telegramLinks(linkSourceText(&m)); len(links) != 0 {
		t.Errorf("按钮里的链接不该展开：%+v", links)
	}

	// text_link 的目标是正文里的链接，要算。
	m = tg.Message{
		Text:     "点这里",
		Entities: []tg.MessageEntity{{Type: "text_link", URL: "https://t.me/HiddenChan/7"}},
	}
	if links := telegramLinks(linkSourceText(&m)); len(links) != 1 ||
		links[0].Handle != "HiddenChan" {
		t.Errorf("text_link 应算正文链接：%+v", links)
	}
}

func TestFetchLinkPreviewParsesOG(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, previewHTML)
	}))
	defer srv.Close()

	p := fetchLinkPreview(srv.URL)
	if p.From != "邪王 & 频道" {
		t.Errorf("og:title 反转义错误：%q", p.From)
	}
	if !strings.Contains(p.Text, "TunVN_PreHub_bot?start=ref1") ||
		!strings.Contains(p.Text, "可以免费领取一个muse ai账号") {
		t.Errorf("og:description 解析错误：%q", p.Text)
	}
}

func TestLinkPreviewsFetchAndCache(t *testing.T) {
	b, _ := testutil.NewTestBot(t, 1)
	n := withPreviewServer(t, previewHTML)
	conf := store.BotChat{ChatID: -100}
	m := testutil.GroupMsg(-100, 5, 7, "https://t.me/Rikkasaiko0/134")

	got := linkPreviews(b, b.Cache.Snap(), conf, m)
	if len(got) != 1 || !strings.Contains(got[0].Text, "muse ai账号") {
		t.Fatalf("应展开 1 条预览，得到 %+v", got)
	}
	// 同一链接再来一次走缓存，不再发请求。
	got = linkPreviews(b, b.Cache.Snap(), conf, m)
	if len(got) != 1 {
		t.Fatalf("缓存命中应仍返回预览，得到 %+v", got)
	}
	if n.Load() != 1 {
		t.Errorf("同一链接应只取一次，实际请求 %d 次", n.Load())
	}

	// 缓存按链接全局共享，但跳过判断先于缓存：另一个群把同一目标当成
	// 自己的群名时，即使缓存里有内容也不返回。
	self := store.BotChat{ChatID: -200, Username: "Rikkasaiko0"}
	if got := linkPreviews(b, b.Cache.Snap(), self,
		testutil.GroupMsg(-200, 6, 8, "https://t.me/Rikkasaiko0/134")); len(got) != 0 {
		t.Errorf("命中缓存也必须遵守跳过规则，得到 %+v", got)
	}
}

func TestLinkPreviewSettingOff(t *testing.T) {
	b, _ := testutil.NewTestBot(t, 1)
	n := withPreviewServer(t, previewHTML)
	if err := b.PutBotSetting(b.BotID(), "antiad_link_preview", "0"); err != nil {
		t.Fatal(err)
	}
	m := testutil.GroupMsg(-100, 5, 7, "https://t.me/Rikkasaiko0/134")
	if got := linkPreviews(b, b.Cache.Snap(), store.BotChat{ChatID: -100}, m); len(got) != 0 {
		t.Errorf("关闭开关后不该展开，得到 %+v", got)
	}
	if n.Load() != 0 {
		t.Errorf("关闭开关后不该发请求，实际 %d 次", n.Load())
	}
}

// fakeChats 用 getChat 返回指定目标/本群的实体，供跳过规则用。
func fakeChats(t *testing.T, fake *testutil.FakeTG, targetHandle string,
	targetID int64, targetType string, selfChatID, linkedID int64) {
	t.Helper()
	fake.RespFunc = func(method string, p map[string]any) (string, bool) {
		if method != "getChat" {
			return "", false
		}
		switch v := p["chat_id"].(type) {
		case string:
			if strings.EqualFold(v, "@"+targetHandle) {
				return `{"ok":true,"result":{"id":` + itoa(targetID) +
					`,"type":"` + targetType + `","title":"目标"}}`, true
			}
		case float64:
			if int64(v) == selfChatID {
				return `{"ok":true,"result":{"id":` + itoa(selfChatID) +
					`,"type":"supergroup","linked_chat_id":` + itoa(linkedID) + `}}`, true
			}
		}
		return "", false
	}
}

func TestLinkPreviewSkipsCurrentGroup(t *testing.T) {
	b, fake := testutil.NewTestBot(t, 1)
	n := withPreviewServer(t, previewHTML)
	conf := store.BotChat{ChatID: -100, Username: "TestGroup"}
	m := testutil.GroupMsg(-100, 5, 7, "https://t.me/TestGroup/9")

	if got := linkPreviews(b, b.Cache.Snap(), conf, m); len(got) != 0 {
		t.Errorf("指向本群的链接不该展开，得到 %+v", got)
	}
	if n.Load() != 0 {
		t.Errorf("指向本群的链接不该发请求，实际 %d 次", n.Load())
	}
	if fake.CountCalls("getChat") != 0 {
		t.Error("指名本群的链接不必再 getChat 解析")
	}
}

func TestLinkPreviewSkipsLinkedChannel(t *testing.T) {
	b, fake := testutil.NewTestBot(t, 1)
	n := withPreviewServer(t, previewHTML)
	fakeChats(t, fake, "LinkedChan", -100555, "channel", -100, -100555)
	m := testutil.GroupMsg(-100, 5, 7, "https://t.me/LinkedChan/134")

	if got := linkPreviews(b, b.Cache.Snap(), store.BotChat{ChatID: -100}, m); len(got) != 0 {
		t.Errorf("本群关联频道不该展开，得到 %+v", got)
	}
	if n.Load() != 0 {
		t.Errorf("本群关联频道不该发请求，实际 %d 次", n.Load())
	}
}

func TestLinkPreviewSkipsWhitelistedChannel(t *testing.T) {
	b, fake := testutil.NewTestBot(t, 1)
	n := withPreviewServer(t, previewHTML)
	fakeChats(t, fake, "WhiteChan", -100666, "channel", -100, 0)
	if err := setGroupWhitelist(b, -100, -100666, true); err != nil {
		t.Fatal(err)
	}
	m := testutil.GroupMsg(-100, 5, 7, "https://t.me/WhiteChan/1")

	if got := linkPreviews(b, b.Cache.Snap(), store.BotChat{ChatID: -100}, m); len(got) != 0 {
		t.Errorf("白名单频道不该展开，得到 %+v", got)
	}
	if n.Load() != 0 {
		t.Errorf("白名单频道不该发请求，实际 %d 次", n.Load())
	}
}

// TestLinkPreviewEvidence：预览里的原文可以作为判词证据通过一致性门。
func TestLinkPreviewEvidence(t *testing.T) {
	st := testAdState()
	st.Message.LinkPreviews = []adLinkPreview{{
		URL:  "https://t.me/Rikkasaiko0/134",
		From: "邪王真眼の支配者たち",
		Text: "https://t.me/TunVN_PreHub_bot?start=ref1783833969\n可以免费领取一个muse ai账号",
	}}
	v := adVerdict{IsAd: true, Reason: "链接指向返利邀请", Evidence: []string{
		"可以免费领取一个muse ai账号", "TunVN_PreHub_bot?start=ref1783833969",
	}}
	if misses := evidenceMisses(st, v); len(misses) > 0 {
		t.Errorf("预览原文应能通过证据门，不符项：%v", misses)
	}
}

// TestLinkPreviewForcesReviewOnClean：初判很自信地判正常时，带预览的消息
// 仍要交复判再看一眼——这条支路才是「只发一个链接」被直接放行的地方。
func TestLinkPreviewForcesReviewOnClean(t *testing.T) {
	b, _ := testutil.NewTestBot(t, 1)
	testutil.EnableAntiad(t, b, -100)
	withPreviewServer(t, previewHTML)
	soN, llmN := fakeAIWith(t, b,
		soReply("clean", 0.99, "none", "message"),
		llmReply(false, 0.9, "none", "message"))

	HandleGroupMessage(b, testutil.GroupMsg(-100, 5, 7, "https://t.me/Rikkasaiko0/134"))
	waitIdle(t, b)

	if soN.Load() != 1 {
		t.Errorf("初判应跑 1 次，实际 %d 次", soN.Load())
	}
	if llmN.Load() != 1 {
		t.Errorf("带链接预览的 clean 初判应强制复判，实际复判 %d 次", llmN.Load())
	}
}

// TestPipelineSendsLinkPreview：完整判定链路的 systemone 请求体里要带上
// 链接预览——只展开而不送检等于没做。
func TestPipelineSendsLinkPreview(t *testing.T) {
	b, _ := testutil.NewTestBot(t, 1)
	testutil.EnableAntiad(t, b, -100)
	n := withPreviewServer(t, previewHTML)

	var sent atomic.Value
	fakeAI(t, b, func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		if strings.HasSuffix(r.URL.Path, "/systemone") {
			sent.Store(string(raw))
		}
		fakeAIOK(w, r)
	})

	HandleGroupMessage(b, testutil.GroupMsg(-100, 5, 7, "https://t.me/Rikkasaiko0/134"))
	waitIdle(t, b)

	body, _ := sent.Load().(string)
	if !strings.Contains(body, `"link_previews"`) {
		t.Fatalf("systemone 请求体里没有 link_previews：%s", body)
	}
	if !strings.Contains(body, "muse ai账号") {
		t.Errorf("预览正文没有进送检载荷：%s", body)
	}
	if n.Load() != 1 {
		t.Errorf("应只取一次预览，实际 %d 次", n.Load())
	}
}
