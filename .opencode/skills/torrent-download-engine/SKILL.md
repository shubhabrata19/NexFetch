---
name: torrent-download-engine
description: Maintain NexFetch's BitTorrent adapter for authorized `.torrent` and info-hash downloads, including verification and explicit seeding controls.
compatibility: opencode
---

# BitTorrent engine for NexFetch

Use this skill when maintaining or extending the implemented BitTorrent engine. Keep changes behind the shared engine contract and preserve the security boundaries around the libtorrent helper process.

## Supported user flow
- User selects a local `.torrent` file or supplies a v1/v2 info hash for DHT metadata lookup. Magnet links are intentionally rejected by the desktop app.
- App validates and resolves torrent metadata.
- User reviews the content/file list and selects a destination and files where supported.
- User starts the transfer and sees downloading/verification state and available peer/seed metrics.
- User sees completion and makes an explicit choice about whether to seed/share, subject to available engine capabilities.

## Engine choice
The current implementation uses a dedicated libtorrent 2.x helper process. Maintain it with attention to:
- Electron/Node integration quality and supported OS/CPU architectures.
- Native binary distribution, PyInstaller packaging, and code-signing strategy.
- License compatibility and redistribution obligations.
- Security history, maintenance cadence, and update process.
- Support for `.torrent` files, info-hash metadata, piece verification, cancellation, and seeding controls.

Keep the library behind a dedicated adapter implementing NexFetch's common engine contract.

## Security and correctness
- Treat `.torrent` metadata, info hashes, file names, paths, and tracker responses as untrusted.
- Prevent path traversal and reject unsafe output paths.
- Avoid logging full info hashes or sensitive identifiers unnecessarily.
- Verify pieces according to engine behavior and surface verification failures.
- Handle malformed metadata, disk-space errors, tracker/DHT errors, duplicate jobs/files, cancellation, and shutdown.
- Expose peer counts, seed counts, speeds, and ETA only when the engine supplies reliable measurements.
- Do not silently enable indefinite seeding; make seeding policy explicit, understandable, and adjustable.
- Do not add arbitrary tracker injection, executable selection, or unrestricted engine configuration to the renderer.

## State and capabilities
Map torrent lifecycle into the common queue while retaining torrent-specific details. Useful states may include resolving metadata, downloading, verifying, completed, seeding, paused (only if genuinely supported), failed, and cancelled. Do not force non-torrent jobs to expose torrent concepts.

## Legal and responsible use
BitTorrent is a transfer protocol; the content's rights remain the user's responsibility. Support only content the user is authorized to obtain and share. Do not implement piracy-oriented search, scraping, catalogues, recommendations, or preconfigured sources. Do not bypass DRM, access controls, or paywalls.

## Tests
Use fake engine bindings and test `.torrent` parsing, info-hash metadata lookup, malicious filenames, path containment, state mapping, verification failures, disk-space errors, cancellation, seeding preferences, duplicate jobs, and clean shutdown. Do not use public swarms as routine automated test fixtures.
