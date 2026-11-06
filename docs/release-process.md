# Release process

NexFetch currently publishes source code and, optionally, **unsigned preview
builds**. Code signing and notarization are not available yet, so binary builds
must be treated as development previews, not as trusted public releases.

## Policy

- Source code releases are always fine.
- A binary artifact may be published only as an **unsigned preview**, clearly
  labeled in the release title and notes.
- Never describe an unsigned artifact as a stable release, a verified publisher
  build, or "safe for everyone".
- Do not publish macOS binaries until Developer ID signing and notarization are
  available.
- Do not add auto-update until artifacts are signed; an unsigned updater is a
  remote-code-execution path.
- Never publish an artifact that fails manifest or checksum verification.
- Publish unsigned previews as **normal releases** (not GitHub pre-releases) so
  `releases/latest` and the version badge resolve. The title and notes carry the
  unsigned warning; the release is still not a stable/signed build.
- Never commit `release/` output or any bundled binary to Git.

## Prerequisites

- Windows build machine with Node.js 24+ and Git.
- Python 3.12 only if the torrent helper must be rebuilt.
- `npm ci` already completed.
- The release commit merged into the integration branch (`develop` or `main`)
  before tagging.
- A clean working tree (`git status` shows no changes).

## 1. Choose the version

```powershell
npm version 0.6.0 --no-git-tag-version
```

This updates `package.json` and `package-lock.json` without creating a tag. Keep
the version bump in its own commit.

## 2. Run the quality gate

```powershell
npm ci
npm run check
npm run verify:manifest
```

Expected: typecheck passes, lint passes, all tests pass, and the pinned-binary
manifest validates.

## 3. Prepare and verify bundled binaries

```powershell
npm run fetch:win-binaries
```

- Installs only the versions pinned in `resources/binaries.manifest.json`.
- Verifies the download archive and every extracted executable with SHA-256.
- Leaves already-correct files untouched and fails loudly on a mismatch.

If the torrent helper is missing:

```powershell
npm run build:torrent-helper
```

Then verify the installed set:

```powershell
npm run verify:binaries -- --require-installed
```

Expected output includes `yt-dlp: verified`, `ffmpeg: verified`,
`ffprobe: verified`, and `torrent-helper: locally built (not hash-pinned)`. The
helper is built locally because PyInstaller output is not reproducible enough
for a stable published hash; its Python dependencies are pinned in
`tools/torrent-helper/requirements.txt`.

## 4. Build the application and installer

```powershell
# Optional: remove a previous build of this version
Remove-Item -Recurse -Force release\v0.6.0 -ErrorAction SilentlyContinue

npm run build
npx electron-builder --win nsis -c.directories.output=release/v0.6.0
```

Expected files:

```text
release/v0.6.0/NexFetch Setup 0.6.0.exe
release/v0.6.0/NexFetch Setup 0.6.0.exe.blockmap   (may exist)
release/v0.6.0/win-unpacked/NexFetch.exe
```

`electron-builder` reports that signing is skipped — expected. Do not attach the
`win-unpacked` folder to the release.

## 5. Smoke test the packaged build

Run the unpacked application before publishing:

```powershell
.\release\v0.6.0\win-unpacked\NexFetch.exe
```

Check:

1. The app opens without a crash dialog.
2. Settings → Dependencies shows yt-dlp, FFmpeg, and ffprobe with versions and
   source **Bundled**.
3. The torrent engine shows ready if the helper was built.
4. One small, lawful test download completes end-to-end.
5. The log folder contains no `binary_integrity_mismatch`, startup, or migration
   errors.

Optional tamper check (proves startup enforcement works): modify one byte of
`win-unpacked\resources\bin\win32-x64\ffmpeg.exe`, relaunch, and confirm
Dependencies shows **Check failed**. Restore the original file afterward.

