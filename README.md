# NexFetch

NexFetch is a modern desktop download manager designed to grow from a focused
YouTube downloader into a universal download manager with independent protocol
engines.

Licensed under the Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

[![CI](https://github.com/shubhabrata19/NexFetch/actions/workflows/ci.yml/badge.svg)](https://github.com/shubhabrata19/NexFetch/actions/workflows/ci.yml)

This repository currently contains the **universal manager core** with three
working engines:

- Secure Electron shell with strongly typed IPC.
- YouTube URL validation, metadata preview, actual format discovery, and
  quality-first 4K selection.
- Direct HTTP/HTTPS downloads with redirects, Range resume, pause/resume,
  optional SHA-256 verification, and unknown-length support.
- BitTorrent through a bundled libtorrent 2.x helper: `.torrent` files and v1/v2
  info hashes, metadata-only DHT lookups, DHT/PEX/LSD, tracker tiers, file
  selection, pause/resume, per-torrent speed and peer limits, seeding controls,
  and sortable peer/tracker detail.
- SQLite-backed job and settings persistence with automatic JSON migration.
- Real download queue with scheduling, progress, cancellation, retry,
  completion, and history filters.
- Polished desktop UI with a persistent activity queue, source tabs,
  system-aware light/dark themes, and motion that respects reduced-motion
  settings.
- ffprobe verification of merged YouTube output.
- Bundled yt-dlp/FFmpeg binary detection for packaged builds.

Magnet links are intentionally not accepted. BitTorrent input is a local
`.torrent` file or a v1/v2 info hash resolved through DHT.

## Current status

- Secure Electron main/preload/renderer separation.
- Context isolation, renderer sandboxing, Node integration disabled.
- Allowlisted, typed IPC with Zod validation and sender checks.
- YouTube URL parsing for watch, youtu.be, Shorts, embed, mobile, and music URLs.
- Metadata extraction through yt-dlp with bounded output and timeouts.
- Actual format mapping up to 2160p; 8K is never offered.
- “Best available up to 4K,” manual video selection, and audio-only selection.
- Original-language audio is selected automatically for videos with translated
  audio tracks; dubbed tracks are never picked implicitly.
- Separate video/audio merging through yt-dlp and FFmpeg.
- Configurable parallel fragment connections and a per-download speed limit,
  with both controls in Settings.
- Monotonic aggregate progress across separate video and audio streams, plus
  speed, size, ETA, cancellation, retry, output finalization, and conflict-safe
  filenames.
- ffprobe verification of resolution and audio presence before a job is marked
  complete.
- Direct HTTP/HTTPS downloads with a HEAD-first probe, bounded redirects,
  Content-Disposition filename parsing, MIME-aware extensions, and HTML-page
  rejection.
- Range-based resume with ETag/Last-Modified validation, safe restart when a
  server ignores Range, unknown content length, and a resume sidecar.
- User-facing pause/resume for direct downloads and torrents; YouTube remains
  cancel/retry.
- Optional per-job SHA-256 checksum verification.
- One-time scheduling with automatic startup of due and missed jobs.
- SQLite-backed jobs, attempts, and settings using Electron's built-in
  `node:sqlite` driver. Existing JSON jobs and settings migrate automatically.
- Historical direct-file and YouTube jobs can be filtered in History.
- Persistent right-side activity queue with compact progress cards for active,
  queued, and recent downloads.
- Sidebar active-download module with per-job pause/resume, stop controls,
  metadata lookup status, and queue navigation.
- Inline clear confirmation with icon actions and animated card removal. Clearing
  history never deletes downloaded output files.
- Red, black, and burgundy brand system with system, light, and dark appearance
  modes. The sidebar includes a quick light/dark toggle; Settings remains the
  source for the three-way System/Light/Dark preference.
- Keyboard-accessible icon controls, visible focus states, reduced-motion support,
  responsive sidebar collapse, and visually hidden scrollbars that preserve wheel
  and keyboard scrolling.
- Structured local JSON logging with redaction and rotation.
- Pinned, SHA-256-verified runtime binaries with startup enforcement.
- GitHub Actions CI, CodeQL scanning, and Dependabot updates.
- Windows packaging with bundled runtime binaries.

Not implemented yet:

- User-facing pause/resume for YouTube downloads.
- Playlist/channel/live-stream downloads.
- Notifications and auto-update.
- Proxy configuration, custom headers, cookies, or authenticated HTTP downloads.
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

- Node.js 24 or newer (development and tests; Electron 45 ships Node 24).
- npm.
- Runtime tools:
  - `yt-dlp`
  - `ffmpeg`
  - `ffprobe`
- Python 3.12 (development only, to build the torrent helper).

SQLite is embedded through Electron's built-in `node:sqlite` module. There is no
database server, daemon, port, or native module to rebuild.

Development builds look in `resources/bin/<platform>-<arch>/`, then `PATH`, and
allow `NXF_YTDLP_PATH`, `NXF_FFMPEG_PATH`, and `NXF_FFPROBE_PATH` overrides.
Packaged builds use bundled binaries from `resources/bin` and do not trust
renderer-provided executable paths.

`resources/bin/` is intentionally ignored by Git because the binaries are large.
`resources/binaries.manifest.json` records the pinned versions and SHA-256
hashes. On Windows, `npm run fetch:win-binaries` downloads those exact versions,
verifies every archive and executable, and refuses to install a mismatch. The
application verifies the bundled binaries again at startup and will not run a
binary that no longer matches the manifest. Build the torrent helper once with:

```bash
npm run build:torrent-helper
```

For local development, the binaries live in:

```text
resources/bin/win32-x64/
  yt-dlp.exe
  ffmpeg.exe
  ffprobe.exe
  nexfetch-torrent-helper.exe
```

The release build includes that directory and the manifest through
`extraResources`. The torrent helper is built locally because PyInstaller builds
are not reproducible enough to publish a stable hash, so it is presence-checked
rather than hash-pinned; its Python dependencies are pinned in
`tools/torrent-helper/requirements.txt`. Signing and notarization remain release
workflow tasks.

## Commands

```bash
npm install
npm run dev          # Electron + Vite development
npm run check        # typecheck + lint + tests
npm run typecheck
npm run lint
npm run test
npm run verify:manifest  # validate the pinned binary manifest
npm run verify:binaries  # verify installed binaries against the manifest
npm run format       # format the repository
npm run format:check # verify formatting
npm run build        # production build into out/
npm run package      # unpacked application with resources
npm run package:win  # Windows installer
npm run build:torrent-helper # build the libtorrent helper executable
npm run release:checksums -- release/<version> # write SHA256SUMS.txt
npm run icons        # regenerate platform icons
```

## Release build

Binary builds are currently **unsigned previews**. They are suitable for
technical testing only and must not be presented as a stable public release.
The full policy and checklist are in [docs/release-process.md](docs/release-process.md).

```bash
npm run check
npm run fetch:win-binaries
npm run verify:binaries -- --require-installed
npx electron-builder --win nsis -c.directories.output=release/v0.5.0-polish
npm run release:checksums -- release/v0.5.0-polish
```

Outputs:

```text
release/v0.5.0-polish/NexFetch Setup 0.5.0.exe
release/v0.5.0-polish/SHA256SUMS.txt
release/v0.5.0-polish/win-unpacked/NexFetch.exe
```

The installer is unsigned, so Windows SmartScreen will warn about an unknown
publisher. Publish preview artifacts only as a GitHub pre-release, always attach
`SHA256SUMS.txt`, and include the unsigned warning. Do not distribute macOS
binaries until Developer ID signing and notarization are available.

### Verify a download

Windows:

```powershell
certutil -hashfile "NexFetch Setup 0.5.0.exe" SHA256
```

Compare the result with `SHA256SUMS.txt` from the same release. On macOS/Linux,
run `sha256sum -c SHA256SUMS.txt`. A checksum mismatch means the file is not the
published build and should not be run.

The packaged application includes the verified runtime binaries from
`resources/bin` and the brand asset from `resources/assets`.

## Interface

- The downloads workspace has YouTube, Direct file, and Torrent tabs. All keep
  the input, preview, pinned action, and activity queue visible together.
- Torrent intake accepts a dropped or chosen `.torrent` file, or a v1/v2 info
  hash. The hash form is a single row above a compact file drop band, with live
  format validation and an inline lookup status.
- Info-hash lookups are first-class jobs. They appear under Preparing
  immediately, keep running across screen changes, report peers/DHT nodes and
  elapsed time, and can be cancelled or retried. Up to three run at once.
  Completed lookups move into Setup without stealing focus, and interrupted
  lookups resume next launch. The helper runs in metadata-only mode, so no
  payload files are allocated or downloaded.
- The Torrents page is a master–detail client with Preparing, Setup,
  Downloading, Seeding, and Completed groups; files, peers, trackers, and
  discovery tabs; seeds/peers connected-versus-available counts; live
  download/upload speed; per-torrent limits; and explicit stop-seeding controls.
- The peer table is sortable by address, client, progress, download speed,
  upload speed, and seed/peer type, with persistent sort state and accessible
  sort indicators.
- Transfer limits cover download speed, upload speed, and maximum connected
  peers. Blank fields inherit the global speed limit or connection-profile peer
  default; zero speed means unlimited. Applied limits persist across restart.
- Closing the window while transfers are active offers Continue in Background
  (tray) or Close NexFetch. Unfinished downloads resume next launch; seeding
  stops and does not resume automatically.
- Direct file previews show the final host, filename, content type, reported
  size, resume support, an optional SHA-256 checksum, and an optional start time.
- The activity rail shows compact cards with a two-line title, status, percent,
  speed, downloaded/total size, ETA, and progress bar. Actions use icon buttons
  for pause/resume where supported, stop, restart, open folder, and clear.
- Direct downloads and torrents expose pause and resume. YouTube jobs expose
  cancel and retry. Metadata lookups expose cancel and retry.
- History filters records by All, Files, Videos, or Torrents without deleting
  output files.
- The sidebar shows up to two active downloads with thumbnails, progress, speed,
  and pause/resume or stop controls. Metadata lookups appear as “Fetching
  metadata”. When idle it collapses to a single “No active downloads” line.
- Clearing a completed job shows an inline warning inside the card, then uses
  check/cancel icon actions. Confirming fades the card out before removing the
  history entry. Downloaded files remain on disk.
- Text fields use a native right-click menu with Undo, Redo, Cut, Copy, Paste,
  Delete, and Select All. The torrent hash Paste button reads the clipboard
  through the main process rather than browser clipboard permissions.
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
    download/ job manager, preview cache, generic preview service
    engines/  YouTube, HTTP/HTTPS, and libtorrent adapter
  tools/torrent-helper/  Python libtorrent JSON-lines helper
    storage/  SQLite schema, repositories, JSON migration
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
- The torrent helper is a separate process with a narrow JSON-lines protocol;
  it never exposes a localhost web API.
- Child processes use argument arrays and `shell: false`; no user-controlled
  values are interpolated into shell strings.
- No dynamic plugin loader or public plugin marketplace is planned for the early
  releases.

## Security notes

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.
- Strict CSP; remote code is not allowed.
- External navigation and new windows are blocked.
- YouTube URLs are host-validated and canonicalized before use.
- HTTP links are restricted to `http:` and `https:`; embedded credentials are
  rejected, redirects are bounded and revalidated, and HTML pages are not saved
  as files.
- HTTP filenames are sanitized, path traversal is rejected, and Range requests
  are validated before appending to a partial file.
- Output paths remain inside the user-selected destination.
- Filename conflicts are resolved without silent overwrites.
- Info-hash metadata lookups run in metadata-only mode: they never allocate or
  download payload files before the setup screen is confirmed.
- Torrent metadata is treated as untrusted: file paths, tracker URLs, file
  counts, and metadata size are validated before a job is created.
- Torrent metadata is sanitized before use: trackers that resolve to private or
  local hosts, unsupported tracker schemes, web seeds, and torrent-provided DHT
  nodes are stripped without changing the info hash.
- Protocol encryption is enabled; DHT/PEX/LSD are automatically disabled for
  private torrents.
- Router port mapping uses NAT-PMP/UPnP only when enabled in Settings, maps one
  temporary port, and removes it on exit.
- Info hashes and magnet-style identifiers are never written to logs.
- No cookies, credentials, DRM circumvention, paywall bypass, private-video
  access, or geo-bypass is supported.
- Logs are local and redacted; no telemetry is sent.
- Runtime binaries are pinned in `resources/binaries.manifest.json`; the fetch
  script is HTTPS-only and verifies archives and executables, and the app
  re-verifies pinned binaries with SHA-256 before running them. A modified
  binary is refused rather than silently executed.

## Responsible use

NexFetch does not include DRM circumvention, paywall bypass, private-video
access, credential theft, or geo-restriction bypass. Only download content you
own or are permitted to download. You are responsible for complying with
copyright law, the terms of service of the source site, and local law. The
project is not affiliated with YouTube or any other source platform.

## License

NexFetch is licensed under the Apache License 2.0. See [LICENSE](LICENSE) and
[NOTICE](NOTICE). Bundled third-party runtime tools keep their own licenses; see
[resources/licenses/THIRD-PARTY-NOTICES.md](resources/licenses/THIRD-PARTY-NOTICES.md).

## Next milestone

The torrent client is implemented. The remaining release work is:

1. Run packaged-app smoke tests on Windows, macOS, and Linux, including automatic
   JSON-to-SQLite migration and the bundled torrent helper.
2. Add code signing/notarization and a tag-driven signed release workflow.
3. Harden large-swarm resource use, sleep/network-change recovery, and
   cross-platform libtorrent packaging.
4. Add automated end-to-end tests with a local legal swarm; keep public swarms out
   of routine CI.

See `.opencode/agents/` and `.opencode/skills/` for the project-specific
architecture, UI, download-engine, torrent, and release guidance. These files
are AI-agent instruction documents used during development; they are not part of
the shipped application or a supported end-user API.
