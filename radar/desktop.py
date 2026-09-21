"""Loopback-only companion: cloud history plus RSS collected on this computer."""

from __future__ import annotations
import argparse
import concurrent.futures
import datetime as dt
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import hashlib
import re
from pathlib import Path
import secrets
import threading
import time
from urllib.parse import urlsplit, parse_qs
from run import (
    ROOT,
    RadarStore,
    collect_rss,
    collect_crossref,
    get,
    now,
    plain,
    safe_url,
)
from abstracts import AbstractService
from archives import ArchiveService
from library import Library, lookup, public_feed_get
from site_data import write_site, expand, CHUNK_PATH, write_json, encoded

PORT = 8766
CLOUD = "https://linkingoscar.github.io/journal-radar/data.json"


def cloud_data(directory, getter):
    """Older servers remain compatible; new clients reuse immutable cloud chunks."""
    try:
        index = getter(CLOUD.replace("data.json", "index.json")).json()
    except Exception as exc:
        if getattr(getattr(exc, "response", None), "status_code", None) != 404:
            raise
        return getter(CLOUD).json()
    cache = Path(directory) / "cloud-chunks"

    def read(path):
        local = cache / Path(path).name
        if local.exists():
            try:
                value = json.loads(local.read_text(encoding="utf-8"))
                if hashlib.sha256(encoded(value)).hexdigest() == local.stem:
                    return value
            except ValueError:
                pass
        value = getter(CLOUD.replace("data.json", path)).json()
        if hashlib.sha256(encoded(value)).hexdigest() != local.stem:
            raise ValueError("Cloud history content does not match its address")
        write_json(local, value)
        return value

    payload = expand(index, read)
    keep = {Path(c["url"]).name for c in index.get("history_chunks", [])}
    if cache.exists():
        for path in cache.glob("*.json"):
            if path.name not in keep:
                path.unlink()
    return payload


def import_cloud(store, registry, payload):
    if (
        not isinstance(payload, dict)
        or not isinstance(payload.get("articles"), list)
        or not isinstance(payload.get("journals"), list)
    ):
        raise ValueError("云端数据格式错误")
    byid = {j["id"]: j for j in registry["journals"]}
    grouped = {}
    for row in payload["articles"]:
        jid = row.get("journal_id")
        if jid not in byid or not row.get("title") or not safe_url(row.get("link")):
            continue
        sources = set((row.get("sources") or "crossref").split(",")) & {
            "crossref",
            "rss",
        }
        for source in sources:
            entry = {
                key: plain(row.get(key))
                for key in (
                    "title",
                    "authors",
                    "abstract",
                    "doi",
                    "published_date",
                    "online_date",
                    "print_date",
                    "article_type",
                )
            }
            entry.update(
                link=safe_url(row["link"]),
                entry_id=row.get("id", ""),
                first_seen=row.get("first_seen"),
                source=source,
                source_rank=2 if "crossref" in sources else 1,
            )
            if isinstance(row.get("citation"), dict):
                entry["citation"] = row["citation"]
            grouped.setdefault(jid, []).append(entry)
    added = sum(store.ingest(byid[jid], entries) for jid, entries in grouped.items())
    return added


def effective_status(cloud, local):
    # A working local source replaces a rejected cloud request in availability.
    effective = {h["source"]: h for h in cloud}
    for health in [local] if isinstance(local, dict) else local or []:
        source = health["source"]
        if not health.get("error") or not effective.get(source, {}).get("last_success"):
            effective[source] = health
    values = list(effective.values())
    good = any(h.get("last_success") and not h.get("error") for h in values)
    bad = any(h.get("error") for h in values)
    return (
        "partial" if good and bad else "ok" if good else "error" if bad else "pending"
    )


