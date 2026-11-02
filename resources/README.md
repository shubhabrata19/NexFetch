# Bundled runtime dependencies

NexFetch will ship pinned, verified copies of `yt-dlp`, `ffmpeg`, and `ffprobe`
inside this directory for release builds.

Expected layout:

```text
resources/
  bin/
    win32-x64/
      yt-dlp.exe
      ffmpeg.exe
      ffprobe.exe
    darwin-arm64/
      yt-dlp
      ffmpeg
      ffprobe
    linux-x64/
      yt-dlp
      ffmpeg
      ffprobe
  licenses/
  binaries.manifest.json
```

The binaries are intentionally not committed yet. Phase 2 adds the pinned
versions, SHA-256 manifest, license notices, and packaging verification.

During development, the starter package can also find tools on `PATH` or via
`NXF_YTDLP_PATH`, `NXF_FFMPEG_PATH`, and `NXF_FFPROBE_PATH`.
