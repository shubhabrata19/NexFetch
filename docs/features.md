# Features

NexFetch is a Windows desktop download manager with three independent engines
behind one queue, one history, and one persistence layer.

## YouTube

- Accepts `youtube.com`, `m.youtube.com`, `music.youtube.com`, `youtu.be`,
  Shorts, live, embed, and `youtube-nocookie.com` video links.
- Resolves metadata through `yt-dlp` with bounded output, timeouts, and canonical
  URL validation; arbitrary URLs never reach the extractor.
- Shows the actual available formats up to **2160p** — never invented quality
  options. 8K/4320p is excluded by policy.
- **Best available up to 4K**, manual video selection, and audio-only mode.
- Prefers original-language audio when translated tracks exist; dubbed tracks are
  never selected implicitly.
- Merges adaptive video/audio with FFmpeg, then verifies resolution and audio
  presence with `ffprobe` before marking the job complete.
- Parallel fragment downloads and a per-download speed cap.

## Direct files (HTTP/HTTPS)

- HEAD-first probe with a ranged GET fallback.
- Bounded, revalidated redirect chains; embedded URL credentials are rejected.
- HTML pages are rejected instead of being saved as bogus files.
- `Content-Disposition` filename parsing with MIME-aware extensions.
- Range-based resume with ETag/Last-Modified validation and safe restart when the
  server ignores Range.
- Unknown content length, disk-space prechecks, optional SHA-256 verification,
  pause/resume, and conflict-safe output names.

## BitTorrent

- `.torrent` files, v1/v2 info hashes, and magnet links. Magnet URIs are parsed
  locally; only the info hash and scheme-filtered trackers reach the torrent
  helper.
- A separate libtorrent 2.x helper process speaking JSON-lines over stdio — no
  local web API, no remote access.
- Metadata-only lookups (`default_dont_download`) so a lookup never allocates or
  downloads payload files before setup is confirmed.
- Torrent metadata is treated as untrusted:
  - bounds-checked bencode parser and file-count/metadata-size limits;
  - per-file path traversal checks;
  - tracker URLs validated against private/local hosts;
  - web seeds and torrent-provided DHT nodes stripped without changing the info
    hash;
  - private torrents automatically disable DHT/PEX/LSD.
- File selection, pause/resume, per-torrent download/upload/peer limits, peer and
  tracker tables, recheck/verify, and explicit user-controlled seeding.
- Peer connections are filtered against private address ranges; encryption is
  enabled.

## Queue, persistence, and history

- Configurable concurrency (1–5 downloads) with one-time scheduling.
- Live progress, speed, ETA, pause/resume, cancel, retry, and deterministic
  workspace cleanup.
- Completion moves files into the chosen destination with conflict-safe names;
  clearing history never deletes downloaded files.
- SQLite persistence through Electron's built-in `node:sqlite`, with automatic
  JSON migration from pre-SQLite releases and corrupt-file quarantine.
- History filters for All / Files / Videos / Torrents.

## Desktop experience

- Persistent right-side activity queue and a sidebar active-download module.
- System-aware light/dark themes with a quick sidebar toggle.
- Keyboard-accessible controls, visible focus, reduced-motion support, and
  status cues that do not rely on color alone.
- Settings for downloads, transfer limits, torrent behaviour, appearance, and
  local dependency diagnostics with a Recheck action.
- **Check for updates** opens the GitHub releases page; there is no auto-update.

## Limits and non-features

- Windows x64 packaging is the supported release target for now. macOS/Linux
  builds require platform-specific packaging and signing.
- No playlists, channels, live streams, cookies, credentials, authenticated
  downloads, proxy configuration, DRM circumvention, paywall/geo bypass, or
  torrent search/indexing.
- Magnet links are parsed locally. Display names are sanitized and never used as
  filesystem paths; embedded trackers are scheme-filtered and then rejected by
  the helper if they resolve to private or local hosts.
- No telemetry; logs stay local with sensitive keys redacted.
- Builds are currently unsigned previews (see
  [the release process](release-process.md)).
