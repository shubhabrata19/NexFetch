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

## Integrity

`binaries.manifest.json` is the source of truth for pinned runtime binaries. It
records the exact version, download URL, archive member path, and SHA-256 hash
for each supported platform. It is tracked in Git and copied into packaged builds
through `extraResources`.

Verification happens twice:

1. `scripts/fetch-win-binaries.ps1` downloads only HTTPS URLs from the manifest
   and verifies the archive and every extracted executable before installing it.
2. `DependencyService` hashes bundled pinned binaries at startup and refuses to
   run one whose SHA-256 does not match the manifest.

Check the manifest and any installed binaries before packaging:

```bash
npm run verify:manifest
npm run verify:binaries -- --require-installed
```

The torrent helper is built locally with PyInstaller. Its build is not
reproducible enough for a stable published hash, so its manifest entry has
`"sha256": null`: presence is checked, but it is not hash-pinned. Its Python
dependencies are pinned exactly in `tools/torrent-helper/requirements.txt`.

## Development

On Windows:

```bash
npm run fetch:win-binaries
```

This installs the exact versions recorded in the manifest and fails loudly on a
checksum mismatch. It is not a floating "latest" download.

During development, tools can also be found on `PATH` or via
`NXF_YTDLP_PATH`, `NXF_FFMPEG_PATH`, and `NXF_FFPROBE_PATH`. Build the Windows
torrent helper with:

```bash
npm run build:torrent-helper
```

## Packaging

`electron-builder.yml` copies `resources/bin` to `resources/bin` inside the
packaged application through `extraResources`, and copies
`resources/binaries.manifest.json` to the application resources root.
`DependencyService` resolves `process.resourcesPath/bin/<platform>-<arch>/...`
in packaged builds and verifies pinned binaries against the packaged manifest.

Before distributing public release artifacts:

- Include license notices and source offers for bundled LGPL components.
- Sign nested executables on macOS and Windows.
- Review FFmpeg's build configuration and licensing for each release.
- Do not fetch or execute unverified binaries at runtime.
