package localvision

import (
	"bufio"
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"os/exec"
	"strconv"
	"time"
)

//go:embed worker.py
var workerSource string

type Request struct {
	Images [][]byte `json:"images"`
	OCR    bool     `json:"ocr"`
	NSFW   bool     `json:"nsfw"`
}

type FrameResult struct {
	Text string  `json:"text"`
	NSFW float64 `json:"nsfw"`
	QR   bool    `json:"qr"`
}

type Result struct {
	Frames []FrameResult `json:"frames"`
}

type worker struct {
	command *exec.Cmd
	input   io.WriteCloser
	output  *bufio.Scanner
}

func (manager *Manager) Infer(ctx context.Context, request Request) (Result, error) {
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	stop := context.AfterFunc(manager.ctx, cancel)
	defer stop()
	if !request.OCR && !request.NSFW {
		return Result{}, errors.New("未选择本地模型")
	}
	if request.Images == nil {
		request.Images = [][]byte{}
	}
	var size int
	for _, image := range request.Images {
		size += len(image)
	}
	if len(request.Images) > 3 || size > 20<<20 {
		return Result{}, errors.New("本地推理每次最多三帧、合计 20 MB")
	}
	select {
	case <-ctx.Done():
		return Result{}, ctx.Err()
	case manager.slots <- struct{}{}:
		defer func() { <-manager.slots }()
	default:
		return Result{}, errors.New("本地推理队列已满，请稍后重试")
	}
	select {
	case <-ctx.Done():
		return Result{}, ctx.Err()
	case <-manager.gate:
	}
	defer func() { manager.gate <- struct{}{} }()
	if err := ctx.Err(); err != nil {
		return Result{}, err
	}
	paths := map[string]string{}
	for _, artifact := range manager.assets {
		if artifact.Group == "ocr" && !request.OCR || artifact.Group == "nsfw" && !request.NSFW {
			continue
		}
		filename, err := manager.resolve(artifact)
		if err != nil {
			return Result{}, err
		}
		paths[artifact.File] = filename
	}
	if manager.worker == nil {
		if err := manager.startWorker(); err != nil {
			return Result{}, fmt.Errorf("启动本地推理失败（请安装 Python 运行依赖）: %w", err)
		}
	}
	type reply struct {
		result Result
		err    error
	}
	response := make(chan reply, 1)
	process := manager.worker
	go func() {
		wire := struct {
			Request
			Models map[string]string `json:"models"`
		}{request, paths}
		if err := json.NewEncoder(process.input).Encode(wire); err != nil {
			response <- reply{err: err}
			return
		}
		if !process.output.Scan() {
			err := process.output.Err()
			if err == nil {
				err = errors.New("本地推理进程已退出，请检查 Python 运行依赖")
			}
			response <- reply{err: err}
			return
		}
		result, err := decodeResult(process.output.Bytes(), request)
		response <- reply{result, err}
	}()
	select {
	case <-ctx.Done():
		manager.stopWorker()
		<-response
		return Result{}, ctx.Err()
	case decoded := <-response:
		if decoded.err != nil {
			manager.stopWorker()
		}
		return decoded.result, decoded.err
	}
}

func decodeResult(data []byte, request Request) (Result, error) {
	var decoded struct {
		Frames []struct {
			Text string   `json:"text"`
			NSFW *float64 `json:"nsfw"`
			QR   bool     `json:"qr"`
		} `json:"frames"`
		Error string `json:"error"`
	}
	if err := json.Unmarshal(data, &decoded); err != nil {
		return Result{}, fmt.Errorf("本地推理响应无法解析: %w", err)
	}
	if len(decoded.Frames) > len(request.Images) || decoded.Error == "" && len(decoded.Frames) != len(request.Images) {
		return Result{}, errors.New("本地推理返回的帧数不匹配")
	}
	result := Result{Frames: make([]FrameResult, 0, len(decoded.Frames))}
	for _, frame := range decoded.Frames {
		if request.NSFW && frame.NSFW == nil {
			return Result{}, errors.New("本地推理缺少色情分类分数")
		}
		var score float64
		if frame.NSFW != nil {
			score = *frame.NSFW
		}
		if math.IsNaN(score) || math.IsInf(score, 0) || score < 0 || score > 1 {
			return Result{}, errors.New("本地色情分类分数无效")
		}
		text := []rune(frame.Text)
		result.Frames = append(result.Frames, FrameResult{Text: string(text[:min(len(text), 500)]), NSFW: score, QR: frame.QR})
	}
	if decoded.Error != "" {
		return result, fmt.Errorf("本地推理失败: %s", decoded.Error)
	}
	return result, nil
}

func (manager *Manager) startWorker() error {
	command := exec.Command(manager.cfg.Python, "-u", "-c", workerSource,
		"--models-dir", manager.cfg.Dir, "--bundled-dir", manager.cfg.BundledDir,
		"--threads", strconv.Itoa(manager.cfg.Threads))
	command.Stderr = os.Stderr
	input, err := command.StdinPipe()
	if err != nil {
		return err
	}
	output, err := command.StdoutPipe()
	if err != nil {
		input.Close()
		return err
	}
	if err := command.Start(); err != nil {
		input.Close()
		output.Close()
		return err
	}
	scanner := bufio.NewScanner(output)
	scanner.Buffer(make([]byte, 4096), 1<<20)
	manager.worker = &worker{command: command, input: input, output: scanner}
	return nil
}

func (manager *Manager) stopWorker() {
	if manager.worker == nil {
		return
	}
	manager.worker.input.Close()
	manager.worker.command.Process.Kill()
	manager.worker.command.Wait()
	manager.worker = nil
}
