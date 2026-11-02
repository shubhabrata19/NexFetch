# NexFetch

NexFetch is a modern desktop download manager designed to grow from a focused
YouTube downloader into a universal download manager with independent protocol
engines.

This repository currently contains the **Phase 1 foundation**: a secure Electron
shell, typed IPC, persistent settings, dependency detection, protocol-neutral
download-engine contracts, and the 4K quality policy. The YouTube engine is the
next milestone; no fake YouTube controls or future-engine screens are exposed.

## Current status

- Secure Electron main/preload/renderer separation.
- Context isolation, renderer sandboxing, Node integration disabled.
- Allowlisted, typed IPC with Zod validation and origin checks.
- Persistent application settings with atomic JSON replacement.
- Runtime dependency detection for `yt-dlp`, FFmpeg, and ffprobe.
- Protocol-neutral `DownloadEngine` contract and deterministic engine registry.
- 4K-first quality policy with tests.
- Cross-platform filename sanitization with tests.
- Desktop UI shell for Downloads, History, and Settings.
- Structured local JSON logging with redaction and rotation.

Not implemented yet:

- YouTube metadata extraction and download execution.
- Bundled `yt-dlp`/FFmpeg binaries and checksum verification.
- Download queue orchestration and job persistence.
- HTTP/HTTPS engine.
- BitTorrent engine.
- Pause/resume, scheduling, bandwidth controls, and notifications.

## 4K quality policy

The first release is quality-first:

- “Best available up to 4K” selects the highest actual stream at height ≤ 2160.
- 8K/4320p formats are never offered or selected.
- True 4K may use VP9/AV1 + Opus and produce MKV. MKV is accepted.
- NexFetch will not silently downgrade to 1080p just to produce MP4.
- Separate video/audio streams require FFmpeg.
- The final output will be verified with `ffprobe` before being labeled 4K.
- Manual MP4-compatible selections remain available when codecs support them.

## Prerequisites

- Node.js 22.12 or newer.
- npm.
- For actual downloads (next milestone): `yt-dlp` and FFmpeg/ffprobe available on
  `PATH`, or development overrides through `NXF_YTDLP_PATH`,
  `NXF_FFMPEG_PATH`, and `NXF_FFPROBE_PATH`.

Release builds will bundle pinned, checksum-verified binaries instead of
requiring a system installation.

## Commands

```bash
npm install
npm run dev          # Electron + Vite development
npm run typecheck
npm run lint
npm run test
npm run build        # production build into out/
npm run package      # unpacked application
npm run package:win  # Windows installer
```

## Architecture

```text
src/
  main/       Electron main process, IPC, services, engine registry
  preload/    narrow contextBridge API
  renderer/   React UI
  shared/     domain models, IPC contracts, validation, pure policy code
tests/        Vitest unit tests
resources/    future bundled binaries and licenses
```

### Boundaries

- The renderer never receives Node.js, filesystem, shell, or process APIs.
- The preload exposes only explicit application functions, never a generic IPC
  dispatcher.
- The main process validates every IPC request.
- Engines own protocol behavior; the core owns jobs, queueing, persistence, and
  UI events.
- Engine-specific data stays in typed engine metadata, not the common job shape.
- No dynamic plugin loader or public plugin marketplace is planned for the early
  releases.

## Security notes

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.
- Strict CSP; remote code is not allowed.
- External navigation and new windows are blocked.
- User-controlled values are never interpolated into shell command strings.
- Future child processes will be spawned with argument arrays and `shell: false`.
- Output paths must remain inside the user-selected destination.
- No cookies, credentials, DRM circumvention, paywall bypass, or private-video
  access is supported.

## Next milestone

1. Add the YouTube URL validator and metadata adapter.
2. Map actual formats, enforce the 2160p cap, and implement the quality policy.
3. Bundle/pin yt-dlp, FFmpeg, and ffprobe.
4. Add the download queue, job persistence, progress events, cancellation, and
   retry.
5. Verify merged 4K output with ffprobe.
6. Build the YouTube preview and format-selection UI.

See `.opencode/agents/` and `.opencode/skills/` for the project-specific
architecture, UI, download-engine, torrent, and release guidance.
