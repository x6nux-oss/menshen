package store

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// TestOpenEnablesIncrementalVacuum：新库必须从建表前就打开增量回收，
// 否则保留期清理只会留下永远不还的空闲页。顺带钉住 0600/0700 权限。
func TestOpenEnablesIncrementalVacuum(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "data")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "data.db")
	s, err := Open(path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer s.Close()

	st, err := s.SpaceStats()
	if err != nil {
		t.Fatalf("SpaceStats: %v", err)
	}
	if st.AutoVacuum != 2 {
		t.Errorf("auto_vacuum = %d，期望 2（INCREMENTAL）", st.AutoVacuum)
	}
	if st.PageSize <= 0 || st.PageCount <= 0 {
		t.Errorf("页统计不合理: %+v", st)
	}

	if runtime.GOOS != "windows" {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0o600 {
			t.Errorf("库文件权限 = %o，期望 600", info.Mode().Perm())
		}
		di, err := os.Stat(dir)
		if err != nil {
			t.Fatal(err)
		}
		if di.Mode().Perm() != 0o700 {
			t.Errorf("数据目录权限 = %o，期望 700", di.Mode().Perm())
		}
	}
}

func TestReclaimSpaceOnFreshDB(t *testing.T) {
	path := filepath.Join(t.TempDir(), "data.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if _, err := s.ReclaimSpace(); err != nil {
		t.Fatalf("ReclaimSpace: %v", err)
	}
}
