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

## Build checklist (Windows)

1. `npm ci`
2. `npm run check`
3. `npm run fetch:win-binaries`
4. `npm run build:torrent-helper` if the helper is missing
5. `npm run verify:binaries -- --require-installed`
6. `npx electron-builder --win nsis -c.directories.output=release/v<version>`
7. `npm run release:checksums -- release/v<version>`
8. Attach the installer, the `.blockmap` if produced, and `SHA256SUMS.txt` to a
   **pre-release** on GitHub.
9. Release notes must include the unsigned warning and checksum verification
   instructions.

The CI workflow validates the manifest and runs typecheck/lint/tests/build on
every push and pull request. The manifest script also refuses malformed hashes,
non-HTTPS download URLs, and unsafe archive member paths.

## Verify a download

Windows:

```powershell
certutil -hashfile "NexFetch Setup <version>.exe" SHA256
```

macOS/Linux (from the directory containing the release files):

```bash
sha256sum -c SHA256SUMS.txt
```

Compare the output with `SHA256SUMS.txt` from the same GitHub Release. If a hash
does not match, do not run the file. Windows SmartScreen will warn about unknown
publishers for unsigned builds; that is expected for previews, but a checksum
mismatch is not.

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

See `resources/licenses/THIRD-PARTY-NOTICES.md` for bundled component licensing.
