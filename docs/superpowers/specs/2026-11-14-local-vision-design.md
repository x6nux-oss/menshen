# Local vision models

The approved feature replaces remote OCR with PP-OCRv6 small and adds independent Marqo NSFW classification. Administrators can download and enable the models in one action. Docker builds can pre-download the same pinned artifacts.

## Architecture

- Keep the Go application free of CGO. An embedded Python worker uses RapidOCR and ONNX Runtime on CPU, communicating only through JSON lines on standard input/output. One worker is shared by every bot and processes one request at a time, with a bounded context-aware queue and inference timeout.
- Ship exact model URLs, sizes and SHA-256 digests in an embedded manifest. Download to temporary files, verify before atomic rename, preserve valid files on failure, and never allow API clients to choose URLs or filesystem paths.
- Store downloaded models beside the database in `models/`, overridable by `MENSHEN_LOCAL_MODELS_DIR`. Search a separate bundled directory for Docker-preloaded assets so a data volume cannot hide the baked files. Use `MENSHEN_LOCAL_MODELS_PYTHON` and `MENSHEN_LOCAL_MODELS_THREADS` for the Python executable and CPU thread limit.
- Local inference never downloads models. The administrator download action and `-download-models` command are the only download entry points. Docker uses that same command with `PRELOAD_LOCAL_MODELS=1`.
- Add global settings `antiad_local_ocr`, `antiad_local_nsfw` and `antiad_nsfw_threshold` (percentage, default 85). Existing installations remain unchanged until enabled. Successful one-click installation validates the runtime and enables both models.
- Local OCR, NSFW and QR detection are independent. Preserve media/frame attribution and cache successful results, including legitimate empty OCR. Never cache failures as empty results. NSFW contributes a labelled probability to the existing adjudication pipeline; it does not directly delete or ban users.
- Preserve configured remote OCR/vision as fallback for local failures, without discarding successful local evidence. Explicit local errors must remain distinguishable from a clean image.

## Interface and user flow

Both desktop and Telegram Mini App model pages share a local-model card. Only the main administrator can inspect, download or configure global models. The card shows each model's readiness and enabled state, download progress, retryable failures, and the NSFW threshold. All requests use the existing authenticated POST API with operation `localmodels` and actions `status`, `download`, `configure`.

## Verification

Verify checksum rejection and atomic downloads, duplicate requests, permission boundaries, malformed worker output, worker timeout/recovery, OCR plus NSFW on the same image, cached repeated media, no-text images, runtime failure fallback, and video frame attribution. Run Go and frontend quality gates, Python worker checks, and a real offline model inference smoke test. Build Docker with and without preloading and check model discovery with a data volume.
