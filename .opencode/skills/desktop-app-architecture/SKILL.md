---
name: desktop-app-architecture
description: Establish a secure, maintainable Electron desktop foundation for NexFetch, including typed IPC, background jobs, persistence, and packaging.
compatibility: opencode
---

# NexFetch desktop architecture

Use this skill when starting or refactoring the desktop shell.

## Default stack
Prefer Electron + React + TypeScript + Vite unless the repository already has a suitable stack. Keep main, preload, renderer, domain, and infrastructure boundaries explicit.

## Process responsibilities
- **Main:** window lifecycle, IPC validation, dialogs, preferences/history persistence, download orchestration, and child-process/native-engine lifecycle.
- **Preload:** narrow typed bridge exposing only explicit application capabilities.
- **Renderer:** UI and presentation state; no direct Node APIs, shell access, or downloader process creation.
- **Domain:** download jobs, sources, engine contracts, capabilities, queue policy, and state transitions.
- **Adapters:** `yt-dlp` for YouTube, HTTP/HTTPS, and libtorrent for BitTorrent. Keep adapters replaceable and independently testable.

## Electron security baseline
- Use `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true` where compatible with the chosen Electron version.
- Expose a small allowlisted API through `contextBridge`.
- Validate all IPC payloads in the main process.
- Never concatenate user-controlled values into shell commands. Use argument arrays and disable shell interpretation.
- Keep output paths inside a user-selected destination and defend against path traversal.
- Do not expose arbitrary filesystem, shell, process, executable path, or environment APIs to renderer code.
- Do not persist account credentials/cookies by default.

## Domain foundation
Define protocol-neutral domain types before adding multiple engines:
- `DownloadSource`: normalized URL or selected local source file plus classified source type.
- `DownloadEngine`: adapter contract with identity, capabilities, source matching, resolution/metadata, start, cancel, and optional supported lifecycle operations.
- `EngineCapabilities`: explicit booleans/options for metadata, format selection, pause/resume, cancellation, checksum, seeding, speed/ETA, and engine-specific details.
- `DownloadJob`: stable ID, source, engine ID, destination, common status/progress/timestamps, and typed engine metadata.
- `EngineRegistry`: registers adapters and resolves the correct adapter without renderer-side routing.
- `DownloadQueue`: persistence, concurrency policy, retry, cancellation, and job-state coordination.
- `DownloadEvent`: typed progress and lifecycle messages.

Avoid making every engine implement every method. Optional behavior must be expressed as capabilities or optional adapter operations and reflected in the UI.

## Job lifecycle
A common lifecycle may include `queued → resolving → downloading → verifying → completed`, with `failed` and `cancelled` terminal paths. Engines may expose additional sub-states, such as torrent `seeding`, through typed engine-specific status. Do not force every source type into irrelevant states.

## Implementation status
1. Secure desktop shell and typed IPC are implemented.
2. Protocol-neutral job/engine contracts and fake adapter tests are implemented.
3. YouTube adapter and 4K user flow are implemented.
4. Generic HTTP/HTTPS engine is implemented.
5. BitTorrent engine with a libtorrent helper is implemented.
6. Additional adapters only when there is a concrete, lawful use case.

Do not build a public third-party plugin marketplace in the early releases. An internal registry and adapter interface provide sufficient extensibility.

## Quality
- Keep domain logic framework-independent where practical.
- Use runtime validation for IPC and extractor data.
- Keep user-facing errors actionable and detailed diagnostics local/sanitized.
- Test state transitions, adapter selection, cancellation, and failure cleanup.
- Document packaging and native dependencies per supported OS.
