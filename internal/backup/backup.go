// Package backup 负责 SQLite 库与归档目录的一致性快照、完整性校验与轮转。
//
// 一份备份是一个目录：<备份根>/<UTC 时间戳>/，内含
//
//	data.db        VACUUM INTO 得到的一致性快照（0600）
//	archive.tar    归档目录的打包（0600），归档为空时没有这个文件
//
// 顺序固定为：先取库快照，再打包归档。归档文件只会比库里的去重索引新，
// 不会出现「索引说已入档、文件却不在备份里」的方向；恢复后 /export 会按
// 目标文件内容去重，所以这段窗口也不会追加重复行。
//
// 调度是进程内 goroutine：失败退避重试，不阻塞消息处理；错误写日志并
// 私聊主管理员（告警由调用方注入，本包不直接发 TG）。
package backup

import (
	"archive/tar"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

// 备份目录名的时间格式（UTC）。解析与排序都靠它。
const dirTimeLayout = "20060102T150405Z"

// 失败重试间隔与次数。退避重试仍失败就等到下一个周期，期间不断写日志。
const (
	retryDelay  = 10 * time.Minute
	retryTimes  = 3
	defaultKeep = 7
)

// Options 是一次备份的路径与保留份数。
type Options struct {
	DBPath     string
	ArchiveDir string // 空 = 库同目录的 archive/
	Dir        string // 空 = 库同目录的 backups/
	Keep       int    // <=0 按 7
}

// Result 描述一次成功的备份。
type Result struct {
	Dir          string
	DBBytes      int64
	ArchiveBytes int64
}

// DirFor 返回默认备份根目录：与数据库同目录的 backups/。
// 单独一个目录，便于按目录做占用统计与整目录轮转。
func DirFor(dbPath string) string {
	dir := filepath.Dir(dbPath)
	if dir == "" {
		dir = "."
	}
	return filepath.Join(dir, "backups")
}

func (o *Options) fill() {
	if o.Dir == "" {
		o.Dir = DirFor(o.DBPath)
	}
	if o.ArchiveDir == "" {
		dir := filepath.Dir(o.DBPath)
		if dir == "" {
			dir = "."
		}
		o.ArchiveDir = filepath.Join(dir, "archive")
	}
	if o.Keep <= 0 {
		o.Keep = defaultKeep
	}
}

// Snapshot 产出一份备份并执行保留轮转。db 用读连接即可：VACUUM INTO
// 是读事务，WAL 下不挡写连接，消息写入不必排队等备份。
func Snapshot(db *sql.DB, opts Options) (Result, error) {
	opts.fill()
	if err := os.MkdirAll(opts.Dir, 0o700); err != nil {
		return Result{}, fmt.Errorf("创建备份目录: %w", err)
	}
	// 上次进程中途退出留下的临时目录会一直占盘，顺手清掉。
	removeStaleTemps(opts.Dir)

	ts := time.Now().UTC().Truncate(time.Second)
	final := filepath.Join(opts.Dir, ts.Format(dirTimeLayout))
	for i := 1; ; i++ {
		if _, err := os.Stat(final); errors.Is(err, fs.ErrNotExist) {
			break
		}
		final = filepath.Join(opts.Dir,
			fmt.Sprintf("%s-%d", ts.Format(dirTimeLayout), i))
	}

	tmp := filepath.Join(opts.Dir, ".tmp-"+filepath.Base(final))
	if err := os.Mkdir(tmp, 0o700); err != nil {
		return Result{}, fmt.Errorf("创建临时备份目录: %w", err)
	}
	defer os.RemoveAll(tmp) // 成功后 rename，这里就成了空操作

	res := Result{Dir: final}
	dbFile := filepath.Join(tmp, "data.db")
	if _, err := db.Exec(`VACUUM INTO ?`, dbFile); err != nil {
		return res, fmt.Errorf("VACUUM INTO: %w", err)
	}
	if err := os.Chmod(dbFile, 0o600); err != nil {
		return res, fmt.Errorf("备份库文件权限: %w", err)
	}
	if err := VerifyFile(dbFile); err != nil {
		return res, fmt.Errorf("备份完整性校验: %w", err)
	}
	if info, err := os.Stat(dbFile); err == nil {
		res.DBBytes = info.Size()
	}

	// 库快照之后才打包归档：索引是库快照那一刻的，归档只会更全。
	if info, err := os.Stat(opts.ArchiveDir); err == nil && info.IsDir() {
		tarPath := filepath.Join(tmp, "archive.tar")
		if err := tarDir(opts.ArchiveDir, tarPath); err != nil {
			return res, fmt.Errorf("打包归档目录: %w", err)
		}
		if err := os.Chmod(tarPath, 0o600); err != nil {
			return res, fmt.Errorf("归档备份权限: %w", err)
		}
		if ti, err := os.Stat(tarPath); err == nil {
			res.ArchiveBytes = ti.Size()
		}
	}

	if err := os.Rename(tmp, final); err != nil {
		return res, fmt.Errorf("提交备份目录: %w", err)
	}
	res.Dir = final
	if err := Prune(opts.Dir, opts.Keep); err != nil {
		return res, fmt.Errorf("按保留策略轮转: %w", err)
	}
	return res, nil
}

// VerifFile 对指定库文件执行 PRAGMA integrity_check。
func VerifyFile(path string) error {
	db, err := sql.Open("sqlite", "file:"+path+"?mode=ro")
	if err != nil {
		return err
	}
	defer db.Close()
	return integrity(db, "integrity_check")
}

// QuickCheck 对已打开的库执行更轻的 PRAGMA quick_check（启动时用）。
func QuickCheck(db *sql.DB) error {
	return integrity(db, "quick_check")
}

// integrity 逐行读取校验结果。SQLite 正常时只返回一行 ok；有损坏时
// 返回多行描述，全部收进错误里便于运维判断。
func integrity(db *sql.DB, pragma string) error {
	rows, err := db.Query(`PRAGMA ` + pragma)
	if err != nil {
		return err
	}
	defer rows.Close()
	var bad []string
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err != nil {
			return err
		}
		if line != "ok" {
			bad = append(bad, line)
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if len(bad) > 0 {
		return fmt.Errorf("%s: %s", pragma, strings.Join(bad, "; "))
	}
	return nil
}

// Prune 只保留最新的 keep 份备份；临时目录超过一天也一并清掉。
func Prune(dir string, keep int) error {
	if keep <= 0 {
		keep = defaultKeep
	}
	entries, err := os.ReadDir(dir)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	var names []string
	for _, e := range entries {
		if e.IsDir() && parseDirTime(e.Name()) != nil {
			names = append(names, e.Name())
		}
	}
	sort.Sort(sort.Reverse(sort.StringSlice(names)))
	for i := keep; i < len(names); i++ {
		if err := os.RemoveAll(filepath.Join(dir, names[i])); err != nil {
			return err
		}
	}
	return nil
}

func parseDirTime(name string) *time.Time {
	base := name
	// Prune 容忍同秒冲突时的 "-1" 后缀；排序按名字即可。
	if i := strings.LastIndexByte(base, '-'); i > 0 && len(base)-i <= 4 {
		base = base[:i]
	}
	t, err := time.Parse(dirTimeLayout, base)
	if err != nil {
		return nil
	}
	return &t
}

func removeStaleTemps(dir string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		if !e.IsDir() || !strings.HasPrefix(e.Name(), ".tmp-") {
			continue
		}
		info, err := e.Info()
		if err == nil && time.Since(info.ModTime()) > 24*time.Hour {
			os.RemoveAll(filepath.Join(dir, e.Name()))
		}
	}
}

// DirUsage 返回备份目录的总字节数与份数（/status 的占用统计用）。
func DirUsage(dir string) (bytes int64, count int) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0, 0
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		if parseDirTime(e.Name()) != nil {
			count++
		}
		filepath.WalkDir(filepath.Join(dir, e.Name()), func(_ string, d fs.DirEntry, err error) error {
			if err == nil && !d.IsDir() {
				if info, ierr := d.Info(); ierr == nil {
					bytes += info.Size()
				}
			}
			return nil
		})
	}
	return bytes, count
}

