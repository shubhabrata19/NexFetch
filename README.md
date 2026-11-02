# NexFetch

NexFetch is a modern desktop download manager designed to grow from a focused
YouTube downloader into a universal download manager with independent protocol
engines.

This repository currently contains the **YouTube MVP foundation**:

- Secure Electron shell with strongly typed IPC.
- YouTube URL validation, metadata preview, and actual format discovery.
- Quality-first 4K selection and format list.
- Real download queue with progress, cancellation, retry, completion, and history.
- Polished desktop UI with a persistent activity queue, sidebar download controls,
  system-aware light/dark themes, and motion that respects reduced-motion settings.
- ffprobe verification of the merged output.
- Bundled yt-dlp/FFmpeg binary detection for packaged builds.

HTTP/HTTPS and BitTorrent remain later phases. Their controls are not shown until
those engines exist.

## Current status

- Secure Electron main/preload/renderer separation.
- Context isolation, renderer sandboxing, Node integration disabled.
- Allowlisted, typed IPC with Zod validation and sender checks.
- YouTube URL parsing for watch, youtu.be, Shorts, embed, mobile, and music URLs.
- Metadata extraction through yt-dlp with bounded output and timeouts.
- Actual format mapping up to 2160p; 8K is never offered.
- “Best available up to 4K,” manual video selection, and audio-only selection.
- Separate video/audio merging through yt-dlp and FFmpeg.
- Configurable parallel fragment connections and a per-download speed limit,
  with both controls in Settings.
- Monotonic aggregate progress across separate video and audio streams, plus
  speed, size, ETA, cancellation, retry, output finalization, and conflict-safe
  filenames.
- ffprobe verification of resolution and audio presence before a job is marked
  complete.
- Persistent job history and settings in local JSON stores behind repository
  interfaces. SQLite migration is planned for the universal-manager phase.
- Persistent right-side activity queue with compact progress cards for active,
  queued, and recent downloads.
- Sidebar active-download module with per-job stop controls and queue navigation.
- Inline clear confirmation with icon actions and animated card removal. Clearing
  history never deletes downloaded output files.
- Red, black, and burgundy brand system with system, light, and dark appearance
  modes. The sidebar includes a quick light/dark toggle; Settings remains the
  source for the three-way System/Light/Dark preference.
- Keyboard-accessible icon controls, visible focus states, reduced-motion support,
  responsive sidebar collapse, and visually hidden scrollbars that preserve wheel
  and keyboard scrolling.
- Structured local JSON logging with redaction and rotation.
- Windows packaging with bundled runtime binaries.

Not implemented yet:

- User-facing pause/resume for YouTube downloads.
- Playlist/channel/live-stream downloads.
- HTTP/HTTPS engine.
- BitTorrent engine.
- Scheduling, notifications, and auto-update.
- Public third-party plugins or a marketplace.

## 4K quality policy

The first release is quality-first:

- “Best available up to 4K” selects the highest actual stream at height ≤ 2160.
- 8K/4320p formats are never offered or selected.
- True 4K may use VP9/AV1 + Opus and produce MKV. MKV is accepted.
- NexFetch will not silently downgrade to 1080p just to produce MP4.
- Separate video/audio streams require FFmpeg.
- The final output is verified with `ffprobe` before being labeled 4K.
- Manual MP4-compatible selections remain available when codecs support them.
- A real 6-second CC0 2160p video has been downloaded, merged, and verified at
  3840×2160 with an audio track during development.

## Prerequisites

- Node.js 22.12 or newer.
- npm.
- Runtime tools:
  - `yt-dlp`
  - `ffmpeg`
  - `ffprobe`

Development builds look in `resources/bin/<platform>-<arch>/`, then `PATH`, and
allow `NXF_YTDLP_PATH`, `NXF_FFMPEG_PATH`, and `NXF_FFPROBE_PATH` overrides.
Packaged builds use bundled binaries from `resources/bin` and do not trust
renderer-provided executable paths.

`resources/bin/` is intentionally ignored by Git because the binaries are large.
On Windows, `npm run fetch:win-binaries` downloads a development copy. For local
development, place the tools in:

```text
resources/bin/win32-x64/
  yt-dlp.exe
  ffmpeg.exe
  ffprobe.exe
```