class Companion:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.library = Library(
            json.loads((ROOT / "radar/journals.json").read_text(encoding="utf-8")),
            self.directory / "library.json",
        )
        self.registry = self.library.registry()
        self.library_lock = threading.RLock()
        self.candidates = {}
        self.resync_requested = False
        self.store = RadarStore(self.directory)
        self.abstracts = AbstractService(self.directory)
        self.archives = ArchiveService(self.directory, self.registry)
        self.archive_slot = threading.BoundedSemaphore(1)
        self.abstract_slot = threading.BoundedSemaphore(1)
        self.token = secrets.token_urlsafe(32)
        self.guard = threading.Lock()
        self.abstract_stop = threading.Event()
        self.status = {
            "running": False,
            "phase": "等待补采",
            "completed": 0,
            "total": 0,
            "last_finished": None,
            "error": None,
        }
        self.cloud = {}
        try:
            self.cloud = json.loads(
                (self.directory / "cloud.json").read_text(encoding="utf-8")
            )
        except (FileNotFoundError, ValueError):
            pass
        self.publish()

    def publish(self):
        with self.library_lock:
            self._publish()

    def _publish(self):
        payload = self.store.export(self.registry, self.directory / "site")
        self.abstracts.overlay(payload)
        cloud_abstracts = {
            a.get("doi"): a
            for a in self.cloud.get("articles", [])
            if a.get("doi") and a.get("abstract_source")
        }
        for article in payload["articles"]:
            source = cloud_abstracts.get(article.get("doi"))
            if source and source.get("abstract") == article.get("abstract"):
                article.update(
                    abstract_source=source["abstract_source"],
                    abstract_url=source.get("abstract_url", ""),
                )
        cloud_journals = {j["id"]: j for j in self.cloud.get("journals", [])}
        local_health = self.store.health()
        for j in payload["journals"]:
            c = cloud_journals.get(j["id"], {}).get("health", [])
            local = [
                local_health[(j["id"], source)]
                for source in ("rss", "crossref")
                if (j["id"], source) in local_health
            ]
            j["status"] = effective_status(c, local)
            j["health"] = [{**h, "source": "云端 " + h["source"]} for h in c] + [
                {
                    **h,
                    "source": "本机 " + ("RSS" if h["source"] == "rss" else "Crossref"),
                }
                for h in local
            ]
        # Keep reading state when a cloud record and an earlier local RSS entry have different ids.
        doi_ids = {a["doi"]: a["id"] for a in payload["articles"] if a["doi"]}
        link_ids = {(a["journal_id"], a["link"]): a["id"] for a in payload["articles"]}
        aliases = {}
        for a in self.cloud.get("articles", []):
            canonical = doi_ids.get(a.get("doi")) or link_ids.get(
                (a.get("journal_id"), a.get("link"))
            )
            if canonical and canonical != a.get("id"):
                aliases[a["id"]] = canonical
        payload.update(
            desktop=True,
            cloud_updated_at=self.cloud.get("generated_at"),
            reading_aliases=aliases,
            library_revision=self.library_revision(),
            library_deleted_groups=self.library.local["deleted_groups"],
        )
        write_site(payload, self.directory / "site")
        self.status["data_revision"] = (
            payload["generated_at"] + ":" + payload["library_revision"]
        )
        self.status["articles"] = len(payload["articles"])

    def library_revision(self):
        import hashlib

        return hashlib.sha256(
            json.dumps(self.library.local, sort_keys=True).encode()
        ).hexdigest()

    def lookup_journals(self, body):
        matches = lookup(body.get("query", ""), self.registry, body.get("rss_url", ""))
        with self.library_lock:
            self.candidates = {
                k: v for k, v in self.candidates.items() if v[0] > time.monotonic()
            }
            if len(self.candidates) > 100:
                self.candidates.clear()
            result = []
            for journal in matches:
                ticket = secrets.token_urlsafe(24)
                self.candidates[ticket] = (time.monotonic() + 900, journal)
                result.append({**journal, "candidate": ticket})
            return {"journals": result}

    def change_library(self, action, body):
        with self.library_lock:
            if body.get("revision") != self.library_revision():
                raise ValueError("期刊配置已在其他窗口更新，请刷新页面后重试")
            if action == "restore":
                result = {
                    "journal_aliases": self.library.merge_backup(body.get("library"))
                }
            elif action == "groups":
                self.library.save_groups(body.get("groups"))
                result = {"saved": True}
            else:
                ticket = body.get("candidate")
                candidate = (
                    self.candidates.get(ticket) if isinstance(ticket, str) else None
                )
                if not candidate or candidate[0] < time.monotonic():
                    raise ValueError("查询结果已过期，请重新查找期刊")
                journal, existing = self.library.add(
                    candidate[1], body.get("group_id", "")
                )
                result = {"journal_id": journal["id"], "existing": existing}
            self.registry = self.library.registry()
            self.archives.journals = {
                j["id"]: j for j in self.registry["journals"] if j.get("enabled", True)
            }
            self.publish()
        if action == "journals" and not result["existing"]:
            with self.guard:
                if self.status["running"]:
                    self.resync_requested = True
                else:
                    self.start_sync_unlocked()
        return result

    def abstract_article(self, identifier):
        with self.store.get_connection("history") as c:
            row = c.execute(
                "SELECT entry_id AS id,title,doi,link,abstract,journal_id FROM matched_entries WHERE entry_id=?",
                (identifier,),
            ).fetchone()
        return dict(row) if row else self.archives.article(identifier)

    def reading_articles(self, identifiers):
        # Read existing caches only; opening saved items never starts an archive crawl.
        payload = json.loads(
            (self.directory / "site/data.json").read_text(encoding="utf-8")
        )
        recent = {a["id"]: a for a in payload["articles"]}
        articles = []
        aliases = dict(payload.get("reading_aliases", {}))
        for identifier in dict.fromkeys(identifiers):
            canonical = payload.get("reading_aliases", {}).get(identifier, identifier)
            article = recent.get(canonical) or self.archives.article(identifier)
            if article:
                if article.get("doi", "").startswith("10.1037//"):
                    import hashlib
                    from archives import merge_apa_aliases

                    single = self.archives.article(
                        hashlib.sha256(
                            article["doi"].replace("10.1037//", "10.1037/", 1).encode()
                        ).hexdigest()
                    )
                    if single:
                        merged, found_aliases = merge_apa_aliases([article, single])
                        if found_aliases:
                            article = merged[0]
                            aliases.update(found_aliases)
                articles.append(article)
        return self.abstracts.overlay(
            {
                "articles": list({a["id"]: a for a in articles}.values()),
                "reading_aliases": aliases,
            }
        )

    def start_sync(self):
        with self.guard:
            if self.status["running"]:
                return False
            return self.start_sync_unlocked()

    def start_sync_unlocked(self):
        self.abstract_stop.clear()
        self.status.update(
            running=True,
            phase="正在读取云端文章",
            completed=0,
            total=0,
            error=None,
            abstract_stage=None,
            paused=False,
        )
        threading.Thread(
            target=self.sync, daemon=True, name="journal-radar-sync"
        ).start()
        return True

    def pause_abstracts(self):
        if not self.status["running"] or not self.status.get("abstract_stage"):
            return False
        self.abstract_stop.set()
        self.status["phase"] = "正在保存进度并暂停摘要补全"
        return True

    def sync(self):
        try:
            cloud_failed = False
            try:
                payload = cloud_data(self.directory, get)
                if payload.get("generated_at") != self.cloud.get("generated_at"):
                    import_cloud(self.store, self.registry, payload)
                    temp = self.directory / "cloud.json.tmp"
                    temp.write_text(
                        json.dumps(payload, ensure_ascii=False), encoding="utf-8"
                    )
                    temp.replace(self.directory / "cloud.json")
                    self.cloud = payload
                self.publish()
            except Exception as exc:
                cloud_failed = True
                self.status["error"] = (
                    "读取云端失败，继续使用本机历史：" + str(exc)[:160]
                )
            byid = {j["id"]: j for j in self.cloud.get("journals", [])}
            cloud_stamp = self.cloud.get("generated_at")
            stale = (
                not cloud_stamp
                or (
                    dt.datetime.now(dt.timezone.utc)
                    - dt.datetime.fromisoformat(cloud_stamp)
                ).total_seconds()
                > 86400
            )
            jobs = []
            local_health = self.store.health()
            for j in self.registry["journals"]:
                if not j.get("enabled", True):
                    continue
                health = {
                    h["source"]: h for h in byid.get(j["id"], {}).get("health", [])
                }
                h = health.get("rss", {})
                if j.get("rss_url") and (
                    cloud_failed or stale or not h.get("last_success") or h.get("error")
                ):
                    jobs.append((j, "rss", None))
                crossref = health.get("crossref", {})
                if j.get("crossref_enabled", True) and (
                    crossref.get("error") or j["id"] not in byid or j.get("user_added")
                ):
                    last = local_health.get((j["id"], "crossref"), {}).get(
                        "last_success"
                    ) or crossref.get("last_success")
                    jobs.append((j, "crossref", last))
            self.status.update(phase="正在补采文章来源", total=len(jobs))
            attempt = now()

            def fetch(job):
                j, source, last_success = job
                try:
                    return (
                        j,
                        source,
                        (
                            collect_rss(j, getter=public_feed_get)
                            if j.get("user_added")
                            else collect_rss(j)
                        )
                        if source == "rss"
                        else collect_crossref(j, last_success, attempt, 90),
                        None,
                    )
                except Exception as exc:
                    return j, source, [], str(exc)[:200]

            failed = 0
            with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
                for j, source, entries, error in pool.map(fetch, jobs):
                    if not error:
                        self.store.ingest(j, entries)
                    else:
                        failed += 1
                    self.store.record_health(
                        j["id"], source, attempt, error, len(entries)
                    )
                    self.status["completed"] += 1
            self.publish()
            payload = json.loads(
                (self.directory / "site/data.json").read_text(encoding="utf-8")
            )

            def progress(report):
                phase = (
                    "正在批量查询摘要"
                    if report["stage"] == "index"
                    else "正在补查 DOI 与出版商摘要"
                )
                self.status.update(
                    abstract_stage=report["stage"],
                    completed=report["checked"],
                    total=report["total"],
                    phase=f"{phase} · 已补回 {report['found']} 篇",
                )
                if report["found"] != self.status.get("abstract_found"):
                    self.status["abstract_found"] = report["found"]
                    self.status["data_revision"] = (
                        now() + ":abstracts:" + str(report["found"])
                    )

            report = self.abstracts.enrich(payload, self.abstract_stop, progress)
            temp = self.directory / "abstract-progress.json.tmp"
            temp.write_text(json.dumps(report, ensure_ascii=False), encoding="utf-8")
            temp.replace(self.directory / "abstract-progress.json")
            self.publish()
            label = "已暂停，可继续补采" if report["paused"] else "补采完成"
            self.status.update(
                paused=report["paused"],
                abstract_report=report,
                phase=f"{label}：补回 {report['found']} 篇摘要，仍有 {report['remaining']} 篇缺失；文章来源 {len(jobs) - failed}/{len(jobs)} 个成功",
            )
        except Exception as exc:
            self.status.update(phase="本次补采未完成", error=str(exc)[:200])
        finally:
            with self.guard:
                self.status.update(
                    running=False, abstract_stage=None, last_finished=now()
                )
                if self.resync_requested:
                    self.resync_requested = False
                    self.start_sync_unlocked()