// Latest 返回最新一份备份的时间；没有备份时返回零值。
func Latest(dir string) time.Time {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return time.Time{}
	}
	var latest time.Time
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		if t := parseDirTime(e.Name()); t != nil && t.After(latest) {
			latest = *t
		}
	}
	return latest
}

// tarDir 把 src 下的普通文件与目录打成 tar。图片与 JSONL 已压缩过，
// 再 gzip 只费 CPU 不省多少盘。
func tarDir(src, dst string) (err error) {
	f, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	defer func() {
		if cerr := f.Close(); err == nil {
			err = cerr
		}
	}()
	tw := tar.NewWriter(f)
	defer func() {
		if cerr := tw.Close(); err == nil {
			err = cerr
		}
	}()

	err = filepath.WalkDir(src, func(path string, d fs.DirEntry, werr error) error {
		if werr != nil {
			return werr
		}
		rel, err := filepath.Rel(src, path)
		if err != nil || rel == "." {
			return err
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		switch {
		case d.IsDir():
			hdr := &tar.Header{Name: filepath.ToSlash(rel) + "/",
				Typeflag: tar.TypeDir, Mode: 0o700, ModTime: info.ModTime()}
			if err := tw.WriteHeader(hdr); err != nil {
				return err
			}
		case d.Type().IsRegular():
			hdr, err := tar.FileInfoHeader(info, "")
			if err != nil {
				return err
			}
			hdr.Name = filepath.ToSlash(rel)
			hdr.Mode = 0o600
			if err := tw.WriteHeader(hdr); err != nil {
				return err
			}
			in, err := os.Open(path)
			if err != nil {
				return err
			}
			_, cerr := io.Copy(tw, in)
			in.Close()
			return cerr
		}
		return nil
	})
	return err
}

// Run 起定时备份循环，直到 stop 关闭。
//
// schedule 每次调度前调用，返回当前配置；ok=false 表示备份被关闭，
// 一分钟后再看（面板改开关要能生效）。周期从磁盘上最新备份算起，
// 进程重启不会把每日备份一直往后推。
func Run(stop <-chan struct{}, db *sql.DB, schedule func() (Options, time.Duration, bool),
	notify func(string)) {
	var (
		next time.Time
		fail int
	)
	for {
		opts, every, ok := schedule()
		if !ok {
			if !sleepUntil(stop, time.Now().Add(time.Minute)) {
				return
			}
			continue
		}
		opts.fill()
		if next.IsZero() {
			due := Latest(opts.Dir).Add(every)
			if due.Before(time.Now()) {
				due = time.Now()
			}
			next = due
		}
		if !sleepUntil(stop, next) {
			return
		}

		res, err := Snapshot(db, opts)
		if err != nil {
			fail++
			slog.Error("备份失败", "dir", opts.Dir, "尝试", fail, "err", err)
			if notify != nil && fail == 1 {
				notify(fmt.Sprintf("⚠️ <b>数据库备份失败</b>\n\n"+
					"目录: <code>%s</code>\n错误: %s\n\n"+
					"会在 %s 后自动重试（最多 %d 次）。"+
					"备份失败不影响消息处理。",
					opts.Dir, escape(err.Error()), retryDelay, retryTimes))
			}
			if fail < retryTimes {
				next = time.Now().Add(retryDelay)
			} else {
				fail = 0
				next = time.Now().Add(every)
			}
			continue
		}
		fail = 0
		next = time.Now().Add(every)
		slog.Info("备份完成", "dir", res.Dir,
			"库字节", res.DBBytes, "归档字节", res.ArchiveBytes, "保留", opts.Keep)
	}
}

func sleepUntil(stop <-chan struct{}, t time.Time) bool {
	d := time.Until(t)
	if d <= 0 {
		select {
		case <-stop:
			return false
		default:
			return true
		}
	}
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-stop:
		return false
	case <-timer.C:
		return true
	}
}

// escape 只保留告警文案所需的 HTML 转义，避免路径里的 < > 破坏消息。
func escape(s string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;").Replace(s)
}