The release build includes that directory through `extraResources`. Before a
public release, the binaries must be pinned, checksum-verified, and license
reviewed.

## Commands

```bash
npm install
npm run dev          # Electron + Vite development
npm run check        # typecheck + lint + tests
npm run typecheck
npm run lint
npm run test
npm run format       # format the repository
npm run format:check # verify formatting
npm run build        # production build into out/
npm run package      # unpacked application with resources
npm run package:win  # Windows installer
npm run icons        # regenerate platform icons
```

## Release build

The current Windows review build is produced with:

```bash
npx electron-builder --win nsis -c.directories.output=release/final
```

Outputs:

```text
release/final/NexFetch Setup 0.2.0.exe
release/final/win-unpacked/NexFetch.exe
```

The installer is currently unsigned, so Windows SmartScreen may warn. The
packaged application includes the runtime binaries from `resources/bin` and the
brand asset from `resources/assets`.

## Interface

- The main downloads workspace keeps the YouTube URL flow, preview, format
  chooser, pinned download action, and activity queue visible together.
- The activity rail shows compact cards with a two-line title, status, percent,
  speed, downloaded/total size, ETA, and progress bar. Actions use icon buttons
  for stop, restart, open folder, and clear.
- The sidebar shows up to two active downloads with thumbnails, progress, speed,
  and stop controls. When idle it collapses to a single “No active downloads”
  line.
- Clearing a completed job shows an inline warning inside the card, then uses
  check/cancel icon actions. Confirming fades the card out before removing the
  history entry. Downloaded files remain on disk.
- The theme follows the operating system by default. The sidebar footer toggles
  between explicit light and dark themes; Settings still offers System, Light,
  and Dark directly.
- Scrollbars are visually hidden in the main page, queue rail, and download panel
  while scrolling remains available.

## Branding

The master app icon is `resources/assets/nexfetch_icon.png`. Generate the
platform icon set with:

```bash
npm run icons
```

This produces `build/icon.ico`, `build/icon.icns`, `build/icon.png`, and the
Linux icon sizes under `build/icons`. The renderer uses a 256px copy for the
sidebar/boot marks. The visual identity uses red and burgundy accents on black
surfaces in dark mode and on white surfaces in light mode. The application
follows the operating system by default; the sidebar toggle switches to an
explicit light or dark preference, and Settings offers System, Light, and Dark.

## Architecture

```text
src/
  main/       Electron main process, IPC, services, engine registry, queue
  preload/    narrow contextBridge API
  renderer/   React UI
  shared/     domain models, IPC contracts, validation, pure policy code
tests/        Vitest unit and integration tests
resources/    bundled binaries and licenses (binaries ignored by Git)
```

### Boundaries

- The renderer never receives Node.js, filesystem, shell, or process APIs.
- The preload exposes only explicit application functions, never a generic IPC
  dispatcher.
- The main process validates every IPC request.
- Engines own protocol behavior; the core owns jobs, queueing, persistence,
  workspace cleanup, verification, and UI events.
- Engine-specific data stays in typed engine metadata, not the common job shape.
- Child processes use argument arrays and `shell: false`; no user-controlled
  values are interpolated into shell strings.
- No dynamic plugin loader or public plugin marketplace is planned for the early
  releases.

## Security notes

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.
- Strict CSP; remote code is not allowed.
- External navigation and new windows are blocked.
- YouTube URLs are host-validated and canonicalized before use.
- Output paths remain inside the user-selected destination.
- Filename conflicts are resolved without silent overwrites.
- No cookies, credentials, DRM circumvention, paywall bypass, private-video
  access, or geo-bypass is supported.
- Logs are local and redacted; no telemetry is sent.

## Next milestone

Phase 3 — universal manager core and HTTP/HTTPS:

1. Replace the JSON job repository with SQLite behind the existing repository
   interface.
2. Add a unified source router and HTTP/HTTPS engine.
3. Add Range-based resume, redirects, unknown content length, and optional
   checksum support.
4. Add scheduling and bandwidth controls.
5. Add history filters and capability-driven HTTP controls.
6. Harden large-file retry/resume behavior and release signing.

See `.opencode/agents/` and `.opencode/skills/` for the project-specific
architecture, UI, download-engine, torrent, and release guidance.
