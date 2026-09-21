"""Persistent representative covers, resolved by ISSN outside journal collection."""

from __future__ import annotations
import copy
import base64
import hashlib
import io
import json
import re
import secrets
import threading
import time
import warnings
from pathlib import Path

import requests
from PIL import Image, UnidentifiedImageError
from library import issn

MAX_BYTES = 2 * 1024 * 1024
IMAGE_NAME = re.compile(r"[a-f0-9]{64}\.png")
SOURCE = "https://assets.thirdiron.com/images/covers/{}.png"
MISS_TTL = 7 * 86400
ERROR_TTL = 3600


def identifiers(journal):
    result = []
    for value in [journal["id"], *journal.get("issns", [])]:
        try:
            value = issn(value)
        except (ValueError, TypeError):
            continue
        if value not in result:
            result.append(value)
    return result


def image_bytes(raw, *, automatic=False):
    """Decode bounded raster images and strip metadata before serving local PNGs."""
    if not raw or len(raw) > MAX_BYTES:
        raise ValueError("图片不能为空，且不能超过 2 MB")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as source:
                width, height = source.size
                if (
                    source.format not in {"PNG", "JPEG", "WEBP"}
                    or getattr(source, "n_frames", 1) != 1
                    or min(width, height) < 40
                    or width * height > 16_000_000
                ):
                    raise ValueError(
                        "请使用至少 40 × 40、最多 1600 万像素的静态 PNG、JPEG 或 WebP"
                    )
                source.load()
                picture = source.convert("RGBA")
                background = Image.new("RGB", picture.size, "white")
                background.paste(picture, mask=picture.getchannel("A"))
                if automatic and (
                    not 0.45 <= width / height <= 0.95
                    or min(width, height) < 60
                    or max(hi - lo for lo, hi in background.getextrema()) < 20
                ):
                    raise ValueError("来源图片不是可用的期刊封面")
                background.thumbnail((600, 840))
                if min(background.size) < 40:
                    # Keep accepted narrow uploads valid for backup and restoration.
                    padded = Image.new(
                        "RGB", tuple(max(40, n) for n in background.size), "white"
                    )
                    padded.paste(
                        background,
                        (
                            (padded.width - background.width) // 2,
                            (padded.height - background.height) // 2,
                        ),
                    )
                    background = padded
                output = io.BytesIO()
                background.save(output, format="PNG")
                return output.getvalue()
    except (
        UnidentifiedImageError,
        OSError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
    ) as exc:
        raise ValueError("图片无法解码，请使用完整的 PNG、JPEG 或 WebP 文件") from exc


def download(identifier):
    # The client never supplies a remote URL; redirects cannot escape this source.
    with requests.get(
        SOURCE.format(identifier),
        stream=True,
        allow_redirects=False,
        timeout=(5, 15),
        headers={"User-Agent": "JournalRadar/1.0"},
    ) as response:
        if response.status_code == 404:
            return None
        response.raise_for_status()
        content_type = response.headers.get("Content-Type", "").split(";", 1)[0].lower()
        # Some valid Third Iron PNGs are served as generic binary data. The decoder
        # below is authoritative; a successful HTTP response alone is insufficient.
        if response.status_code != 200 or not (
            content_type.startswith("image/")
            or content_type == "application/octet-stream"
        ):
            raise ValueError("封面来源未返回图片")
        chunks, size, deadline = [], 0, time.monotonic() + 25
        for chunk in response.iter_content(16384):
            size += len(chunk)
            if size > MAX_BYTES or time.monotonic() > deadline:
                raise ValueError("封面下载超过大小或时间限制")
            chunks.append(chunk)
        return b"".join(chunks)


