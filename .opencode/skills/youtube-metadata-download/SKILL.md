---
name: youtube-metadata-download
description: Maintain NexFetch's YouTube adapter for metadata, actual format discovery, quality selection up to 2160p, and download jobs.
compatibility: opencode
---

# YouTube metadata and download pipeline

This skill covers the YouTube adapter. Keep the implementation behind the shared download-engine contract so the HTTP and BitTorrent engines stay independent of YouTube-specific assumptions.

## Intended flow
1. User pastes a YouTube URL.
2. Validate and normalize the supported URL form.
3. Fetch metadata without downloading media.
4. Map title, uploader/channel, duration, thumbnail, upload date when available, webpage URL, and actual available formats.
5. Show every eligible format up to 2160p; do not fabricate formats.
6. Let the user choose “Best available up to 4K,” a specific format, or audio-only if reported as available.
7. Create a generic NexFetch download job and stream structured progress.
8. Report completion/failure/cancellation and provide open-folder/retry actions.

## Extractor boundary
Wrap `yt-dlp` behind an adapter/service. Keep raw JSON/stdout/stderr out of the renderer. Normalize extractor output into stable app-owned types and validate all unknown/missing fields defensively.

Suggested video fields: ID, title, uploader/channel, duration seconds, thumbnail URL, upload date, canonical webpage URL.

Suggested format fields: format ID, resolution/height, width, FPS, extension, video codec, audio codec, audio/video presence, approximate file size when known, and bitrate when available.

## Quality rules
- 2160p is the maximum eligible resolution tier.
- Preserve all valid actual formats at or below the cap.
- Do not infer availability from common quality labels.
- For adaptive formats, select compatible audio and merge when required.
- Explain when FFmpeg is needed and show unknown file size honestly.
- Best-up-to-4K means the best eligible video stream at or below 2160p plus compatible best audio when separate streams are required.
- Make the actual selected formats visible before starting.

## Process safety and reliability
- Pass arguments as an array with shell interpretation disabled.
- Validate scheme and host; do not accept arbitrary local paths/non-YouTube URLs in this adapter.
- Sanitize filenames, prevent path traversal, and handle reserved characters/trailing dots/spaces/length limits.
- Avoid overwriting existing files silently.
- Implement timeouts, cancellation, nonzero-exit handling, progress parsing, and partial-output cleanup.
- Detect missing/outdated `yt-dlp` and missing FFmpeg.
- Do not collect or persist account credentials/cookies; do not expose private process output.

## Responsible use
Support only content the user owns, has permission to download, or is otherwise permitted to download under applicable law and platform terms. Do not bypass DRM, private-video restrictions, paywalls, membership restrictions, or authentication/access controls.

## Tests
Use fake extractor outputs and mocked processes. Cover malformed URLs, missing metadata, duplicate/unknown format fields, formats above 2160p, separate streams, unknown size, missing dependencies, cancellation, process failure, and safe filenames. Generic queue tests must run without live YouTube calls.
