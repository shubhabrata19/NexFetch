---
name: desktop-quality-release
description: Verify NexFetch's desktop app behavior, download engine contracts, protocol adapters, security, accessibility, and packaging readiness.
compatibility: opencode
---

# NexFetch quality and release

## Before testing
Inspect scripts, test framework, architecture, supported OS targets, and existing conventions. Do not invent command names; use scripts that exist.

## YouTube MVP functional tests
- Valid/malformed YouTube URL, metadata loading, missing fields/thumbnail, and long title.
- Actual format list, no formats, unknown file size, and formats above 2160p excluded.
- Best-up-to-4K and manual format choice; audio-only only when available.
- Missing/outdated `yt-dlp`, missing FFmpeg, process failure, progress, cancellation, retry, and partial-file cleanup.

## Shared download foundation tests
- Engine registry selects the expected adapter and rejects unsupported sources.
- Fake engines can be registered without Electron or live network calls.
- Common queue supports multiple jobs, concurrency limits, persistence, cancellation, and retry.
- Generic jobs do not require video-specific metadata.
- Unsupported capabilities are not shown as functional UI actions.
- Engine errors are sanitized into stable user-facing messages.

## HTTP adapter tests (when implemented)
Range/resume support detection, redirects, unknown content length, server errors, filename collisions, cancellation, checksums when used, and safe path handling.

## BitTorrent adapter tests (when implemented)
Magnet and `.torrent` parsing, metadata resolution, malicious filenames, path containment, piece verification, disk-space errors, duplicate jobs, peer/stat reporting, explicit seeding policy, cancellation, and shutdown. Use fake engine bindings, not public swarms.

## Security review
- Electron context isolation enabled and Node integration disabled.
- Narrow preload API and main-side IPC validation.
- No shell interpolation for URLs, titles, paths, or format IDs.
- No arbitrary executable path or raw command flags from renderer.
- Safe output path containment and filename handling.
- Logs avoid secrets, cookies, and unnecessary full magnet URIs.
- No credential harvesting, DRM circumvention, access-control bypass, or piracy-oriented discovery features.

## Packaging and dependency delivery
- Verify platform-specific packaging and native dependency strategy.
- Detect and explain `yt-dlp`/FFmpeg availability for the MVP.
- For any bundled native engines/binaries, verify license notices, source, integrity, architecture, distribution size, and update process.
- Never silently download and execute an unverified binary.
- Verify first-run behavior when an engine dependency is unavailable.

## Reporting
Report commands executed and PASS/FAIL/NOT RUN results, tests added/updated, confirmed bugs and severity, untested areas, and release recommendation. Never mark skipped checks as passed.
