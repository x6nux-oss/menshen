package antiad

import (
	"strings"
	"testing"

	"menshen/internal/testutil"
)

// TestAILogReplacesImageWithArchiveRef：开启存档后，识图请求落 ai_log 时
// base64 换成指向存档图片的占位符，不再重复存一份图片。
func TestAILogReplacesImageWithArchiveRef(t *testing.T) {
	b, fake := testutil.NewTestBot(t, 1)
	testutil.EnableAntiad(t, b, -100)
	b.Cfg.ArchiveDir = t.TempDir()
	if err := b.PutSetting("archive_enabled", "1"); err != nil {
		t.Fatal(err)
	}
	visionAI(t, b)
	fakeFiles(t, b, fake, 200)

	HandleGroupMessage(b, photoMsg(1, "u1"))
	waitIdle(t, b)

	var input string
	if err := b.Store.Read.QueryRow(`SELECT input FROM ai_log
		WHERE input LIKE '%图片已存档%' ORDER BY id DESC LIMIT 1`).Scan(&input); err != nil {
		t.Fatalf("没有找到带占位符的识图流水: %v", err)
	}
	if strings.Contains(input, "data:image/") {
		t.Errorf("识图流水里仍带 base64: %s", input)
	}
	if !strings.Contains(input, "«图片已存档:") || !strings.Contains(input, "1_0.*") {
		t.Errorf("占位符没有指向存档路径: %s", input)
	}
}

// TestAILogKeepsBase64WithoutArchive：没开存档时不改写，保持原样。
func TestAILogKeepsBase64WithoutArchive(t *testing.T) {
	b, fake := testutil.NewTestBot(t, 1)
	testutil.EnableAntiad(t, b, -100)
	visionAI(t, b)
	fakeFiles(t, b, fake, 200)

	HandleGroupMessage(b, photoMsg(1, "u1"))
	waitIdle(t, b)

	var input string
	if err := b.Store.Read.QueryRow(`SELECT input FROM ai_log
		WHERE input LIKE '%data:image/%' ORDER BY id DESC LIMIT 1`).Scan(&input); err != nil {
		t.Fatalf("没开存档时应保留 base64: %v", err)
	}
}
