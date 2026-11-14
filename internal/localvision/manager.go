package localvision

import (
	"context"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"
)

//go:embed models.json
var manifest []byte

var ErrDownloading = errors.New("模型正在下载，请稍后查看进度")

type Config struct {
	Dir        string
	BundledDir string
	Python     string
	Threads    int
	Client     *http.Client
}

type asset struct {
	Group  string `json:"group"`
	File   string `json:"file"`
	URL    string `json:"url"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}

type ModelStatus struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Ready     bool   `json:"ready"`
	SizeBytes int64  `json:"size_bytes"`
}

type Status struct {
	Models          []ModelStatus `json:"models"`
	Downloading     bool          `json:"downloading"`
	DownloadedBytes int64         `json:"downloaded_bytes"`
	TotalBytes      int64         `json:"total_bytes"`
	Error           string        `json:"error"`
}

type verifiedFile struct {
	info   os.FileInfo
	digest string
}

type Manager struct {
	cfg    Config
	assets []asset
	ctx    context.Context
	cancel context.CancelFunc
	mu     sync.Mutex
	state  Status
	done   chan struct{}
	closed bool
	files  sync.Map
	gate   chan struct{}
	slots  chan struct{}
	worker *worker
}

func New(cfg Config) *Manager {
	if cfg.Dir == "" {
		cfg.Dir = "models"
	}
	if cfg.BundledDir == "" {
		cfg.BundledDir = "/opt/menshen/models"
	}
	if cfg.Python == "" {
		cfg.Python = "python3"
	}
	if cfg.Threads <= 0 {
		cfg.Threads = 2
	}
	if cfg.Client == nil {
		cfg.Client = &http.Client{Timeout: 15 * time.Minute}
	}
	ctx, cancel := context.WithCancel(context.Background())
	manager := &Manager{cfg: cfg, ctx: ctx, cancel: cancel, gate: make(chan struct{}, 1), slots: make(chan struct{}, 4)}
	manager.gate <- struct{}{}
	if err := json.Unmarshal(manifest, &manager.assets); err != nil {
		panic("invalid embedded model manifest: " + err.Error())
	}
	return manager
}

func Revision() string {
	sum := sha256.Sum256(manifest)
	return hex.EncodeToString(sum[:8])
}

func (manager *Manager) Status() Status {
	manager.mu.Lock()
	status := manager.state
	manager.mu.Unlock()
	status.Models = []ModelStatus{{ID: "ocr", Name: "PP-OCRv6 small"}, {ID: "nsfw", Name: "Marqo NSFW"}}
	status.TotalBytes = 0
	for index := range status.Models {
		model := &status.Models[index]
		model.Ready = true
		for _, artifact := range manager.assets {
			if artifact.Group != model.ID {
				continue
			}
			model.SizeBytes += artifact.Size
			if _, err := manager.resolve(artifact); err != nil {
				model.Ready = false
			}
		}
		model.Ready = model.Ready && model.SizeBytes > 0
		status.TotalBytes += model.SizeBytes
	}
	return status
}

func (manager *Manager) resolve(artifact asset) (string, error) {
	for _, directory := range []string{manager.cfg.Dir, manager.cfg.BundledDir} {
		filename, err := filepath.Abs(filepath.Join(directory, artifact.File))
		if err == nil && manager.verify(filename, artifact) {
			return filename, nil
		}
	}
	return "", fmt.Errorf("本地模型文件 %s 缺失或校验失败，请到模型页一键下载", artifact.File)
}

func (manager *Manager) verify(filename string, artifact asset) bool {
	info, err := os.Stat(filename)
	if err != nil || !info.Mode().IsRegular() || info.Size() != artifact.Size {
		return false
	}
	if cached, ok := manager.files.Load(filename); ok {
		previous := cached.(verifiedFile)
		if previous.digest == artifact.SHA256 && os.SameFile(previous.info, info) && previous.info.ModTime().Equal(info.ModTime()) {
			return true
		}
	}
	file, err := os.Open(filename)
	if err != nil {
		return false
	}
	defer file.Close()
	digest := sha256.New()
	if _, err := io.Copy(digest, file); err != nil || hex.EncodeToString(digest.Sum(nil)) != artifact.SHA256 {
		return false
	}
	manager.files.Store(filename, verifiedFile{info: info, digest: artifact.SHA256})
	return true
}

func (manager *Manager) StartDownload(onComplete func() error) error {
	_, err := manager.startDownload(context.Background(), onComplete)
	return err
}

func (manager *Manager) Download(ctx context.Context) error {
	result, err := manager.startDownload(ctx, nil)
	if err != nil {
		return err
	}
	return <-result
}

func (manager *Manager) startDownload(ctx context.Context, onComplete func() error) (<-chan error, error) {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	if manager.closed {
		return nil, errors.New("本地模型管理器已关闭")
	}
	if manager.state.Downloading {
		return nil, ErrDownloading
	}
	manager.state = Status{Downloading: true}
	manager.done = make(chan struct{})
	done := manager.done
	result := make(chan error, 1)
	go func() {
		downloadCtx, cancel := context.WithTimeout(ctx, 15*time.Minute)
		stop := context.AfterFunc(manager.ctx, cancel)
		defer cancel()
		defer stop()
		err := manager.download(downloadCtx)
		if err == nil && onComplete != nil {
			if err = downloadCtx.Err(); err == nil {
				err = onComplete()
			}
		}
		manager.mu.Lock()
		manager.state.Downloading = false
		if err != nil {
			manager.state.Error = err.Error()
		}
		manager.mu.Unlock()
		result <- err
		close(result)
		close(done)
	}()
	return result, nil
}

func (manager *Manager) download(ctx context.Context) error {
	if err := os.MkdirAll(manager.cfg.Dir, 0o755); err != nil {
		return fmt.Errorf("创建模型目录: %w", err)
	}
	for _, artifact := range manager.assets {
		if err := ctx.Err(); err != nil {
			return err
		}
		if _, err := manager.resolve(artifact); err == nil {
			manager.advance(artifact.Size)
			continue
		}
		if err := manager.downloadAsset(ctx, artifact); err != nil {
			return fmt.Errorf("下载 %s: %w", artifact.File, err)
		}
	}
	return nil
}

func (manager *Manager) downloadAsset(ctx context.Context, artifact asset) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, artifact.URL, nil)
	if err != nil {
		return err
	}
	response, err := manager.cfg.Client.Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("服务器返回 HTTP %d", response.StatusCode)
	}
	file, err := os.CreateTemp(manager.cfg.Dir, ".download-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	defer file.Close()
	digest := sha256.New()
	written, err := io.Copy(io.MultiWriter(file, digest, progressWriter{manager}), io.LimitReader(response.Body, artifact.Size+1))
	if err != nil {
		return err
	}
	if written != artifact.Size || hex.EncodeToString(digest.Sum(nil)) != artifact.SHA256 {
		return errors.New("模型大小或 SHA-256 校验失败，未发布下载文件")
	}
	if err := file.Chmod(0o644); err != nil {
		return err
	}
	if err := file.Sync(); err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Rename(file.Name(), filepath.Join(manager.cfg.Dir, artifact.File))
}

type progressWriter struct{ manager *Manager }

func (writer progressWriter) Write(data []byte) (int, error) {
	writer.manager.advance(int64(len(data)))
	return len(data), nil
}

func (manager *Manager) advance(count int64) {
	manager.mu.Lock()
	manager.state.DownloadedBytes += count
	manager.mu.Unlock()
}

func (manager *Manager) Close() {
	manager.mu.Lock()
	manager.closed = true
	manager.cancel()
	done := manager.done
	manager.mu.Unlock()
	if done != nil {
		<-done
	}
	<-manager.gate
	manager.stopWorker()
	manager.gate <- struct{}{}
}
