import gzip
import hashlib
import json
from pathlib import Path
import pytest
from snapshots import pack, unpack, summary, prune
from run import RadarStore, normalize_rss
from abstracts import AbstractService


def test_snapshot_round_trip_keeps_identity_abstracts_and_checkpoints(tmp_path):
    store = RadarStore(tmp_path / "source")
    journal = {"id": "0021-9010", "name": "JAP", "issns": ["0021-9010"], "groups": []}
    store.ingest(
        journal,
        [
            normalize_rss(
                {
                    "title": "Original saved article",
                    "link": "https://example.org/paper",
                    "summary": "Original abstract",
                },
                journal,
            )
        ],
    )
    store.record_health(journal["id"], "rss", "2026-09-20T00:00:00Z", None, 1)
    with store.get_connection("history") as db:
        row = dict(
            db.execute(
                "SELECT entry_id AS id,title,doi FROM matched_entries"
            ).fetchone()
        )
    AbstractService(tmp_path / "source").save(
        row,
        {
            "abstract": "Preserved cached abstract",
            "source": "Publisher",
            "source_url": "https://example.org/paper",
        },
    )
    manifest = pack(tmp_path / "source/history.db", tmp_path / "packed")
    target = tmp_path / "restored/history.db"
    unpack(tmp_path / "packed/history.db.gz", manifest, target)
    assert summary(target) == summary(tmp_path / "source/history.db")
    restored = RadarStore(target.parent)
    with restored.get_connection("history") as db:
        article = dict(db.execute("SELECT * FROM matched_entries").fetchone())
    assert (
        article["entry_id"] == row["id"] and article["abstract"] == "Original abstract"
    )
    assert (
        restored.health()[(journal["id"], "rss")]["last_success"]
        == "2026-09-20T00:00:00Z"
    )
    assert (
        AbstractService(target.parent).cached(row)["abstract"]
        == "Preserved cached abstract"
    )
    broken = {**manifest, "summary": {**manifest["summary"], "articles": 99}}
    before = summary(target)
    with pytest.raises(ValueError, match="do not match"):
        unpack(tmp_path / "packed/history.db.gz", broken, target)
    assert summary(target) == before


def test_corrupt_download_never_replaces_existing_history(tmp_path):
    archive = tmp_path / "broken.gz"
    archive.write_bytes(gzip.compress(b"not sqlite"))
    target = tmp_path / "history.db"
    target.write_bytes(b"keep existing")
    with pytest.raises(ValueError, match="checksum"):
        unpack(archive, {"version": 1, "sha256": "wrong"}, target)
    assert target.read_bytes() == b"keep existing"


def test_retention_preserves_seed_current_and_unrelated_releases(tmp_path, monkeypatch):
    pointer = tmp_path / "pointer.json"
    pointer.write_text(json.dumps({"tag": "radar-data-1-1"}))
    releases = [
        {"tagName": tag, "isDraft": False}
        for tag in [
            "v1.0",
            "radar-data-seed-20260921",
            "radar-data-4-1",
            "radar-data-3-1",
            "radar-data-2-1",
            "radar-data-1-1",
        ]
    ]
    calls = []

    def command(*args):
        if args[:2] == ("release", "list"):
            return json.dumps(releases)
        calls.append(args)
        return ""

    monkeypatch.setattr("snapshots.gh", command)
    prune("owner/repo", pointer, keep=2)
    assert [call[2] for call in calls] == ["radar-data-2-1"]
