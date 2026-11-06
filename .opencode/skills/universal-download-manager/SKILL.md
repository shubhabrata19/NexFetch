---
name: universal-download-manager
description: Design NexFetch as a modular download manager with shared jobs and queues plus independent HTTP, video-platform, and BitTorrent engine adapters.
compatibility: opencode
---

# Universal download manager architecture

NexFetch is a desktop application for multiple lawful download types. YouTube (up to 4K), direct HTTP/HTTPS, and BitTorrent are implemented behind shared jobs, queues, and engine adapters. Keep the architecture extensible, but add new protocols only when explicitly requested.

## Source types and engines
Plan for independent adapters:
- **HTTP/HTTPS:** direct file downloads, redirects, server capability detection, Range-based resume where supported, content length when known, and optional checksum verification.
- **Video platforms:** extractor-backed metadata/format discovery and downloads; begin with YouTube using `yt-dlp` and FFmpeg where needed.
- **BitTorrent:** user-supplied `.torrent` files and v1/v2 info hashes, metadata-only DHT lookup, piece verification, peer/seed stats, cancellation, and explicit user-controlled seeding. Magnet links are intentionally not accepted.
- **Future protocols:** add only through a well-defined adapter contract.

Do not conflate a URL scheme with permission to download its content. Validate supported sources and surface unsupported/blocked cases clearly.

## Core adapter contract
Create a typed `DownloadEngine` contract conceptually covering:
- `id` and `displayName`.
- `capabilities` describing what the engine can actually do.
- Source matching/classification.
- Optional metadata or format resolution.
- Job start and cancellation.
- Optional pause/resume, verification, or engine-specific detail operations only when truly supported.
- Typed lifecycle/progress events.

The engine registry selects an adapter. The shared queue owns scheduling and job identity. The adapter owns protocol-specific transfer behavior. The UI consumes normalized job data and engine capabilities, not raw library/process output.

## Common job model
Keep common fields such as job ID, source display label, engine ID, destination, filename, status, progress, bytes transferred/total when known, speed/ETA when available, created/updated times, and sanitized error. Keep video format IDs, HTTP response details, torrent info hashes, peer counts, and seeding statistics in engine-specific metadata.

Represent unknown values honestly. Do not fabricate progress percentages, file sizes, ETA, or support for pause/resume.

## Queue and persistence
- Multiple jobs with configurable concurrency.
- Stable state transitions and restart behavior defined deliberately.
- Retry only when safe; avoid duplicate output or duplicate torrent jobs.
- Per-job cancellation and clear partial-file policy.
- History filters/categories that work across source types.
- Global and per-engine concurrency limits where useful.
- Destination and filename-conflict policy shared where possible.

Do not promise that all engines support resuming, pausing, checksums, or the same concurrency behavior.

## UX evolution
The unified queue with All / Files / Videos / Torrents filters is implemented. Show engine-specific details only on the relevant job and never add disabled future-engine tiles merely to imply a feature exists.

## Implemented engine set
1. **YouTube:** metadata, actual formats up to 2160p, best-up-to-4K selection, audio-only if available, queue, progress, cancellation, errors.
2. **HTTP/HTTPS:** direct URL downloads, redirects, resume when the server supports it, safe filenames, size/progress, optional checksums.
3. **BitTorrent:** `.torrent` files and v1/v2 info hashes, metadata lookup, verification, peer/seed status, explicit seeding controls, safe shutdown, and packaging.
4. **Additional sources:** only when there is a concrete user need and a maintained, legally appropriate integration.

## Compliance boundaries
- Support files/content the user owns, is authorized to download, or may otherwise lawfully obtain.
- Do not bypass DRM, paywalls, membership restrictions, private-video restrictions, or other access controls.
- Do not implement piracy search/indexing/catalogues or bundle curated infringing sources.
- Do not silently seed/share downloaded files. Seeding must be explicit and controllable.
- Keep credentials and full info hashes/magnet information out of logs and telemetry.

## Testing strategy
Use fake engines for registry, queue, concurrency, persistence, cancellation, retry, and state mapping. Keep protocol adapter tests isolated and offline. Test unsupported capabilities and malformed/malicious source data.
