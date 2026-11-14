# Local Vision Implementation Plan

> For agentic workers: use superpowers:subagent-driven-development for the independent worker and UI tasks, followed by a whole-branch review.

**Goal:** Add offline OCR and NSFW inference with an administrator one-click installer and Docker preloading.

**Architecture:** A Go model manager downloads checksum-pinned assets and owns one persistent Python ONNX worker. Existing authenticated panels expose status/install/settings, and the current media pipeline consumes independent OCR/NSFW evidence.

**Tech stack:** Go standard library, existing React/MUI/TanStack Query, RapidOCR, ONNX Runtime CPU, Python standard library and existing inference dependencies.

**Spec:** `docs/superpowers/specs/2026-11-14-local-vision-design.md`

## Global constraints

- Work only in the isolated `codex/local-vision-models` worktree; preserve the original checkout's uncommitted edits.
- Keep `CGO_ENABLED=0` for the main application. No remote inference, implicit model downloads or new frontend dependencies.
- Preserve existing model settings and remote fallback. NSFW is evidence for existing adjudication, not a direct punishment rule.
- Use tests for download integrity, process lifecycle, authentication and media behavior; verify actual model inference before completion.

## Tasks

- [x] Runtime: create `internal/localvision/worker.py`, pinned requirements and model manifest; verify real PP-OCRv6 small and Marqo inference offline, including QR detection and malformed-image handling. Own Python and manifest files only.
- [x] Manager: add the Go downloader, status reporting, single-worker protocol, cancellation and shutdown in `internal/localvision`; expose it through `core.Shared`, add CLI download support and environment configuration. Tests use local HTTP servers and a subprocess fixture.
- [x] Panel: implement the authenticated `localmodels` operation in `internal/panel`, a shared React model card in both model pages, and focused permission/interaction tests. Consume the manager's public status/download/inference API.
- [x] Media: integrate local results into `internal/antiad/vision.go`, preserving cache semantics, remote fallbacks and per-frame labels. Regression tests cover an image containing both text and an NSFW signal.
- [x] Packaging: add CPU runtime dependencies and optional model preload to Docker, document offline/non-Docker setup and persistent model paths, and run both build modes.
- [x] Verify and land: run focused checks then full quality gates, obtain an independent review, fix findings, update issue tracking, commit and push the feature branch.

## Coordination

The primary agent owns Go manager/core/media/CLI code. Worker, panel and packaging tasks have disjoint file ownership. Manager API and worker JSON protocol are agreed before dispatch; interface changes are sent to all affected agents. User approval is already supplied by “就这样吧…开个新分支来实现一下”.

## Validation

- Rebased onto `b25cdad`, preserving the main branch's model reasoning settings and runtime status fields.
- `go test ./...` and `go vet ./...` pass; race checks pass for localvision, config, panel and the focused media regressions.
- Frontend lint, all 342 tests and both production builds pass; desktop and mobile browser checks cover download, progress, failure and retry.
- All 21 Python checks pass with real model assets, including malformed images, QR errors, partial frame evidence and bounded NSFW/QR resize allocation. Go real-model and authenticated one-click enable integration checks also pass.
- Both Docker build modes pass on arm64. The preloaded image runs both models with networking disabled and an empty data volume; the default image contains no weights. amd64 dependency wheels were checked, but a full amd64 image was not built locally.
- Existing unrelated anti-ad race flakiness is tracked in `menshen-dok`.
