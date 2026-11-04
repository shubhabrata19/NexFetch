# Bundled runtime dependencies

NexFetch uses `yt-dlp`, `ffmpeg`, and `ffprobe` for media downloads, plus the
bundled `nexfetch-torrent-helper` for BitTorrent and info-hash metadata lookups.

## Layout

```text
resources/
  assets/
    nexfetch_icon.png
    NexFetch Universal Download Manager Logo.png
  bin/
    win32-x64/
      yt-dlp.exe
      ffmpeg.exe
      ffprobe.exe
      nexfetch-torrent-helper.exe
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

## Brand assets

`assets/nexfetch_icon.png` is the master application icon. The renderer uses a
generated 256px copy for the sidebar and boot screen. Generate the platform icon
set from the master image with:

```bash
npm run icons
```

`electron-builder.yml` copies `assets/nexfetch_icon.png` into the packaged
application's `resources/assets` directory. The generated Windows, macOS, and
Linux icon files live under `build/`.

## Development

On Windows:

```bash
npm run fetch:win-binaries
```

This downloads a development copy of yt-dlp and an LGPL FFmpeg build. It is a
convenience script, not a release supply-chain process.

During development, tools can also be found on `PATH` or via
`NXF_YTDLP_PATH`, `NXF_FFMPEG_PATH`, and `NXF_FFPROBE_PATH`. Build the Windows
torrent helper with:

```bash
npm run build:torrent-helper
```

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
