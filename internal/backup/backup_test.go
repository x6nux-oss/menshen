package backup

import (
	"archive/tar"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"menshen/internal/store"
)

func openTestStore(t *testing.T, dir string) (*store.Store, string) {
	t.Helper()
	dbPath := filepath.Join(dir, "data", "data.db")
	if err := os.MkdirAll(filepath.Dir(dbPath), 0o700); err != nil {
		t.Fatal(err)
	}
	s, err := store.Open(dbPath)
	if err != nil {
		t.Fatalf("打开库: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	return s, dbPath
}

// TestSnapshotRestoreDrill 是验收要求的演练：备份 → 删库删归档 → 恢复 →
// integrity_check ok → 能读回数据。恢复动作与 scripts/restore.sh 一致。
func TestSnapshotRestoreDrill(t *testing.T) {
	dir := t.TempDir()
	s, dbPath := openTestStore(t, dir)
	if _, err := s.Write.Exec(`INSERT INTO settings(k,v) VALUES('drill','yes')`); err != nil {
		t.Fatal(err)
	}

	archiveDir := filepath.Join(dir, "data", "archive")
	msgDir := filepath.Join(archiveDir, "-100", "images", "2026-01-02")
	if err := os.MkdirAll(msgDir, 0o700); err != nil {
		t.Fatal(err)
	}
	msgPath := filepath.Join(archiveDir, "-100", "messages-2026-01-02.jsonl")
	if err := os.WriteFile(msgPath, []byte(`{"type":"message","message_id":1}`+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(msgDir, "1_0.jpg"), []byte("jpeg"), 0o600); err != nil {
		t.Fatal(err)
	}

	res, err := Snapshot(s.Read, Options{DBPath: dbPath, ArchiveDir: archiveDir, Keep: 2})
	if err != nil {
		t.Fatalf("备份: %v", err)
	}
	if res.DBBytes == 0 {
		t.Error("备份库为空")
	}
	if _, err := os.Stat(filepath.Join(res.Dir, "archive.tar")); err != nil {
		t.Fatalf("缺少归档备份: %v", err)
	}
	for _, p := range []string{res.Dir, filepath.Join(res.Dir, "data.db")} {
		info, err := os.Stat(p)
		if err != nil {
			t.Fatal(err)
		}
		want := os.FileMode(0o600)
		if info.IsDir() {
			want = 0o700
		}
		if runtime.GOOS != "windows" && info.Mode().Perm() != want {
			t.Errorf("%s 权限 %o，期望 %o", p, info.Mode().Perm(), want)
		}
	}
	if err := VerifyFile(filepath.Join(res.Dir, "data.db")); err != nil {
		t.Fatalf("备份完整性校验: %v", err)
	}

	// 模拟灾难：库、WAL/SHM 与归档全部消失。
	s.Close()
	for _, p := range []string{dbPath, dbPath + "-wal", dbPath + "-shm"} {
		os.Remove(p)
	}
	if err := os.RemoveAll(archiveDir); err != nil {
		t.Fatal(err)
	}

	// 恢复：替换库、解包归档。
	if err := copyFile(filepath.Join(res.Dir, "data.db"), dbPath); err != nil {
		t.Fatal(err)
	}
	if err := extractTar(filepath.Join(res.Dir, "archive.tar"), archiveDir); err != nil {
		t.Fatal(err)
	}
	if err := VerifyFile(dbPath); err != nil {
		t.Fatalf("恢复后完整性校验: %v", err)
	}
	if data, err := os.ReadFile(msgPath); err != nil || len(data) == 0 {
		t.Errorf("恢复后归档缺失: %v", err)
	}
	if _, err := os.Stat(filepath.Join(msgDir, "1_0.jpg")); err != nil {
		t.Errorf("恢复后图片缺失: %v", err)
	}

	restored, err := store.Open(dbPath)
	if err != nil {
		t.Fatalf("恢复后打开库: %v", err)
	}
	defer restored.Close()
	var v string
	if err := restored.Read.QueryRow(`SELECT v FROM settings WHERE k='drill'`).Scan(&v); err != nil || v != "yes" {
		t.Fatalf("恢复后读不到原数据: v=%q err=%v", v, err)
	}
}

func TestSnapshotEmptyDBAndRotate(t *testing.T) {
	dir := t.TempDir()
	s, dbPath := openTestStore(t, dir)
	for range 3 {
		if _, err := Snapshot(s.Read, Options{DBPath: dbPath, Dir: filepath.Join(dir, "bk"), Keep: 2}); err != nil {
			t.Fatalf("备份: %v", err)
		}
		// 同秒会加后缀；Prune 仍按名字排序保留最新 2 份。
	}
	entries, err := os.ReadDir(filepath.Join(dir, "bk"))
	if err != nil {
		t.Fatal(err)
	}
	var dirs int
	for _, e := range entries {
		if e.IsDir() {
			dirs++
		}
	}
	if dirs != 2 {
		t.Errorf("保留份数 = %d，期望 2", dirs)
	}
}

func TestPruneKeepsNewest(t *testing.T) {
	dir := t.TempDir()
	for _, name := range []string{
		"20260101T000000Z", "20260102T000000Z", "20260103T000000Z",
	} {
		if err := os.Mkdir(filepath.Join(dir, name), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, name, "data.db"), []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := Prune(dir, 2); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "20260101T000000Z")); !os.IsNotExist(err) {
		t.Errorf("最旧的一份应被删掉: %v", err)
	}
	if latest := Latest(dir); latest.Format(dirTimeLayout) != "20260103T000000Z" {
		t.Errorf("Latest = %v", latest)
	}
	if bytes, n := DirUsage(dir); bytes == 0 || n != 2 {
		t.Errorf("DirUsage = %d 字节 / %d 份", bytes, n)
	}
}

func TestSnapshotUnwritableDir(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root 不受目录权限限制")
	}
	dir := t.TempDir()
	s, dbPath := openTestStore(t, dir)
	bk := filepath.Join(dir, "ro")
	if err := os.Mkdir(bk, 0o500); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Chmod(bk, 0o700) })
	if _, err := Snapshot(s.Read, Options{DBPath: dbPath, Dir: bk}); err == nil {
		t.Fatal("目录不可写时备份应失败")
	}
}

