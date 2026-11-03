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

The helper exposes `session.*`, `torrent.*`, and `resolve.*` methods. It has no
HTTP API, no web UI, and no remote access. It is intended to be spawned by the
Electron main process only.