If possible, install the actual installer on a clean Windows VM and confirm the
installed app starts and dependencies verify. SmartScreen's unknown-publisher
warning is expected for unsigned builds.

## 6. Generate checksums

```powershell
npm run release:checksums -- release/v0.6.0
```

This writes `release/v0.6.0/SHA256SUMS.txt` for the top-level distributable
files. Verify one hash manually:

```powershell
Get-Content .\release\v0.6.0\SHA256SUMS.txt
certutil -hashfile ".\release\v0.6.0\NexFetch Setup 0.6.0.exe" SHA256
```

Never publish the installer without the checksum file.

## 7. Commit and tag

```powershell
git add package.json package-lock.json README.md
git commit -m "Release v0.6.0"
git tag -a v0.6.0 -m "NexFetch v0.6.0 (unsigned preview)"
git push origin develop
git push origin v0.6.0
```

Tags are annotated because signing is not available. Pushing the tag starts
`.github/workflows/release.yml`, which checks out the tag, verifies the pinned
binaries, builds the app and torrent helper, writes `SHA256SUMS.txt`, and creates
the GitHub release. Confirm CI and CodeQL are green for the release commit.

## 8. Publish the GitHub release

The tag workflow publishes automatically:

- Title: `v0.6.0 (unsigned preview)`
- Assets: `NexFetch Setup 0.6.0.exe`, its `.blockmap`, and `SHA256SUMS.txt`
- Marked **Latest** (not a pre-release) so `releases/latest` and the README
  download button resolve
- Unsigned warning included in the notes

If you must publish manually, use the repository's **Releases** page with the same
title and assets. Do not mark it as a pre-release. Use the suggested notes:

```markdown
## Unsigned preview build

This build is not code-signed. Windows SmartScreen will show an unknown-publisher
warning. Do not treat it as a stable release; use it for testing only.

Verify your download before running:

    certutil -hashfile "NexFetch Setup 0.6.0.exe" SHA256

Compare the result with SHA256SUMS.txt attached to this release. A checksum
mismatch means the file is not the published build — do not run it.

See docs/release-process.md for the full policy.
```

Optional CLI equivalent (drop the `.blockmap` argument if that file was not produced):

```powershell
gh release create v0.6.0 `
  "release/v0.6.0/NexFetch Setup 0.6.0.exe" `
  "release/v0.6.0/NexFetch Setup 0.6.0.exe.blockmap" `
  "release/v0.6.0/SHA256SUMS.txt" `
  --title "v0.6.0 (unsigned preview)" `
  --notes-file release-notes.md `
  --latest
```

## 9. Post-release checks

- Download the attached installer once from GitHub and re-verify its SHA-256
  against the attached checksum file (catches upload corruption).
- Confirm the release is marked **Latest** and the README download button resolves.
- Confirm the CI and CodeQL runs for the release commit are green.
- Watch Dependabot and security advisories. Publish a new patch preview for
  fixes; never replace an existing artifact silently.
- Keep the unsigned-preview policy in place until signing exists.

## What not to do yet

- Do not label any build "stable" or "verified publisher".
- Do not distribute the `.exe` outside GitHub without the checksum file and the
  unsigned warning.
- Do not publish macOS builds; they require Developer ID signing and
  notarization.
- Do not enable auto-update; unsigned updates are a code-execution risk.

## Gate before a stable binary release

All of the following must be complete before promoting a build beyond preview:

- Windows Authenticode signing with timestamping (OV/EV or Azure Trusted
  Signing).
- macOS Developer ID signing, hardened runtime, notarization, and stapling if
  macOS is distributed.
- A tag-driven release workflow that verifies pinned inputs and signs artifacts
  with isolated secrets.
- Full third-party license texts and the LGPL source offer inside the shipped
  application.
- Published checksums and (once signing exists) signature verification
  instructions.

See `resources/licenses/THIRD-PARTY-NOTICES.md` for bundled component licensing
and `SECURITY.md` for maintainer repository settings.