func TestVerifyFileRejectsCorruption(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bad.db")
	if err := os.WriteFile(path, []byte("this is not sqlite"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := VerifyFile(path); err == nil {
		t.Fatal("损坏文件应校验失败")
	}
}

func TestQuickCheck(t *testing.T) {
	dir := t.TempDir()
	s, _ := openTestStore(t, dir)
	if err := QuickCheck(s.Read); err != nil {
		t.Fatalf("新库 quick_check 失败: %v", err)
	}
}

// TestRunBacksUpThenStops：首次没有备份时立即产出一份，stop 后 goroutine 退出。
func TestRunBacksUpThenStops(t *testing.T) {
	dir := t.TempDir()
	s, dbPath := openTestStore(t, dir)
	bk := filepath.Join(dir, "bk")
	stop := make(chan struct{})
	done := make(chan struct{})
	go func() {
		defer close(done)
		Run(stop, s.Read, func() (Options, time.Duration, bool) {
			return Options{DBPath: dbPath, Dir: bk, Keep: 1}, time.Hour, true
		}, nil)
	}()

	deadline := time.Now().Add(20 * time.Second)
	for Latest(bk).IsZero() {
		if time.Now().After(deadline) {
			close(stop)
			<-done
			t.Fatal("定时任务没有产出备份")
		}
		time.Sleep(10 * time.Millisecond)
	}
	close(stop)
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("stop 后备份 goroutine 未退出")
	}
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	if err := os.MkdirAll(filepath.Dir(dst), 0o700); err != nil {
		return err
	}
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

func extractTar(src, dst string) error {
	f, err := os.Open(src)
	if err != nil {
		return err
	}
	defer f.Close()
	tr := tar.NewReader(f)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		path := filepath.Join(dst, filepath.FromSlash(hdr.Name))
		if hdr.Typeflag == tar.TypeDir {
			if err := os.MkdirAll(path, 0o700); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			return err
		}
		out, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
		if err != nil {
			return err
		}
		if _, err := io.Copy(out, tr); err != nil {
			out.Close()
			return err
		}
		if err := out.Close(); err != nil {
			return err
		}
	}
}