class CoverService:
    def __init__(self, directory, web, base, *, getter=download, clock=time.time):
        self.directory = Path(directory) / "covers"
        self.path = self.directory / "index.json"
        self.web, self.getter, self.clock = Path(web), getter, clock
        self.lock = threading.RLock()
        self.records = {}
        if self.path.exists():
            # Preserve an unreadable index instead of silently discarding manual covers.
            self.records = json.loads(self.path.read_text(encoding="utf-8"))
            if not isinstance(self.records, dict):
                raise ValueError("本机封面索引损坏，请从备份恢复 covers/index.json")
        catalog = json.JSONDecoder().raw_decode(
            (self.web / "catalog.js")
            .read_text(encoding="utf-8")
            .split("const JOURNAL_CATALOG = ", 1)[1]
        )[0]
        self.bundled = {}
        for journal in base:
            cover = catalog.get(journal["id"], {}).get("cover", "")
            if (
                re.fullmatch(r"cover-[\dX-]+\.(?:png|jpg|jpeg|webp)", cover)
                and (self.web / cover).is_file()
            ):
                for identifier in identifiers(journal):
                    self.bundled[identifier] = cover
        self.pending, self.active = {}, set()
        self.enabled, self.worker = False, None
        self.revision = secrets.token_hex(12)

    def _bump(self):
        self.revision = secrets.token_hex(12)

    def _cached(self, journal):
        keys = set(identifiers(journal))
        candidates = [self.records.get(journal["id"], {})] + [
            row
            for key, row in self.records.items()
            if key != journal["id"] and keys.intersection(row.get("issns", []))
        ]
        for row in sorted(candidates, key=lambda row: not row.get("manual", False)):
            name = row.get("file", "")
            if IMAGE_NAME.fullmatch(name) and (self.directory / name).is_file():
                return {**row, "url": "/api/covers/image/" + name}
        for identifier in identifiers(journal):
            if identifier in self.bundled:
                return {
                    "status": "found",
                    "source": "bundled",
                    "matched_issn": identifier,
                    "url": self.bundled[identifier],
                }
        return None

    def _state(self, journal):
        cached = self._cached(journal)
        if cached:
            return cached
        if journal["id"] in self.pending or journal["id"] in self.active:
            return {"status": "pending"}
        if not identifiers(journal):
            return {"status": "no_issn"}
        # A removed file should be fetched again, not reported as successfully found.
        row = self.records.get(journal["id"], {})
        return (
            row if row.get("status") in {"missing", "error"} else {"status": "pending"}
        )

    def snapshot(self, journals):
        with self.lock:
            return {
                "revision": self.revision,
                "covers": {j["id"]: copy.deepcopy(self._state(j)) for j in journals},
            }

    def _save(self, identifier, row, raw=None):
        # Called under lock, with immutable images installed before their index entry.
        self.directory.mkdir(parents=True, exist_ok=True)
        if raw is not None:
            row = {**row, "file": self._install(raw)}
        updated = {**self.records, identifier: row}
        self._commit(updated)

    def _install(self, raw):
        self.directory.mkdir(parents=True, exist_ok=True)
        name = hashlib.sha256(raw).hexdigest() + ".png"
        temporary = self.directory / (name + ".tmp")
        temporary.write_bytes(raw)
        temporary.replace(self.directory / name)
        return name

    def _commit(self, updated):
        temporary = self.path.with_suffix(".json.tmp")
        temporary.write_text(
            json.dumps(updated, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        temporary.replace(self.path)
        self.records = updated
        self._bump()

    def backup(self, journals):
        result = []
        with self.lock:
            for journal in journals:
                keys = set(identifiers(journal))
                manual = [
                    row
                    for key, row in self.records.items()
                    if row.get("manual")
                    and (
                        key == journal["id"] or keys.intersection(row.get("issns", []))
                    )
                ]
                if not manual:
                    continue
                cached = self._cached(journal)
                if not cached or not cached.get("manual"):
                    raise ValueError("手动封面文件缺失，请恢复本机 covers 目录后再备份")
                raw = image_bytes((self.directory / cached["file"]).read_bytes())
                result.append(
                    {
                        "journal_id": journal["id"],
                        "data": base64.b64encode(raw).decode("ascii"),
                    }
                )
        if sum(len(row["data"]) for row in result) > 50_000_000:
            raise ValueError("手动封面备份超过 50 MB")
        return result

    def restore(self, rows, journals):
        if not isinstance(rows, list) or len(rows) > 2000:
            raise ValueError("封面备份格式无效")
        known = {j["id"]: j for j in journals}
        prepared = {}
        total = 0
        for row in rows:
            if not isinstance(row, dict) or row.get("journal_id") not in known:
                raise ValueError("封面缺少对应期刊配置")
            jid, encoded = row["journal_id"], row.get("data")
            if (
                jid in prepared
                or not isinstance(encoded, str)
                or len(encoded) > 2_800_000
            ):
                raise ValueError("封面备份重复或超过大小限制")
            total += len(encoded)
            if total > 50_000_000:
                raise ValueError("封面备份超过 50 MB")
            try:
                raw = base64.b64decode(encoded, validate=True)
            except (ValueError, UnicodeError) as exc:
                raise ValueError("封面备份编码无效") from exc
            if not raw.startswith(b"\x89PNG\r\n\x1a\n"):
                raise ValueError("备份封面必须是 PNG 图片")
            prepared[jid] = image_bytes(raw)
        # Validate every image before changing the index; existing manual choices win.
        with self.lock:
            updated, restored = dict(self.records), 0
            for jid, raw in prepared.items():
                if (self._cached(known[jid]) or {}).get("manual"):
                    continue
                updated[jid] = {
                    "status": "found",
                    "manual": True,
                    "source": "manual",
                    "issns": identifiers(known[jid]),
                    "checked_at": self.clock(),
                    "file": self._install(raw),
                }
                restored += 1
            if restored:
                self._commit(updated)
            return {"restored": restored, "preserved": len(prepared) - restored}

    def manual(self, journal, raw):
        clean = image_bytes(raw)
        with self.lock:
            self._save(
                journal["id"],
                {
                    "status": "found",
                    "manual": True,
                    "source": "manual",
                    "issns": identifiers(journal),
                    "checked_at": self.clock(),
                },
                clean,
            )
            return self.snapshot([journal])

    def schedule(self, journals):
        with self.lock:
            for journal in journals:
                jid = journal["id"]
                if (
                    not journal.get("enabled", True)
                    or not identifiers(journal)
                    or jid in self.pending
                    or jid in self.active
                    or self._cached(journal)
                ):
                    continue
                row = self.records.get(jid, {})
                if row.get("retry_after", 0) > self.clock():
                    continue
                self.pending[jid] = copy.deepcopy(journal)
                self._bump()
            self._kick()

    def start(self):
        with self.lock:
            self.enabled = True
            self._kick()

    def _kick(self):
        if self.enabled and self.pending and self.worker is None:
            self.worker = threading.Thread(
                target=self._drain, daemon=True, name="journal-covers"
            )
            self.worker.start()

    def _drain(self):
        while True:
            with self.lock:
                if not self.pending:
                    self.worker = None
                    return
                jid = next(iter(self.pending))
                journal = self.pending.pop(jid)
                self.active.add(jid)
            try:
                self._resolve(journal)
            except Exception:
                # Storage failure must not spin or strand the other queued journals.
                with self.lock:
                    if not self._cached(journal):
                        self.records[jid] = {
                            "status": "error",
                            "retry_after": self.clock() + ERROR_TTL,
                        }
            finally:
                with self.lock:
                    self.active.discard(jid)
                    self._bump()

    def _resolve(self, journal):
        with self.lock:
            if self._cached(journal):
                return
        failed, clean, matched, error = False, None, None, ""
        for identifier in identifiers(journal):
            try:
                raw = self.getter(identifier)
                if raw is not None:
                    clean = image_bytes(raw, automatic=True)
                    matched = identifier
                    break
            except (requests.RequestException, ValueError, OSError) as exc:
                failed = True
                error = str(exc)[:200]
        stamp = self.clock()
        row = {
            "status": "found" if clean else "error" if failed else "missing",
            "source": "thirdiron",
            "issns": identifiers(journal),
            "checked_at": stamp,
        }
        if clean:
            row.update(matched_issn=matched, source_url=SOURCE.format(matched))
        else:
            row["retry_after"] = stamp + (ERROR_TTL if failed else MISS_TTL)
            if error:
                row["error"] = error
        with self.lock:
            # A manual upload may have completed while the remote request was running.
            if not self._cached(journal):
                self._save(journal["id"], row, clean)
