# 前端构建阶段：Vite 产物输出到 ../internal/panel/webdist（相对 web/），
# 也就是镜像里的 /internal/panel/webdist，供下面的 Go 阶段 go:embed。
# 前端产物与目标架构无关，固定跑构建机的原生架构，避免 QEMU 模拟。
# 依赖一律在容器里 npm ci（宿主机的 web/node_modules 已由 .dockerignore 排除）。
FROM --platform=$BUILDPLATFORM node:22-alpine AS web
WORKDIR /src
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build
# 半成品构建尽早失败：两个入口页缺一不可——index.html 是 Mini App，
# admin.html 是桌面端管理面板（npm run build 会依次构建两者）。
RUN test -f /internal/panel/webdist/index.html
RUN test -f /internal/panel/webdist/admin.html

# 构建阶段固定跑在构建机的原生架构上，靠 GOOS/GOARCH 交叉编译出目标架构：
# 纯 Go 交叉编译只要几秒，而让 arm64 走 QEMU 模拟整个 go build 要慢十几倍。
# CI 里 amd64 / arm64 各有原生 runner（见 .github/workflows/docker.yml），这段主要
# 是给本地 `docker buildx build --platform linux/arm64` 省掉模拟编译的开销。
# 本地 docker build / compose 构建时（BuildKit，Docker 23+ 默认）这几个值
# 即本机架构，交叉编译不生效。
FROM --platform=$BUILDPLATFORM golang:1.25-alpine AS build
ARG TARGETOS TARGETARCH
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# 用 web 阶段的新鲜产物覆盖构建上下文里的（宿主机 webdist 已被 .dockerignore
# 排除）。产物缺失时运行时返回前端未构建的 503 提示页，编译本身不受影响。
COPY --from=web /internal/panel/webdist ./internal/panel/webdist
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build \
    -ldflags="-s -w -X 'main.buildTime=$(date -u +%Y-%m-%dT%H:%M:%SZ)'" \
    -o /out/menshen .

# 运行阶段必须是目标架构：ONNX Runtime / OpenCV 的 Python wheel 与 CPU 指令集
# 都按架构分发，不能用构建机架构的 Python 环境。PRELOAD_LOCAL_MODELS=1 时，
# 下面的下载命令也在这个目标架构的容器里执行；本地跨架构构建会走 QEMU，
# CI 的 amd64 / arm64 则各用原生 runner。
#
# 用 python:3.12-slim（glibc）而不是 Alpine：ONNX Runtime 的官方 wheel 按
# manylinux 发布，musl 下没有可直接安装的版本。Go 二进制仍是 CGO_ENABLED=0，
# 静态产物可以原样跑在这个 Debian 基座上。
FROM python:3.12-slim

# ca-certificates：连 Telegram / AI 上游与下载模型都要它。
# ffmpeg：现有视频抽帧。
# libgl1 / libglib2.0-0 / libgomp1：OpenCV headless 与 ONNX Runtime 的运行时依赖。
# OpenCV 自带的 QRCodeDetector 随 wheel 提供，不需要额外的二维码系统库。
# 时区仍用 Go 自带的 zoneinfo.zip（见下），不额外安装 tzdata。
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        ffmpeg \
        libgl1 \
        libglib2.0-0 \
        libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# 依赖版本由 Python worker 任务的 requirements.txt 固定；镜像里装成全局包，
# 这样默认的 MENSHEN_LOCAL_MODELS_PYTHON=python3 无需额外 PATH 设置。
COPY internal/localvision/requirements.txt /tmp/localvision-requirements.txt
RUN python3 -m pip install --no-cache-dir --disable-pip-version-check \
        -r /tmp/localvision-requirements.txt \
    && rm /tmp/localvision-requirements.txt

WORKDIR /app
COPY --from=build /out/menshen /app/menshen

# 模型权重按 Apache-2.0 再分发；许可文本和固定清单来源随镜像一起提供。
COPY internal/localvision/MODELS.md /usr/share/licenses/menshen/local-models/MODELS.md
RUN install -D -m 0644 /usr/share/common-licenses/Apache-2.0 \
        /usr/share/licenses/menshen/local-models/APACHE-2.0.txt

# 时区：Go 发行包自带 zoneinfo.zip，不装 tzdata 就靠它。
# 目标路径固定：TZ / time.Local 的初始化只认
# /usr/share/zoneinfo、/etc/localtime 和构建时 GOROOT 下的 lib/time/zoneinfo.zip
# 三处，ZONEINFO 只对显式的 LoadLocation 生效（放在二进制同目录无效）。
# GOROOT 已烤进二进制，即构建镜像里的 /usr/local/go，所以按原路径放回即可。
# 可用 `docker exec <容器> ./menshen -version` 检查时间戳时区。
COPY --from=build /usr/local/go/lib/time/zoneinfo.zip /usr/local/go/lib/time/zoneinfo.zip
# 只影响日志时间戳的显示（DB 里存的是绝对时间），要改成别的时区在 compose 里覆盖 TZ。
ENV TZ=Asia/Shanghai

# 这些项在容器内有固定取值，因此烤进镜像：
#
#   MENSHEN_DB_PATH      必须落在下面挂的卷里。默认值 data.db 会写进
#                        容器可写层，重启即全部丢失。
#   MENSHEN_LISTEN_ADDR  容器内必须监听全零地址。默认值只监听容器自身的
#                        回环，端口映射过去也连不上。
#   MENSHEN_LOCAL_MODELS_DIR
#                        下载的模型必须落在数据卷里，默认与数据库同目录。
#   MENSHEN_LOCAL_MODELS_BUNDLED_DIR
#                        可选烤进镜像的模型目录，不受数据卷挂载影响。
#   MENSHEN_LOCAL_MODELS_PYTHON / THREADS
#                        运行时 Python 与 CPU 线程数。
#
# ⚠️ 环境变量**优先于** config.yaml。挂了配置文件的话，这些项以这里为准；
#    要改成别的路径就在 compose 的 environment 里覆盖同名变量。
ENV MENSHEN_DB_PATH=/app/data/data.db \
    MENSHEN_LISTEN_ADDR=0.0.0.0:8081 \
    MENSHEN_LOCAL_MODELS_DIR=/app/data/models \
    MENSHEN_LOCAL_MODELS_BUNDLED_DIR=/opt/menshen/models \
    MENSHEN_LOCAL_MODELS_PYTHON=python3 \
    MENSHEN_LOCAL_MODELS_THREADS=2

# 可选：构建时就把校验过的模型烤进镜像。默认 0，不发起任何模型下载。
# 这只准备文件，不会启用模型；管理员首次进入桌面管理面板或 Mini App 的
# 模型页仍需手动开启，或在页面点一键下载（下载、预热并启用）。
ARG PRELOAD_LOCAL_MODELS=0
RUN mkdir -p /app/data/models /opt/menshen/models \
    && if [ "$PRELOAD_LOCAL_MODELS" = "1" ]; then \
        MENSHEN_LOCAL_MODELS_DIR=/opt/menshen/models \
            /app/menshen -download-models; \
    fi

# 数据卷：库里有上游 api_key 明文
VOLUME /app/data
EXPOSE 8081

# -config 指向的文件不存在不算错误：可以完全不挂配置、全用环境变量。
ENTRYPOINT ["/app/menshen", "-config", "/app/config.yaml"]
