# Security Policy

## Supported versions

NexFetch is a desktop application. Security fixes are issued for the latest
released minor version.

| Version | Supported |
| ------- | --------- |
| 0.5.x   | Yes       |
| < 0.5   | No        |

## Reporting a vulnerability

Please report vulnerabilities privately through **GitHub's private vulnerability
reporting**: open the repository's **Security** tab and choose **Report a
vulnerability**. Do not open a public issue for a suspected vulnerability.

Include as much of the following as you can:

- Affected version and platform (Windows/macOS/Linux, architecture).
- A description of the issue and the security impact.
- Reproduction steps or a proof of concept.
- Any relevant logs with personal paths and URLs removed.

You can expect an initial acknowledgement on a best-effort basis, usually within
five business days. This is a personal open-source project, so no formal service
level agreement is offered. Please give reasonable time for a fix before public
disclosure; coordinated disclosure is appreciated.

## Scope

In scope:

- The Electron main process, preload bridge, renderer, and IPC surface.
- The HTTP, YouTube, and BitTorrent engine adapters.
- The bundled torrent helper (`tools/torrent-helper`).
- Build, packaging, and binary-verification scripts in this repository.
- Vulnerabilities in how NexFetch handles untrusted input such as URLs,
  `Content-Disposition` filenames, torrent metadata, and clipboard contents.

Out of scope:

- Vulnerabilities in third-party projects (yt-dlp, FFmpeg, libtorrent,
  Electron). Report those upstream; we will update pinned versions when fixes
  are available.
- Issues that require physical access, a compromised operating system, local
  administrator privileges, or the ability to modify the user's own profile and
  database files.
- Social engineering, spam, or denial-of-service against third-party services.
- Copyright or terms-of-service complaints. See "Responsible use" in the
  README.

## Threat model

NexFetch is a local-only desktop application:

- No accounts, telemetry, analytics, or cloud backend.
- The renderer runs sandboxed with context isolation and no Node.js access.
- The main process treats renderer messages, remote URLs, HTTP headers,
  BitTorrent metadata, and magnet URIs as untrusted input.
- Pinned media tools (yt-dlp, FFmpeg, ffprobe) are SHA-256 verified against
  `resources/binaries.manifest.json`; a modified binary is refused. The locally
  built torrent helper is presence-checked but not hash-pinned because its
  PyInstaller build is not reproducible enough for a stable hash.
- Downloads are confined to a user-selected destination and output paths are
  re-validated before use.
- Child processes are spawned without a shell and with a restricted environment.

## Safe harbor

Good-faith security research that follows this policy is welcome. We will not
pursue legal action for accidental, good-faith violations of this policy,
provided you do not access data that is not yours, do not degrade other users'
experience, and report findings privately.

## Maintainer repository settings

These GitHub settings complement the workflows in this repository and should
stay enabled:

- Private vulnerability reporting (Security tab).
- Secret scanning and push protection.
- Dependabot alerts and security updates, plus the scheduled update configs in
  `.github/dependabot.yml`.
- CodeQL analysis from `.github/workflows/codeql.yml` and the CI checks from
  `.github/workflows/ci.yml`.
- Branch protection on `main`: required CI and CodeQL checks, at least one
  review, no force pushes.
- The unsigned-preview policy in `docs/release-process.md`; unsigned builds are
  published as normal releases titled "unsigned preview" with the warning in the
  notes, until code signing and notarization are available.
- GitHub Actions are pinned by commit SHA. Update them through reviewed
  Dependabot pull requests, not floating tags.
