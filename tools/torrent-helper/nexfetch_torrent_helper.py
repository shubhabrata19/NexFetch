#!/usr/bin/env python3
"""NexFetch BitTorrent helper.

A deliberately small JSON-lines process around libtorrent. Electron owns the
queue, persistence, and user interface; this process only speaks BitTorrent.

Protocol
--------
Requests (stdin, one JSON object per line):
    {"id": "...", "method": "torrent.inspect", "params": {...}}

Responses (stdout, one JSON object per line):
    {"id": "...", "ok": true, "data": {...}}
    {"id": "...", "ok": false, "error": {"code": "...", "message": "..."}}

Events (stdout):
    {"event": "torrent.update", "data": {...}}
"""

from __future__ import annotations

import base64
import binascii
import ipaddress
import json
import os
import re
import shutil
import socket
import sys
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

try:
    import libtorrent as lt
except Exception as exc:  # pragma: no cover - surfaced to the desktop app
    sys.stderr.write(f"libtorrent import failed: {exc}\n")
    sys.exit(1)


MAX_TORRENT_BYTES = 10 * 1024 * 1024
MAX_FILES = 20_000
MAX_PEERS_REPORTED = 120
UPDATE_INTERVAL_SECONDS = 0.75
RESOLVE_TIMEOUT_SECONDS = 180
EXECUTABLE_EXTENSIONS = {
    ".exe",
    ".msi",
    ".bat",
    ".cmd",
    ".com",
    ".scr",
    ".pif",
    ".cpl",
    ".jar",
    ".ps1",
    ".vbs",
    ".js",
}
WINDOWS_RESERVED_NAMES = {
    "con",
    "prn",
    "aux",
    "nul",
    *(f"com{i}" for i in range(1, 10)),
    *(f"lpt{i}" for i in range(1, 10)),
}
PRIVATE_NETWORKS = [
    ipaddress.ip_network("0.0.0.0/8"),
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("100.64.0.0/10"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.0.0.0/24"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("224.0.0.0/4"),
    ipaddress.ip_network("240.0.0.0/4"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("fe80::/10"),
    ipaddress.ip_network("ff00::/8"),
]

CONNECTION_PROFILES = {
    "balanced": {"connections": 200, "per_torrent": 50, "speed": 20},
    "high": {"connections": 500, "per_torrent": 100, "speed": 40},
    "maximum": {"connections": 1000, "per_torrent": 200, "speed": 80},
}


class HelperError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


_write_lock = threading.Lock()


def emit(payload: Dict[str, Any]) -> None:
    line = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    with _write_lock:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()


def emit_event(name: str, data: Dict[str, Any]) -> None:
    emit({"event": name, "data": data})


def error_response(request_id: Any, code: str, message: str) -> None:
    emit({"id": request_id, "ok": False, "error": {"code": code, "message": message}})


def ok_response(request_id: Any, data: Any) -> None:
    emit({"id": request_id, "ok": True, "data": data})


def as_int(value: Any, default: Optional[int] = None) -> Optional[int]:
    if isinstance(value, bool):
        return default
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return default


def as_bool(value: Any, default: bool = False) -> bool:
    return value if isinstance(value, bool) else default


def clean_text(value: Optional[str], limit: int = 300) -> Optional[str]:
    if not isinstance(value, str):
        return None
    text = value.strip().replace("\x00", "")
    return text[:limit] if text else None


def is_private_address(value: str) -> bool:
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        return False
    return any(address in network for network in PRIVATE_NETWORKS)


def validate_remote_host(hostname: str) -> bool:
    host = hostname.strip().strip("[]").lower()
    if not host:
        return False
    if host in {"localhost", "localhost.localdomain"} or host.endswith(".local"):
        return False
    if is_private_address(host):
        return False
    try:
        addresses = {
            entry[4][0]
            for entry in socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
        }
    except OSError:
        # A dead tracker is not a security problem; the tracker simply fails.
        return True
    if not addresses:
        return True
    return not any(is_private_address(address) for address in addresses)


def validate_tracker_url(value: str) -> Tuple[bool, Optional[str]]:
    try:
        parsed = urlparse(value)
    except ValueError:
        return False, "invalid tracker URL"
    if parsed.scheme not in {"http", "https", "udp"}:
        return False, "unsupported tracker scheme"
    if not parsed.hostname:
        return False, "tracker URL has no host"
    if not validate_remote_host(parsed.hostname):
        return False, "tracker points at a private or local host"
    return True, None


def safe_path(path: str) -> bool:
    if not path or "\x00" in path:
        return False
    normalized = path.replace("\\", "/")
    if normalized.startswith("/") or re.match(r"^[a-zA-Z]:", normalized):
        return False
    if len(normalized) > 1024:
        return False
    for segment in normalized.split("/"):
        if segment in {"", ".", ".."}:
            return False
        if len(segment) > 255:
            return False
        if any(character in segment for character in '<>:"|?*'):
            return False
        if any(ord(character) < 32 for character in segment):
            return False
        if segment.rstrip(" .") != segment:
            return False
        if segment.lower() in WINDOWS_RESERVED_NAMES:
            return False
        if segment.lower().split(".")[0] in WINDOWS_RESERVED_NAMES:
            return False
    return True


def safe_metadata_path(path: str) -> str:
    target = Path(path).resolve()
    parent = target.parent
    parent.mkdir(parents=True, exist_ok=True)
    return str(target)


def torrent_hash_info(ti: Any) -> Tuple[str, int]:
    hashes = ti.info_hashes()
    if hashes.has_v1():
        return hashes.v1.to_string().hex(), 1
    if hashes.has_v2():
        return hashes.v2.to_string().hex(), 2
    raise HelperError("TORRENT_INVALID", "The torrent has no usable info hash.")


def safe_torrent_info(path: str) -> Any:
    try:
        size = os.path.getsize(path)
    except OSError:
        raise HelperError("TORRENT_INVALID", "The torrent file could not be read.")
    if size <= 0 or size > MAX_TORRENT_BYTES:
        raise HelperError("TORRENT_INVALID", "The torrent file is empty or too large.")
    try:
        ti = lt.torrent_info(path)
    except Exception:
        raise HelperError("TORRENT_INVALID", "This file is not a valid .torrent file.")
    if not ti.is_valid():
        raise HelperError("TORRENT_INVALID", "This file is not a valid .torrent file.")
    if ti.num_files() <= 0:
        raise HelperError("TORRENT_INVALID", "The torrent contains no files.")
    if ti.num_files() > MAX_FILES:
        raise HelperError("TORRENT_UNSAFE", "The torrent contains too many files.")
    for entry in ti.files():
        if not safe_path(entry.path):
            raise HelperError("TORRENT_UNSAFE", f"Unsafe file path in torrent: {entry.path}")
    return ti


def file_entries(ti: Any, selected_indices: Optional[set[int]] = None) -> List[Dict[str, Any]]:
    entries: List[Dict[str, Any]] = []
    selected = selected_indices
    for index, entry in enumerate(ti.files()):
        normalized = entry.path.replace("\\", "/")
        name = normalized.rsplit("/", 1)[-1]
        extension = os.path.splitext(name)[1].lower()
        entries.append(
            {
                "index": index,
                "path": normalized,
                "name": name,
                "sizeBytes": int(entry.size),
                "selected": selected is None or index in selected,
                "executable": extension in EXECUTABLE_EXTENSIONS,
                "downloadedBytes": None,
            }
        )
    return entries


def tracker_entries(ti: Any) -> List[Dict[str, Any]]:
    trackers: List[Dict[str, Any]] = []
    for tracker in ti.trackers():
        url = getattr(tracker, "url", "")
        tier = int(getattr(tracker, "tier", 0) or 0)
        trackers.append(
            {
                "url": url,
                "tier": tier,
                "status": "unknown",
                "message": None,
                "seeds": None,
                "peers": None,
                "nextAnnounceSeconds": None,
            }
        )
    return trackers


def preview_from_ti(ti: Any, source_kind: str) -> Dict[str, Any]:
    info_hash, version = torrent_hash_info(ti)
    trackers = []
    for tracker in tracker_entries(ti):
        valid, reason = validate_tracker_url(tracker["url"])
        if valid:
            trackers.append(tracker)
            continue
        # Unsupported schemes (for example wss://) are ignored. A tracker that
        # points at a local/private target is rejected outright.
        if reason == "tracker points at a private or local host":
            raise HelperError(
                "TORRENT_UNSAFE",
                "Refusing a torrent with a tracker on a private or local host.",
            )
    creation_date = int(ti.creation_date() or 0)
    web_seeds = list(ti.web_seeds()) if hasattr(ti, "web_seeds") else []
    return {
        "title": clean_text(ti.name(), 300) or "Untitled torrent",
        "totalBytes": int(ti.total_size()),
        "files": file_entries(ti),
        "fileCount": int(ti.num_files()),
        "infoHash": info_hash,
        "hashVersion": version,
        "isPrivate": bool(ti.priv()),
        "trackers": trackers,
        "sourceKind": source_kind,
        "createdAt": (
            time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(creation_date))
            if creation_date > 0
            else None
        ),
        "createdBy": clean_text(ti.creator(), 160),
        "comment": clean_text(ti.comment(), 500),
        "webSeedCount": len(web_seeds),
    }


def state_name(state: Any) -> str:
    mapping = {
        int(lt.torrent_status.states.queued_for_checking): "queued",
        int(lt.torrent_status.states.checking_files): "checking",
        int(lt.torrent_status.states.downloading_metadata): "resolving",
        int(lt.torrent_status.states.downloading): "downloading",
        int(lt.torrent_status.states.finished): "completed",
        int(lt.torrent_status.states.seeding): "seeding",
        int(lt.torrent_status.states.allocating): "allocating",
        int(lt.torrent_status.states.checking_resume_data): "checking",
    }
    return mapping.get(int(state), "unknown")


def peer_entries(handle: Any) -> List[Dict[str, Any]]:
    peers: List[Dict[str, Any]] = []
    try:
        for peer in handle.get_peer_info()[:MAX_PEERS_REPORTED]:
            ip_value = getattr(peer, "ip", "")
            if isinstance(ip_value, tuple):
                address = str(ip_value[0]) if ip_value else "unknown"
            else:
                address = str(ip_value)
            flags = []
            for name in ("seed", "upload_only", "utp_socket", "rc4_encrypted", "plaintext_encrypted"):
                if getattr(peer, name, False):
                    flags.append(name)
            peers.append(
                {
                    "address": address,
                    "client": clean_text(str(getattr(peer, "client", "")), 80) or "Unknown",
                    "progress": float(getattr(peer, "progress", 0.0) or 0.0),
                    "downloadRateBytesPerSecond": int(getattr(peer, "down_speed", 0) or 0),
                    "uploadRateBytesPerSecond": int(getattr(peer, "up_speed", 0) or 0),
                    "seed": bool(getattr(peer, "seed", False)),
                    "flags": ", ".join(flags),
                }
            )
    except Exception:
        pass
    return peers


def tracker_status(handle: Any) -> List[Dict[str, Any]]:
    trackers: List[Dict[str, Any]] = []
    try:
        for tracker in handle.trackers():
            url = str(getattr(tracker, "url", ""))
            if not url:
                continue
            message = clean_text(str(getattr(tracker, "message", "")), 200)
            fails = int(getattr(tracker, "fails", 0) or 0)
            working = bool(getattr(tracker, "is_working", False))
            trackers.append(
                {
                    "url": url,
                    "tier": int(getattr(tracker, "tier", 0) or 0),
                    "status": "working" if working else ("error" if fails > 0 or message else "unknown"),
                    "message": message,
                    "seeds": (
                        int(tracker.scrape_complete)
                        if int(getattr(tracker, "scrape_complete", -1) or -1) >= 0
                        else None
                    ),
                    "peers": (
                        int(tracker.scrape_incomplete)
                        if int(getattr(tracker, "scrape_incomplete", -1) or -1) >= 0
                        else None
                    ),
                    "nextAnnounceSeconds": max(
                        0, int(getattr(tracker, "next_announce_in", 0) or 0)
                    ),
                }
            )
    except Exception:
        pass
    return trackers


class TorrentRuntime:
    def __init__(self, handle: Any, metadata_path: str, title: str, options: Dict[str, Any]) -> None:
        self.handle = handle
        self.metadata_path = metadata_path
        self.title = title
        self.options = options
        self.started_at = time.time()
        self.completed_at: Optional[float] = None
        self.completed_emitted = False
        self.seeding = False
        self.stopped = False
        self.last_state = ""
        self.download_limit = as_int(options.get("downloadLimitBytesPerSecond"), 0) or 0
        self.upload_limit = as_int(options.get("uploadLimitBytesPerSecond"), 0) or 0
        self.seed_after_complete = as_bool(options.get("seedAfterComplete"), False)
        self.selected: set[int] = set(as_int_list(options.get("fileIndices")))
        self.trackers: List[Dict[str, Any]] = []


def as_int_list(value: Any) -> List[int]:
    if not isinstance(value, list):
        return []
    result: List[int] = []
    for item in value:
        number = as_int(item)
        if number is not None and 0 <= number <= 50_000:
            result.append(number)
    return sorted(set(result))


class Session:
    def __init__(self) -> None:
        self.session: Optional[Any] = None
        self.settings: Dict[str, Any] = {}
        self.torrents: Dict[str, TorrentRuntime] = {}
        self.resolves: Dict[str, Dict[str, Any]] = {}
        self.lock = threading.RLock()
        self.stopping = False
        self.nat_status: Optional[str] = None
        self.dht_running = False

    def ensure_session(self, options: Dict[str, Any]) -> Any:
        if self.session is not None:
            return self.session

        profile_name = options.get("connectionProfile", "high")
        if profile_name not in CONNECTION_PROFILES:
            profile_name = "high"
        profile = CONNECTION_PROFILES[profile_name]
        nat_mapping = as_bool(options.get("natMapping"), True)

        settings = {
            "listen_interfaces": "0.0.0.0:0,[::]:0",
            "enable_dht": True,
            "enable_lsd": True,
            "enable_upnp": nat_mapping,
            "enable_natpmp": nat_mapping,
            "ban_web_seeds": True,
            "alert_mask": 0x7FFFFFFF,
            "connections_limit": profile["connections"],
            "connection_speed": profile["speed"],
            "active_limit": 50,
            "active_downloads": 25,
            "active_seeds": 25,
            "allow_multiple_connections_per_ip": False,
            "no_connect_privileged_ports": True,
            "apply_filter_to_dht": True,
            "out_enc_policy": lt.enc_policy.enabled,
            "in_enc_policy": lt.enc_policy.enabled,
            "allowed_enc_level": lt.enc_level.both,
            "announce_to_all_tiers": True,
            "announce_to_all_trackers": True,
            "dht_bootstrap_nodes": (
                "router.bittorrent.com:6881,"
                "router.utorrent.com:6881,"
                "dht.transmissionbt.com:6881,"
                "dht.libtorrent.org:25401,"
                "dht.aelitis.com:6881"
            ),
        }

        try:
            self.session = lt.session(settings)
        except Exception as exc:
            raise HelperError("TORRENT_UNAVAILABLE", f"libtorrent could not start: {exc}")

        ip_filter = lt.ip_filter()
        for network in PRIVATE_NETWORKS:
            ip_filter.add_rule(str(network.network_address), str(network.broadcast_address), 1)
        try:
            self.session.set_ip_filter(ip_filter)
        except Exception:
            pass

        try:
            self.session.start_dht()
            self.session.start_lsd()
            if nat_mapping:
                self.session.start_natpmp()
                self.session.start_upnp()
            self.dht_running = True
        except Exception:
            pass

        self.settings = {
            "profile": profile_name,
            "natMapping": nat_mapping,
            "perTorrentConnections": profile["per_torrent"],
            "listenPort": self.session.listen_port(),
        }
        emit_event(
            "session.ready",
            {
                "listenPort": self.settings["listenPort"],
                "profile": profile_name,
                "natMapping": nat_mapping,
            },
        )
        return self.session

    def configure(self, options: Dict[str, Any]) -> Dict[str, Any]:
        with self.lock:
            session = self.ensure_session(options)
            profile_name = options.get("connectionProfile", self.settings.get("profile", "high"))
            if profile_name not in CONNECTION_PROFILES:
                profile_name = "high"
            profile = CONNECTION_PROFILES[profile_name]
            nat_mapping = as_bool(
                options.get("natMapping"), bool(self.settings.get("natMapping", True))
            )
            try:
                session.set_max_connections(profile["connections"])
            except Exception:
                pass
            try:
                if nat_mapping:
                    session.start_natpmp()
                    session.start_upnp()
                else:
                    session.stop_natpmp()
                    session.stop_upnp()
                    self.nat_status = "disabled"
            except Exception:
                pass
            self.settings["profile"] = profile_name
            self.settings["natMapping"] = nat_mapping
            self.settings["perTorrentConnections"] = profile["per_torrent"]
            download_limit = as_int(options.get("downloadLimitBytesPerSecond"), 0) or 0
            upload_limit = as_int(options.get("uploadLimitBytesPerSecond"), 0) or 0
            try:
                session.set_download_rate_limit(download_limit)
                session.set_upload_rate_limit(upload_limit)
            except Exception:
                pass
            status = session.status()
            return {
                "listenPort": session.listen_port(),
                "dhtNodes": int(status.dht_nodes),
                "profile": self.settings.get("profile"),
                "natMapping": self.settings.get("natMapping"),
            }

    def inspect(self, path: str) -> Dict[str, Any]:
        with self.lock:
            ti = safe_torrent_info(path)
            return preview_from_ti(ti, "file")

    def resolve_start(self, params: Dict[str, Any]) -> Dict[str, Any]:
        request_id = str(params.get("requestId", ""))
        if not request_id:
            raise HelperError("INVALID_REQUEST", "A resolve request ID is required.")
        info_hash = str(params.get("infoHash", "")).strip().lower()
        version = as_int(params.get("hashVersion"), 1)
        metadata_path = safe_metadata_path(str(params.get("metadataPath", "")))
        if version not in (1, 2):
            raise HelperError("TORRENT_INVALID", "The info hash version is not supported.")
        if version == 1 and not re.fullmatch(r"[0-9a-f]{40}", info_hash):
            raise HelperError("TORRENT_INVALID", "The v1 info hash is invalid.")
        if version == 2 and not re.fullmatch(r"[0-9a-f]{64}", info_hash):
            raise HelperError("TORRENT_INVALID", "The v2 info hash is invalid.")

        with self.lock:
            session = self.ensure_session({})
            if request_id in self.resolves:
                raise HelperError("INVALID_REQUEST", "A resolve request is already running.")
            params_obj = lt.add_torrent_params()
            if version == 1:
                params_obj.info_hashes = lt.info_hash_t(
                    lt.sha1_hash(bytes.fromhex(info_hash))
                )
            else:
                params_obj.info_hashes = lt.info_hash_t(
                    lt.sha256_hash(bytes.fromhex(info_hash))
                )
            params_obj.save_path = str(Path(metadata_path).parent)
            params_obj.name = "Resolving torrent"
            params_obj.flags &= ~lt.torrent_flags.paused
            try:
                handle = session.add_torrent(params_obj)
            except Exception as exc:
                raise HelperError("TORRENT_INVALID", f"The info hash could not be added: {exc}")
            self.resolves[request_id] = {
                "handle": handle,
                "metadataPath": metadata_path,
                "startedAt": time.time(),
                "infoHash": info_hash,
                "version": version,
                "lastProgressAt": 0.0,
            }
            return {"started": True}

    def resolve_cancel(self, params: Dict[str, Any]) -> Dict[str, Any]:
        request_id = str(params.get("requestId", ""))
        with self.lock:
            entry = self.resolves.pop(request_id, None)
            if entry:
                self._remove_handle(entry["handle"])
                emit_event("resolve.cancelled", {"requestId": request_id})
            return {"cancelled": True}

    def add(self, params: Dict[str, Any]) -> Dict[str, Any]:
        with self.lock:
            session = self.ensure_session(params)
            metadata_path = str(params.get("metadataPath", ""))
            ti = safe_torrent_info(metadata_path)
            info_hash, version = torrent_hash_info(ti)
            file_indices = as_int_list(params.get("fileIndices"))
            if not file_indices:
                file_indices = list(range(ti.num_files()))

            if info_hash in self.torrents:
                runtime = self.torrents[info_hash]
                self._apply_limits(runtime, params)
                runtime.seed_after_complete = as_bool(
                    params.get("seedAfterComplete"), runtime.seed_after_complete
                )
                runtime.stopped = False
                runtime.completed_emitted = False
                if runtime.handle.is_paused():
                    runtime.handle.resume()
                return self.torrent_payload(runtime)

            add_params = lt.add_torrent_params()
            add_params.ti = ti
            add_params.save_path = str(params.get("savePath", ""))
            add_params.flags &= ~lt.torrent_flags.paused
            add_params.max_connections = int(
                self.settings.get("perTorrentConnections", 100) or 100
            )
            download_limit = as_int(params.get("downloadLimitBytesPerSecond"), 0) or 0
            upload_limit = as_int(params.get("uploadLimitBytesPerSecond"), 0) or 0
            add_params.download_limit = download_limit
            add_params.upload_limit = upload_limit
            if bool(ti.priv()):
                add_params.flags |= (
                    lt.torrent_flags.disable_dht
                    | lt.torrent_flags.disable_pex
                    | lt.torrent_flags.disable_lsd
                )
            priorities = [1 if index in file_indices else 0 for index in range(ti.num_files())]
            add_params.file_priorities = priorities
            try:
                handle = session.add_torrent(add_params)
            except Exception as exc:
                raise HelperError("TORRENT_INVALID", f"The torrent could not be started: {exc}")

            runtime = TorrentRuntime(handle, metadata_path, ti.name() or "Torrent", params)
            runtime.selected = set(file_indices)
            runtime.trackers = tracker_entries(ti)
            self.torrents[info_hash] = runtime
            return self.torrent_payload(runtime)

    def pause(self, params: Dict[str, Any]) -> Dict[str, Any]:
        with self.lock:
            runtime = self._get_runtime(params)
            runtime.handle.pause()
            return self.torrent_payload(runtime)

    def resume(self, params: Dict[str, Any]) -> Dict[str, Any]:
        with self.lock:
            runtime = self._get_runtime(params)
            runtime.handle.resume()
            runtime.stopped = False
            runtime.completed_emitted = False
            return self.torrent_payload(runtime)

    def stop_seeding(self, params: Dict[str, Any]) -> Dict[str, Any]:
        with self.lock:
            runtime = self._get_runtime(params)
            runtime.stopped = True
            runtime.seeding = False
            runtime.handle.pause()
            runtime.completed_at = runtime.completed_at or time.time()
            runtime.completed_emitted = True
            emit_event(
                "torrent.completed",
                {
                    "id": runtime.handle.info_hash().to_string().hex(),
                    "seeding": False,
                    "stopped": True,
                    "status": self.torrent_payload(runtime),
                },
            )
            return self.torrent_payload(runtime)

    def remove(self, params: Dict[str, Any]) -> Dict[str, Any]:
        with self.lock:
            runtime = self._get_runtime(params)
            delete_files = as_bool(params.get("deleteFiles"), False)
            handle = runtime.handle
            info_hash = handle.info_hash().to_string().hex()
            try:
                self.session.remove_torrent(handle, lt.session.delete_files if delete_files else 0)
            except Exception:
                try:
                    self.session.remove_torrent(handle)
                except Exception:
                    pass
            self.torrents.pop(info_hash, None)
            return {"removed": True, "infoHash": info_hash}

    def set_limits(self, params: Dict[str, Any]) -> Dict[str, Any]:
        with self.lock:
            runtime = self._get_runtime(params)
            self._apply_limits(runtime, params)
            return self.torrent_payload(runtime)

    def set_seed_policy(self, params: Dict[str, Any]) -> Dict[str, Any]:
        with self.lock:
            runtime = self._get_runtime(params)
            runtime.seed_after_complete = as_bool(params.get("seedAfterComplete"), False)
            if runtime.seed_after_complete:
                runtime.stopped = False
                try:
                    runtime.handle.resume()
                except Exception:
                    pass
            else:
                runtime.stopped = True
                runtime.seeding = False
                try:
                    runtime.handle.pause()
                except Exception:
                    pass
            return self.torrent_payload(runtime)

    def set_file_selection(self, params: Dict[str, Any]) -> Dict[str, Any]:
        with self.lock:
            runtime = self._get_runtime(params)
            indices = as_int_list(params.get("fileIndices"))
            ti = runtime.handle.get_torrent_info()
            if not indices:
                indices = list(range(ti.num_files()))
            if any(index < 0 or index >= ti.num_files() for index in indices):
                raise HelperError("INVALID_REQUEST", "The file selection is invalid.")
            runtime.selected = set(indices)
            runtime.handle.prioritize_files(
                [1 if index in runtime.selected else 0 for index in range(ti.num_files())]
            )
            return self.torrent_payload(runtime)

    def find_more_peers(self, params: Dict[str, Any]) -> Dict[str, Any]:
        with self.lock:
            runtime = self._get_runtime(params)
            try:
                runtime.handle.force_reannounce(0)
            except Exception:
                pass
            try:
                runtime.handle.force_dht_announce()
            except Exception:
                pass
            try:
                runtime.handle.scrape_tracker()
            except Exception:
                pass
            return self.torrent_payload(runtime)

    def verify(self, params: Dict[str, Any]) -> Dict[str, Any]:
        with self.lock:
            runtime = self._get_runtime(params)
            runtime.handle.force_recheck()
            return self.torrent_payload(runtime)

    def status(self, params: Dict[str, Any]) -> Dict[str, Any]:
        with self.lock:
            runtime = self._get_runtime(params)
            return self.torrent_payload(runtime)

    def list(self) -> Dict[str, Any]:
        with self.lock:
            return {
                "torrents": [self.torrent_payload(runtime) for runtime in self.torrents.values()]
            }

    def shutdown(self) -> Dict[str, Any]:
        with self.lock:
            self.stopping = True
            for runtime in list(self.torrents.values()):
                try:
                    runtime.handle.pause()
                except Exception:
                    pass
            for entry in list(self.resolves.values()):
                self._remove_handle(entry["handle"])
            self.resolves.clear()
            if self.session is not None:
                try:
                    self.session.pause()
                except Exception:
                    pass
            return {"stopped": True}

    def poll(self) -> None:
        if self.session is None or self.stopping:
            return
        with self.lock:
            try:
                alerts = self.session.pop_alerts()
            except Exception:
                alerts = []
            for alert in alerts:
                name = type(alert).__name__
                if name == "portmap_alert":
                    self.nat_status = "mapped"
                elif name in {"portmap_error_alert", "listen_failed_alert"}:
                    self.nat_status = "unavailable"
                elif name == "torrent_error_alert":
                    try:
                        info_hash = alert.handle.info_hash().to_string().hex()
                        runtime = self.torrents.get(info_hash)
                        if runtime:
                            emit_event(
                                "torrent.error",
                                {
                                    "id": info_hash,
                                    "message": str(alert.error),
                                },
                            )
                    except Exception:
                        pass

            now = time.time()
            for request_id, entry in list(self.resolves.items()):
                try:
                    st = entry["handle"].status()
                except Exception:
                    continue
                elapsed = now - entry["startedAt"]
                if st.has_metadata:
                    try:
                        ti = entry["handle"].get_torrent_info()
                        preview = preview_from_ti(ti, "infohash")
                        metadata_path = entry["metadataPath"]
                        Path(metadata_path).parent.mkdir(parents=True, exist_ok=True)
                        create_torrent = lt.create_torrent(ti)
                        data = lt.bencode(create_torrent.generate())
                        with open(metadata_path, "wb") as output:
                            output.write(data)
                        self._remove_handle(entry["handle"])
                        self.resolves.pop(request_id, None)
                        emit_event(
                            "resolve.ready",
                            {
                                "requestId": request_id,
                                "preview": preview,
                                "metadataPath": metadata_path,
                            },
                        )
                    except Exception as exc:
                        self._remove_handle(entry["handle"])
                        self.resolves.pop(request_id, None)
                        emit_event(
                            "resolve.error",
                            {
                                "requestId": request_id,
                                "code": "TORRENT_INVALID",
                                "message": f"The torrent metadata could not be saved: {exc}",
                            },
                        )
                    continue
                if elapsed > RESOLVE_TIMEOUT_SECONDS:
                    self._remove_handle(entry["handle"])
                    self.resolves.pop(request_id, None)
                    emit_event(
                        "resolve.error",
                        {
                            "requestId": request_id,
                            "code": "TORRENT_NO_PEERS",
                            "message": (
                                "No peers shared metadata for this info hash. "
                                "Check the hash or open the .torrent file instead."
                            ),
                        },
                    )
                    continue
                if now - entry["lastProgressAt"] >= 1.0:
                    entry["lastProgressAt"] = now
                    try:
                        session_status = self.session.status()
                        dht_nodes = int(session_status.dht_nodes)
                    except Exception:
                        dht_nodes = None
                    emit_event(
                        "resolve.progress",
                        {
                            "requestId": request_id,
                            "dhtNodes": dht_nodes,
                            "peers": int(st.num_peers),
                            "elapsedMs": int(elapsed * 1000),
                            "message": (
                                "Searching DHT for peers…"
                                if dht_nodes is not None and dht_nodes <= 0
                                else "Finding peers for this info hash…"
                            ),
                        },
                    )

            for info_hash, runtime in list(self.torrents.items()):
                try:
                    payload = self.torrent_payload(runtime, include_peers=True)
                    emit_event("torrent.update", payload)
                    if payload["state"] == "completed" and not runtime.completed_emitted:
                        runtime.completed_emitted = True
                        emit_event(
                            "torrent.completed",
                            {
                                "id": info_hash,
                                "seeding": False,
                                "stopped": runtime.stopped,
                                "status": self.torrent_payload(runtime),
                            },
                        )
                    elif payload["state"] == "seeding" and not runtime.completed_emitted:
                        runtime.completed_emitted = True
                        emit_event(
                            "torrent.completed",
                            {
                                "id": info_hash,
                                "seeding": True,
                                "stopped": False,
                                "status": self.torrent_payload(runtime),
                            },
                        )
                except Exception:
                    continue

    def torrent_payload(self, runtime: TorrentRuntime, include_peers: bool = True) -> Dict[str, Any]:
        handle = runtime.handle
        st = handle.status()
        ti = None
        try:
            ti = handle.get_torrent_info()
        except Exception:
            pass
        info_hash = handle.info_hash().to_string().hex()
        state = state_name(st.state)
        if bool(getattr(st, "paused", False)) and state not in {"completed", "seeding"}:
            state = "paused"
        if runtime.stopped and state in {"finished", "seeding"}:
            state = "completed"
        if (st.is_finished or st.is_seeding) and runtime.seed_after_complete and not runtime.stopped:
            state = "seeding"
        if st.is_finished and not runtime.completed_at:
            runtime.completed_at = time.time()
            if not runtime.seed_after_complete:
                runtime.stopped = True
                try:
                    handle.pause()
                except Exception:
                    pass
                state = "completed"
        if runtime.stopped and not st.is_finished:
            state = "paused"

        total_done = int(getattr(st, "total_done", 0) or 0)
        total_wanted = int(getattr(st, "total_wanted", 0) or 0)
        download_rate = int(getattr(st, "download_rate", 0) or 0)
        upload_rate = int(getattr(st, "upload_rate", 0) or 0)
        remaining = max(0, total_wanted - total_done)
        eta = int(remaining / download_rate) if download_rate > 0 and remaining > 0 else None
        uploaded = int(getattr(st, "total_upload", 0) or 0)
        ratio = (uploaded / total_done) if total_done > 0 else None
        progress = float(getattr(st, "progress", 0.0) or 0.0)
        seeds_connected = int(getattr(st, "num_seeds", 0) or 0)
        peers_connected = int(getattr(st, "num_peers", 0) or 0)
        seeds_available = int(getattr(st, "num_complete", -1) or -1)
        peers_available = int(getattr(st, "num_incomplete", -1) or -1)
        error_message = None
        try:
            errc = getattr(st, "errc", None)
            if errc is not None and getattr(errc, "value", lambda: 0)() != 0:
                error_message = str(errc.message())
        except Exception:
            pass

        files: List[Dict[str, Any]] = []
        if ti is not None:
            try:
                progress_values = handle.file_progress()
            except Exception:
                progress_values = []
            for index, entry in enumerate(ti.files()):
                normalized = entry.path.replace("\\", "/")
                name = normalized.rsplit("/", 1)[-1]
                files.append(
                    {
                        "index": index,
                        "path": normalized,
                        "name": name,
                        "sizeBytes": int(entry.size),
                        "selected": index in runtime.selected,
                        "executable": os.path.splitext(name)[1].lower()
                        in EXECUTABLE_EXTENSIONS,
                        "downloadedBytes": (
                            int(progress_values[index]) if index < len(progress_values) else None
                        ),
                    }
                )

        session_status = None
        try:
            session_status = self.session.status() if self.session is not None else None
        except Exception:
            pass
        dht_nodes = (
            int(session_status.dht_nodes)
            if session_status is not None and hasattr(session_status, "dht_nodes")
            else None
        )
        listen_port = self.session.listen_port() if self.session is not None else None
        incoming = bool(
            session_status.has_incoming_connections
            if session_status is not None and hasattr(session_status, "has_incoming_connections")
            else False
        )

        return {
            "id": info_hash,
            "title": clean_text(st.name, 300) or runtime.title,
            "state": state,
            "progress": progress,
            "downloadedBytes": total_done,
            "totalBytes": total_wanted or int(getattr(st, "total", 0) or 0),
            "downloadRateBytesPerSecond": download_rate,
            "uploadRateBytesPerSecond": upload_rate,
            "etaSeconds": eta,
            "uploadedBytes": uploaded,
            "ratio": ratio,
            "seedsConnected": seeds_connected,
            "seedsAvailable": seeds_available if seeds_available >= 0 else None,
            "peersConnected": peers_connected,
            "peersAvailable": peers_available if peers_available >= 0 else None,
            "isPrivate": bool(ti.priv()) if ti is not None else bool(runtime.options.get("isPrivate")),
            "infoHash": info_hash,
            "hashVersion": runtime_hash_version(handle),
            "files": files,
            "trackers": tracker_status(handle) or runtime.trackers,
            "peers": peer_entries(handle) if include_peers else [],
            "downloadLimitBytesPerSecond": runtime.download_limit or None,
            "uploadLimitBytesPerSecond": runtime.upload_limit or None,
            "seedAfterComplete": runtime.seed_after_complete,
            "discovery": {
                "dht": not bool(ti.priv()) if ti is not None else True,
                "pex": not bool(ti.priv()) if ti is not None else True,
                "lsd": not bool(ti.priv()) if ti is not None else True,
                "natMapping": bool(self.settings.get("natMapping", True)),
                "natStatus": (
                    self.nat_status
                    if self.settings.get("natMapping", True)
                    else "disabled"
                ),
                "listenPort": listen_port,
                "incomingConnections": incoming,
                "dhtNodes": dht_nodes,
                "webSeeds": "disabled",
            },
            "error": error_message,
        }

    def _get_runtime(self, params: Dict[str, Any]) -> TorrentRuntime:
        info_hash = str(params.get("infoHash", "")).strip().lower()
        runtime = self.torrents.get(info_hash)
        if runtime is None:
            raise HelperError("TORRENT_NOT_FOUND", "The torrent is no longer active.")
        return runtime

    def _apply_limits(self, runtime: TorrentRuntime, params: Dict[str, Any]) -> None:
        download_limit = as_int(params.get("downloadLimitBytesPerSecond"), 0) or 0
        upload_limit = as_int(params.get("uploadLimitBytesPerSecond"), 0) or 0
        runtime.download_limit = download_limit
        runtime.upload_limit = upload_limit
        try:
            runtime.handle.set_download_limit(download_limit)
            runtime.handle.set_upload_limit(upload_limit)
        except Exception:
            pass

    def _remove_handle(self, handle: Any) -> None:
        if self.session is None:
            return
        try:
            self.session.remove_torrent(handle)
        except Exception:
            pass

    @staticmethod
    def _safe_rmtree(path: Path) -> None:
        # Only remove a directory that looks like a torrent payload; never a drive root.
        try:
            resolved = path.resolve()
            if resolved.parent == resolved:
                return
            if len(resolved.parts) < 3:
                return
            shutil.rmtree(resolved, ignore_errors=True)
        except Exception:
            pass


def runtime_hash_version(handle: Any) -> int:
    try:
        hashes = handle.info_hashes()
        if hashes.has_v1():
            return 1
        if hashes.has_v2():
            return 2
    except Exception:
        pass
    return 1


def handle_request(session: Session, request: Dict[str, Any]) -> None:
    request_id = request.get("id")
    method = request.get("method")
    params = request.get("params") if isinstance(request.get("params"), dict) else {}
    try:
        if method == "ping":
            result = {"pong": True}
        elif method == "session.configure":
            result = session.configure(params)
        elif method == "session.status":
            status = session.session.status() if session.session is not None else None
            result = {
                "dhtNodes": int(status.dht_nodes) if status is not None else 0,
                "listenPort": session.session.listen_port() if session.session is not None else None,
                "profile": session.settings.get("profile"),
                "natMapping": session.settings.get("natMapping"),
                "natStatus": session.nat_status,
            }
        elif method == "torrent.inspect":
            result = session.inspect(str(params.get("path", "")))
        elif method == "torrent.resolve_start":
            result = session.resolve_start(params)
        elif method == "torrent.resolve_cancel":
            result = session.resolve_cancel(params)
        elif method == "torrent.add":
            result = session.add(params)
        elif method == "torrent.pause":
            result = session.pause(params)
        elif method == "torrent.resume":
            result = session.resume(params)
        elif method == "torrent.stop_seeding":
            result = session.stop_seeding(params)
        elif method == "torrent.remove":
            result = session.remove(params)
        elif method == "torrent.set_limits":
            result = session.set_limits(params)
        elif method == "torrent.set_seed_policy":
            result = session.set_seed_policy(params)
        elif method == "torrent.set_file_selection":
            result = session.set_file_selection(params)
        elif method == "torrent.find_more_peers":
            result = session.find_more_peers(params)
        elif method == "torrent.verify":
            result = session.verify(params)
        elif method == "torrent.status":
            result = session.status(params)
        elif method == "torrent.list":
            result = session.list()
        elif method == "session.shutdown":
            result = session.shutdown()
            ok_response(request_id, result)
            return
        else:
            raise HelperError("INVALID_REQUEST", f"Unknown method: {method}")
        ok_response(request_id, result)
    except HelperError as exc:
        error_response(request_id, exc.code, exc.message)
    except Exception as exc:
        error_response(request_id, "TORRENT_HELPER_ERROR", f"Torrent helper error: {exc}")


def poller_loop(session: Session) -> None:
    while not session.stopping:
        try:
            session.poll()
        except Exception:
            pass
        time.sleep(UPDATE_INTERVAL_SECONDS)


def main() -> None:
    session = Session()
    poller = threading.Thread(target=poller_loop, args=(session,), daemon=True)
    poller.start()
    emit_event("helper.ready", {"version": lt.__version__})
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            error_response(None, "INVALID_REQUEST", "Malformed JSON request.")
            continue
        if not isinstance(request, dict):
            error_response(None, "INVALID_REQUEST", "Request must be an object.")
            continue
        handle_request(session, request)


if __name__ == "__main__":
    main()