def make_handler(app, port):
    origin = f"http://127.0.0.1:{port}"
    files = {p.name for p in (ROOT / "radar/web").iterdir() if p.is_file()}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def trusted(self):
            return (
                self.headers.get("Host") == f"127.0.0.1:{port}"
                and self.headers.get("Origin", origin) == origin
                and self.headers.get("Sec-Fetch-Site", "same-origin")
                not in ("cross-site", "same-site")
            )

        def respond(self, status, body, content_type="application/json; charset=utf-8"):
            if not isinstance(body, bytes):
                body = json.dumps(body, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Security-Policy", "frame-ancestors 'none'")
            try:
                self.end_headers()
                self.wfile.write(body)
            except ConnectionError:
                pass  # Switching years can close the client after a page is cached.

        def do_GET(self):
            if not self.trusted():
                return self.respond(403, {"error": "仅允许本机应用访问"})
            path = urlsplit(self.path).path
            if path == "/api/session":
                return self.respond(
                    200,
                    {
                        "app": "journal-radar-desktop",
                        "version": 1,
                        "token": app.token,
                        **app.status,
                    },
                )
            if path == "/api/reading-articles":
                query = parse_qs(urlsplit(self.path).query)
                ids = query.get("ids", [""])[0].split(",")
                if (
                    set(query) != {"ids"}
                    or len(query["ids"]) != 1
                    or len(ids) > 100
                    or any(not re.fullmatch(r"[a-f0-9]{64}", i) for i in ids)
                ):
                    return self.respond(400, {"error": "阅读记录参数无效"})
                return self.respond(200, app.reading_articles(ids))
            if path == "/data.json":
                return self.respond(
                    200,
                    app.abstracts.overlay(
                        json.loads(
                            (app.directory / "site/data.json").read_text(
                                encoding="utf-8"
                            )
                        )
                    ),
                )
            if path == "/index.json" or CHUNK_PATH.fullmatch(path[1:]):
                file = app.directory / "site" / path[1:]
                if not file.is_file():
                    return self.respond(404, {"error": "文章数据不存在，请更新列表"})
                return self.respond(
                    200,
                    app.abstracts.overlay(json.loads(file.read_text(encoding="utf-8"))),
                )
            name = "index.html" if path == "/" else path[1:]
            if name not in files:
                return self.respond(404, {"error": "Not found"})
            suffix = Path(name).suffix
            mime = {
                ".html": "text/html; charset=utf-8",
                ".js": "text/javascript; charset=utf-8",
                ".css": "text/css; charset=utf-8",
                ".svg": "image/svg+xml",
                ".png": "image/png",
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
                ".webp": "image/webp",
                ".ico": "image/x-icon",
                ".webmanifest": "application/manifest+json",
            }.get(suffix, "application/octet-stream")
            body = (ROOT / "radar/web" / name).read_bytes()
            if name == "index.html":
                body = body.replace(
                    b"<head>",
                    (
                        '<head><meta name="radar-desktop" content="' + origin + '">'
                    ).encode(),
                )
            return self.respond(200, body, mime)

        def do_POST(self):
            if not self.trusted() or not secrets.compare_digest(
                self.headers.get("X-Radar-Token", ""), app.token
            ):
                return self.respond(403, {"error": "无效的本机请求"})
            path = urlsplit(self.path).path
            if path in (
                "/api/library/lookup",
                "/api/library/groups",
                "/api/library/journals",
                "/api/library/restore",
            ):
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                    maximum = 2_000_000 if path.endswith("/restore") else 131072
                    if (
                        not 0 < length <= maximum
                        or self.headers.get("Transfer-Encoding")
                        or self.headers.get("Content-Type", "").split(";")[0]
                        != "application/json"
                    ):
                        raise ValueError("配置请求格式错误或超过大小限制")
                    body = json.loads(self.rfile.read(length))
                    if not isinstance(body, dict):
                        raise ValueError("配置请求格式错误")
                    result = (
                        app.lookup_journals(body)
                        if path.endswith("/lookup")
                        else app.change_library(path.rsplit("/", 1)[1], body)
                    )
                    return self.respond(200, result)
                except (ValueError, TypeError) as exc:
                    return self.respond(400, {"error": str(exc)[:200]})
                except Exception:
                    return self.respond(
                        502, {"error": "期刊来源暂时不可用或配置未能保存，请稍后重试"}
                    )
            if self.headers.get("Content-Length", "0") != "0":
                return self.respond(400, {"error": "请求不应包含正文"})
            if path == "/api/sync":
                return self.respond(202, {"started": app.start_sync()})
            if path == "/api/abstracts/pause":
                return self.respond(202, {"paused": app.pause_abstracts()})
            archive = re.fullmatch(
                r"/api/archive/(\d{4}-\d{3}[\dX]|rss-[a-f0-9]{16})", path
            )
            if archive:
                query = parse_qs(urlsplit(self.path).query)
                if any(
                    k not in ("year", "next", "refresh") or len(v) != 1
                    for k, v in query.items()
                ):
                    return self.respond(400, {"error": "目录查询参数错误"})
                if not app.archive_slot.acquire(blocking=False):
                    return self.respond(
                        429, {"error": "另一份目录正在查询，请稍后重试。"}
                    )
                try:
                    if "year" in query:
                        if not re.fullmatch(r"\d{4}", query["year"][0]):
                            raise ValueError("年份格式错误")
                        result = app.archives.year(
                            archive[1],
                            int(query["year"][0]),
                            advance=query.get("next") == ["1"],
                            refresh=query.get("refresh") == ["1"],
                        )
                        app.abstracts.overlay(result)
                    else:
                        result = app.archives.overview(archive[1])
                    return self.respond(200, result)
                except ValueError as exc:
                    return self.respond(400, {"error": str(exc)[:200]})
                except Exception:
                    return self.respond(
                        502,
                        {
                            "error": "目录来源暂时不可用，已保存的历史目录仍会保留，请稍后重试。"
                        },
                    )
                finally:
                    app.archive_slot.release()
            match = re.fullmatch(r"/api/abstract/([a-f0-9]{64})", path)
            if not match:
                return self.respond(404, {"error": "Not found"})
            article = app.abstract_article(match[1])
            if not article:
                return self.respond(404, {"error": "文章未收录，请先刷新文章"})
            if not app.abstract_slot.acquire(blocking=False):
                return self.respond(429, {"error": "另一篇摘要正在补取，请稍后重试。"})
            try:
                result = app.abstracts.lookup(article)
                return self.respond(200, result)
            except Exception:
                return self.respond(500, {"error": "摘要补取暂时失败，请稍后重试。"})
            finally:
                app.abstract_slot.release()

    return Handler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", default=str(ROOT / ".desktop-data"))
    parser.add_argument("--port", type=int, default=PORT)
    args = parser.parse_args()
    # Bind before touching files: launching twice cannot start two writers on the same database.
    server = ThreadingHTTPServer(("127.0.0.1", args.port), BaseHTTPRequestHandler)
    app = Companion(args.data_dir)
    server.RequestHandlerClass = make_handler(app, args.port)
    app.start_sync()
    server.serve_forever()


if __name__ == "__main__":
    main()
