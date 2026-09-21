"""Durable collection snapshots in GitHub Releases; Git keeps a small pointer."""

import argparse
from contextlib import closing
import datetime as dt
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import tempfile

PREFIX = "radar-data-"
RETAIN = 14


def gh(*args):
    return subprocess.check_output(["gh", *args], text=True, encoding="utf-8").strip()


def summary(path):
    with closing(
        sqlite3.connect(Path(path).resolve().as_uri() + "?mode=ro", uri=True)
    ) as db:
        if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("History database integrity check failed")
        tables = {
            r[0]
            for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        if not {"matched_entries", "radar_health"} <= tables:
            raise ValueError("Collection tables are missing")
        count, ids, oldest, newest = db.execute(
            "SELECT COUNT(*), COUNT(DISTINCT entry_id), MIN(matched_date), MAX(matched_date) FROM matched_entries"
        ).fetchone()
        if not count or count != ids:
            raise ValueError("History is empty or article identities are duplicated")
        health = [
            list(r)
            for r in db.execute(
                "SELECT journal_id,source,last_attempt,last_success FROM radar_health ORDER BY journal_id,source"
            )
        ]
        abstracts = (
            db.execute("SELECT COUNT(*) FROM radar_abstracts").fetchone()[0]
            if "radar_abstracts" in tables
            else 0
        )
        return {
            "articles": count,
            "oldest_seen": oldest,
            "newest_seen": newest,
            "health": health,
            "abstract_cache_entries": abstracts,
        }


def pack(database, destination):
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    # SQLite backup includes committed WAL state and produces a consistent image.
    with tempfile.TemporaryDirectory() as temporary:
        clean = Path(temporary) / "history.db"
        with (
            closing(
                sqlite3.connect(
                    Path(database).resolve().as_uri() + "?mode=ro", uri=True
                )
            ) as source,
            closing(sqlite3.connect(clean)) as target,
        ):
            source.backup(target)
        info = summary(clean)
        archive = destination / "history.db.gz"
        with (
            clean.open("rb") as source,
            archive.open("wb") as raw,
            gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as target,
        ):
            shutil.copyfileobj(source, target)
    manifest = {
        "version": 1,
        "created_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
        "summary": info,
    }
    (destination / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return manifest


def unpack(archive, manifest, destination):
    archive, destination = Path(archive), Path(destination)
    if manifest.get("version") != 1 or hashlib.sha256(
        archive.read_bytes()
    ).hexdigest() != manifest.get("sha256"):
        raise ValueError("Snapshot checksum or manifest version does not match")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=destination.parent) as temporary:
        clean = Path(temporary) / "history.db"
        with gzip.open(archive, "rb") as source, clean.open("wb") as target:
            total = 0
            while chunk := source.read(1024 * 1024):
                total += len(chunk)
                if total > 2_000_000_000:
                    raise ValueError("Snapshot exceeds the 2 GB recovery limit")
                target.write(chunk)
        if summary(clean) != manifest["summary"]:
            raise ValueError(
                "Recovered article identities, dates, checkpoints or abstracts do not match"
            )
        if destination.exists():
            raise FileExistsError(
                "Recovery destination already exists; restore to a new directory first"
            )
        clean.replace(destination)
    return manifest["summary"]


def download(repo, tag, directory):
    if not re.fullmatch(r"radar-data-[a-zA-Z0-9-]+", tag):
        raise ValueError("Invalid snapshot release tag")
    gh(
        "release",
        "download",
        tag,
        "--repo",
        repo,
        "--dir",
        str(directory),
        "--pattern",
        "history.db.gz",
        "--pattern",
        "manifest.json",
    )
    return json.loads((Path(directory) / "manifest.json").read_text(encoding="utf-8"))


def restore(repo, pointer, destination, legacy):
    pointer, legacy = Path(pointer), Path(legacy)
    if pointer.exists():
        record = json.loads(pointer.read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as temporary:
            manifest = download(repo, record["tag"], temporary)
            if manifest["sha256"] != record["sha256"]:
                raise ValueError(
                    "Snapshot pointer does not match the published manifest"
                )
            return unpack(Path(temporary) / "history.db.gz", manifest, destination)
    if not legacy.exists():
        raise ValueError(
            "No durable snapshot pointer or legacy migration snapshot is available"
        )
    Path(destination).parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as temporary:
        clean = Path(temporary) / "history.db"
        with gzip.open(legacy, "rb") as source, clean.open("wb") as target:
            shutil.copyfileobj(source, target)
        info = summary(clean)
        if Path(destination).exists():
            raise FileExistsError(
                "Recovery destination already exists; restore to a new directory first"
            )
        shutil.copy2(clean, destination)
    return info


def publish_verified(repo, tag, database, pointer):
    if not re.fullmatch(r"radar-data-[a-zA-Z0-9-]+", tag):
        raise ValueError("Invalid snapshot tag")
    with tempfile.TemporaryDirectory() as temporary:
        directory = Path(temporary)
        manifest = pack(database, directory)
        notes = directory / "notes.md"
        notes.write_text(
            "Durable Journal Radar collection snapshot. Includes article identities, abstract cache and source checkpoints.\n\nRecovery instructions: docs/data-recovery.md.\n",
            encoding="utf-8",
        )
        target = (
            os.getenv("GITHUB_SHA")
            or subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
        )
        gh(
            "release",
            "create",
            tag,
            str(directory / "history.db.gz"),
            str(directory / "manifest.json"),
            "--repo",
            repo,
            "--target",
            target,
            "--prerelease",
            "--latest=false",
            "--title",
            "Journal Radar data " + tag[len(PREFIX) :],
            "--notes-file",
            str(notes),
        )
        received = directory / "received"
        received.mkdir()
        remote = download(repo, tag, received)
        if remote != manifest:
            raise ValueError(
                "Uploaded snapshot manifest differs from the local manifest"
            )
        unpack(received / "history.db.gz", remote, directory / "verified.db")
        record = {
            "version": 1,
            "tag": tag,
            "sha256": manifest["sha256"],
            "created_at": manifest["created_at"],
            "articles": manifest["summary"]["articles"],
        }
        Path(pointer).parent.mkdir(parents=True, exist_ok=True)
        Path(pointer).write_text(
            json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        return record


def prune(repo, pointer, keep=RETAIN):
    if keep < 2:
        raise ValueError("At least two snapshots must be retained")
    current = json.loads(Path(pointer).read_text(encoding="utf-8"))["tag"]
    releases = json.loads(
        gh(
            "release",
            "list",
            "--repo",
            repo,
            "--limit",
            "500",
            "--json",
            "tagName,isDraft",
        )
    )
    managed = [
        r["tagName"]
        for r in releases
        if re.fullmatch(r"radar-data-\d+-\d+", r["tagName"]) and not r["isDraft"]
    ]
    # The published pointer and permanent migration seed are never pruned.
    for tag in managed[keep:]:
        if tag != current:
            gh("release", "delete", tag, "--repo", repo, "--yes", "--cleanup-tag")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["restore", "publish", "prune"])
    parser.add_argument(
        "--repo", default=os.getenv("GITHUB_REPOSITORY", "linkingoscar/journal-radar")
    )
    parser.add_argument("--pointer", default="state/snapshot.json")
    parser.add_argument("--database", default="radar-data/history.db")
    parser.add_argument("--legacy", default="state/history.db.gz")
    parser.add_argument("--tag")
    args = parser.parse_args()
    if args.command == "restore":
        if args.tag:
            with tempfile.TemporaryDirectory() as temporary:
                manifest = download(args.repo, args.tag, temporary)
                result = unpack(
                    Path(temporary) / "history.db.gz", manifest, args.database
                )
        else:
            result = restore(args.repo, args.pointer, args.database, args.legacy)
        print(
            json.dumps(
                result,
                ensure_ascii=False,
            )
        )
    elif args.command == "publish":
        print(
            json.dumps(
                publish_verified(args.repo, args.tag, args.database, args.pointer),
                ensure_ascii=False,
            )
        )
    else:
        prune(args.repo, args.pointer)


if __name__ == "__main__":
    main()
