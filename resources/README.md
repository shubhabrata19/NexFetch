# Bundled runtime dependencies

NexFetch uses `yt-dlp`, `ffmpeg`, and `ffprobe` for the YouTube MVP.

## Layout

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

`resources/bin/*` is ignored by Git because the binaries are large. The
`.gitkeep` file keeps the parent directory available in clean checkouts.

## Development

On Windows:

```bash
npm run fetch:win-binaries
```

This downloads a development copy of yt-dlp and an LGPL FFmpeg build. It is a
convenience script, not a release supply-chain process.

During development, tools can also be found on `PATH` or via
`NXF_YTDLP_PATH`, `NXF_FFMPEG_PATH`, and `NXF_FFPROBE_PATH`.

## Packaging

`electron-builder.yml` copies `resources/bin` to `resources/bin` inside the
packaged application through `extraResources`. `DependencyService` resolves
`process.resourcesPath/bin/<platform>-<arch>/...` in packaged builds.

Before a public release:

- Pin exact binary versions.
- Add SHA-256 entries in `binaries.manifest.json` and verify them at startup.
- Include license notices and source offers.
- Sign nested executables on macOS and Windows.
- Review FFmpeg's build configuration and licensing.
- Do not fetch or execute unverified binaries at runtime.
