# 本地 OCR / NSFW

本地视觉是可选能力，默认关闭且不预下载。启用后，图片 OCR 与色情识别都在
本机 CPU 上完成：

- OCR：PP-OCRv6 small，替代远程 OCR；本地失败时仍按原有配置回退。
- 色情识别：Marqo NSFW 分类，输出概率给既有判定链路，不直接处罚用户。
- 二维码检测随 OpenCV 一起在本地完成；视频抽帧沿用现有 `ffmpeg`。

主 Go 程序始终 `CGO_ENABLED=0`。推理由一个常驻 Python 子进程完成，Go 通过
标准输入输出上的 JSON 行协议通信。本地阶段不访问外部推理 HTTP，也不新增监听
端口；但若配置了远程 OCR / 视觉回退，本地失败时现有判定链路仍可能把这些图片
上传到所配置的远程上游。

## 行为

- 现有安装升级后，本地 OCR / NSFW 仍是关闭状态，不会因为镜像里有运行时而自动开启。
- 管理员在桌面管理面板或 Telegram Mini App 的模型页点**一键下载**：下载并
  校验模型、预热工作进程，成功后启用两项。
- `menshen -download-models` 只下载和校验：不要求 bot 凭据、不打开数据库、不启用
  模型。它会读取可选的 `-config` 文件以及模型目录/代理环境变量；没有配置文件也能运行。
- `PRELOAD_LOCAL_MODELS=1` 只在 Docker 构建时把同一批文件烤进镜像，同样不启用。
- 只有管理员下载动作、预加载流程和命令行会下载模型；本地推理过程中绝不下载。
- 模型卡片里的“就绪”只表示清单文件存在且大小/SHA-256 校验通过，不代表
  Python / ONNX 运行时已经可用。模型缺失或损坏会显示未就绪；Python 或推理依赖
  不可用时，启用操作和下载完成后的预热会报错，并在模型页/日志中显示错误。
  若配置了远程 OCR / 视觉模型，判定链路仍可使用原有回退，不会把失败当成“图里没文字”。

## Docker

默认镜像不带模型权重。启动后在桌面管理面板或 Telegram Mini App 的模型页
下载即可，文件落在数据卷：

```bash
docker compose up -d
# 桌面管理面板或 Telegram Mini App → 模型页 → 一键下载
```

容器内默认路径：

| 环境变量 | 默认值 | 用途 |
|---|---|---|
| `MENSHEN_LOCAL_MODELS_DIR` | `/app/data/models` | 运行时下载；与数据库同在数据卷 |
| `MENSHEN_LOCAL_MODELS_BUNDLED_DIR` | `/opt/menshen/models` | 构建时预加载的模型 |
| `MENSHEN_LOCAL_MODELS_PYTHON` | `python3` | Python 解释器 |
| `MENSHEN_LOCAL_MODELS_THREADS` | `2` | ONNX Runtime CPU 线程数，1–16 |

构建时预加载：

```bash
PRELOAD_LOCAL_MODELS=1 docker compose build
docker compose up -d
```

等价的手工构建参数是 `--build-arg PRELOAD_LOCAL_MODELS=1`。构建阶段需要能
访问模型源；模型放到 `/opt/menshen/models`，不会写进数据卷。

模型查找顺序是下载目录在前、预加载目录在后。挂载一个空数据卷不会隐藏镜像里
预加载的模型；数据卷里若有同名的损坏文件，则继续使用校验通过的预加载副本。
模型清单升级导致大小或 SHA-256 不匹配时，旧文件不会被当作就绪。

如果要在已有容器里手动下载（不要求 bot token 或配置文件）：

```bash
docker compose run --rm --no-deps --entrypoint /app/menshen menshen \
  -download-models
```

指定其他下载目录时可用 `-models-dir`，或设置 `MENSHEN_LOCAL_MODELS_DIR`：

```bash
docker compose run --rm --no-deps --entrypoint /app/menshen menshen \
  -download-models -models-dir /app/data/models
```

## 非 Docker

需要 Python **3.12**、Go 1.25+，以及各平台对应的 ONNX Runtime / OpenCV wheel。
不要复用系统里版本不明的 Python 包；建议临时虚拟环境：

```bash
python3.12 -m venv .venv
.venv/bin/pip install -r internal/localvision/requirements.txt

export MENSHEN_LOCAL_MODELS_PYTHON="$PWD/.venv/bin/python"
export MENSHEN_LOCAL_MODELS_DIR="$PWD/models"

CGO_ENABLED=0 go build -o menshen .
./menshen -download-models
./menshen -config config.yaml
```

`MENSHEN_LOCAL_MODELS_PYTHON` 必须指向装好上述依赖的 Python；不设置时默认
`python3`。首次下载需要出网，之后可断网运行本地推理。命令行不要求 bot 凭据、
不打开数据库；有配置文件时会读取其中的模型目录和代理设置。不指定目录时，
下载目录是数据库文件同级的 `models/`；命令行也支持 `-models-dir <目录>` 显式覆盖。

Debian / Ubuntu 上，OpenCV headless 与 ONNX Runtime 通常还需要：

```bash
sudo apt-get install ca-certificates ffmpeg libgl1 libglib2.0-0 libgomp1 python3.12-venv
```

下载后的目录不要提交到版本库。仓库只保存固定清单和 Python 源码，`.gitignore`
已忽略 `models/`、虚拟环境与 Python 缓存。

## 校验、来源与许可

模型 URL、大小与 SHA-256 固定在编译进二进制的
`internal/localvision/models.json`。下载先写临时文件，校验大小与 SHA-256 后
才原子改名；失败不会留下可被当成模型使用的半成品，也不会覆盖已有的有效文件。
API 客户端不能提交 URL 或任意文件路径。

| 清单文件 | 来源 / 转换 | 许可 |
|---|---|---|
| `ocr_det.onnx` | [PaddlePaddle/PP-OCRv6_small_det_onnx](https://huggingface.co/PaddlePaddle/PP-OCRv6_small_det_onnx) | Apache-2.0 |
| `ocr_rec.onnx` | [PaddlePaddle/PP-OCRv6_small_rec_onnx](https://huggingface.co/PaddlePaddle/PP-OCRv6_small_rec_onnx) | Apache-2.0 |
| `ppocrv6_dict.txt` | [RapidAI/RapidOCR](https://www.modelscope.cn/models/RapidAI/RapidOCR) v3.10.0 | Apache-2.0 |
| `marqo-nsfw-384.onnx` | [ICIJ/nsfw-image-detection-384-onnx](https://huggingface.co/ICIJ/nsfw-image-detection-384-onnx)，Marqo 模型的 ONNX trace | Apache-2.0 |

四个文件合计 53,565,792 字节（约 51.1 MiB）。精确下载地址、提交号、文件大小
和 SHA-256 以 `internal/localvision/models.json` 与
`internal/localvision/MODELS.md` 为准；不把模型权重提交到本仓库。分发镜像并
预加载模型时，需一并遵守上游许可与再分发要求。镜像在
`/usr/share/licenses/menshen/local-models/` 附带 `MODELS.md`（固定来源/提交号）
和 Apache-2.0 许可文本；源码仓库不提交模型权重。

## 验证边界

Docker 基座 `python:3.12-slim` 与 Go 构建阶段按目标架构工作：Go 在
`BUILDPLATFORM` 上交叉编译，Python 依赖在目标架构的运行阶段安装。amd64 /
arm64 均由 CI 的原生 runner 分别构建；本地跨架构构建会使用 QEMU，启动与
下载会明显变慢。没有在本机执行过的架构不能宣称已验证。
