# NexFetch torrent helper

A deliberately narrow JSON-lines process around libtorrent 2.x. The Electron
main process owns the queue, files, persistence, and UI; this helper only speaks
BitTorrent.

## Build (Windows x64)

```powershell
npm run build:torrent-helper
```

The executable is written to:

```text
resources/bin/win32-x64/nexfetch-torrent-helper.exe
```

The build uses Python 3.12 because the upstream libtorrent wheel is available for
that ABI. `requirements.txt` pins libtorrent and PyInstaller.

## Development

The desktop app runs the source helper from the local virtual environment when
the packaged executable is missing:

```text
.venv-torrent-helper/Scripts/python.exe tools/torrent-helper/nexfetch_torrent_helper.py
```

Set `NXF_TORRENT_HELPER_PATH` to override the helper executable in development.

## Protocol

Each request is one JSON object per line on stdin:

```json
{ "id": "1", "method": "ping", "params": {} }
```

Responses use the same `id`:

```json
{"id":"1","ok":true,"data":{"pong":true}}
{"id":"1","ok":false,"error":{"code":"TORRENT_INVALID","message":"..."}}
```

Asynchronous events are separate lines:

```json
{ "event": "torrent.update", "data": { "infoHash": "...", "state": "downloading" } }
```

## Per-torrent limits

`torrent.add` and `torrent.set_limits` accept:

- `downloadLimitBytesPerSecond` — zero means unlimited.
- `uploadLimitBytesPerSecond` — zero means unlimited.
- `maxConnections` — maximum connected peers. Zero or null uses the active
  connection profile's per-torrent default (Balanced 50, High 100, Maximum 200).

The helper applies the peer cap with libtorrent's `max_connections` and updates
it live through `torrent.set_limits`. Peer client names are decoded and stripped
of control characters before being sent to the UI.

## Metadata resolution

`torrent.resolve_start` accepts an info hash and a metadata path. The helper adds
an info-hash-only torrent with libtorrent's `default_dont_download` flag, so it
can request metadata from DHT peers without allocating or downloading payload
files. The only file written is the sanitized `.torrent` metadata at the
requested path.

The lookup emits:

- `resolve.progress` roughly once per second with `dhtNodes`, `peers`,
  `elapsedMs`, and a user-facing message.
- `resolve.ready` with the preview and `metadataPath`.
- `resolve.error` on timeout or lookup failure.
- `resolve.cancelled` after `torrent.resolve_cancel`.

The Electron main process owns the corresponding job, progress UI, timeout,
concurrency cap, and transition to Setup. Lookups are not downloads and do not
consume download queue slots.

The helper exposes `session.*`, `torrent.*`, and `resolve.*` methods. It has no
HTTP API, no web UI, and no remote access. It is intended to be spawned by the
Electron main process only.

## Input scope

The helper does not parse magnet URIs. The desktop app parses magnet links
locally and passes either a local `.torrent` file, a v1/v2 info hash, or the
magnet's info hash plus its scheme-filtered trackers for metadata lookup.
Trackers are validated again inside the helper: private/local hosts and
unsupported schemes are rejected before any announce.
