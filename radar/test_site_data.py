import json
from pathlib import Path
from types import SimpleNamespace
import pytest
from site_data import write_site, expand
from desktop import cloud_data


def test_discovery_bounds_compare_instants_and_omit_unknown_timestamps(tmp_path):
    rows = [
        {"id": f"{i:064x}", "journal_id": journal, "first_seen": stamp}
        for i, (journal, stamp) in enumerate(
            [
                ("one", "2026-09-21T10:00:00+08:00"),
                ("one", "2026-09-21T03:00:00Z"),
                ("two", "invalid"),
                ("two", "2026-09-21T03:00:00Z"),
                ("three", "2026-09-21T10:00:00"),
            ]
        )
    ]
    index = write_site({"articles": rows, "journals": []}, tmp_path, recent_limit=0)
    chunks = {c["journal_id"]: c for c in index["history_chunks"]}
    assert chunks["one"]["first_seen_max"] == "2026-09-21T03:00:00+00:00"
    assert "first_seen_max" not in chunks["two"]
    assert "first_seen_max" not in chunks["three"]
    assert (
        len(
            expand(index, lambda name: json.loads((tmp_path / name).read_text()))[
                "articles"
            ]
        )
        == 5
    )


def test_bounded_recent_and_journal_chunks_preserve_all_metadata(tmp_path):
    rows = [
        {
            "id": f"{i:064x}",
            "journal_id": "0021-9010" if i % 2 else "0093-5301",
            "first_seen": f"2026-09-{i % 20 + 1:02d}",
            "title": f"Paper {i}",
            "abstract": f"Abstract {i}",
            "citation": {"year": "2026"},
        }
        for i in range(703)
    ]
    payload = {"articles": rows, "journals": [], "reading_aliases": {"old": "new"}}
    index = write_site(payload, tmp_path)
    assert len(index["articles"]) == 600 and index["total_articles"] == 703
    assert index["articles"][0]["first_seen"] == "2026-09-20"
    restored = expand(index, lambda name: json.loads((tmp_path / name).read_text()))
    assert {a["id"]: a for a in restored["articles"]} == {a["id"]: a for a in rows}
    assert restored["reading_aliases"] == payload["reading_aliases"]
    assert len(index["history_chunks"]) == 2
    with pytest.raises(ValueError, match="path"):
        expand(
            {
                **index,
                "history_chunks": [
                    {**index["history_chunks"][0], "url": "../history.db"}
                ],
            },
            lambda _: None,
        )
    with pytest.raises(ValueError, match="journal or count"):
        expand(index, lambda _: {"articles": []})


def test_cloud_reuses_unchanged_chunks_and_rejects_incomplete_snapshot(tmp_path):
    rows = [
        {
            "id": f"{i:064x}",
            "journal_id": "0021-9010",
            "first_seen": str(i),
            "title": str(i),
        }
        for i in range(4)
    ]
    source = tmp_path / "source"
    index = write_site({"articles": rows, "journals": []}, source, recent_limit=1)
    calls = []

    def getter(url):
        calls.append(url)
        file = (
            "index.json"
            if url.endswith("/index.json")
            else "articles/" + url.rsplit("/", 1)[1]
        )
        return SimpleNamespace(json=lambda: json.loads((source / file).read_text()))

    assert len(cloud_data(tmp_path / "client", getter)["articles"]) == 4
    assert len(calls) == 2
    calls.clear()
    cloud_data(tmp_path / "client", getter)
    assert len(calls) == 1 and calls[0].endswith("index.json")
    index["total_articles"] = 5
    (source / "index.json").write_text(json.dumps(index))
    with pytest.raises(ValueError, match="Missing or duplicate"):
        cloud_data(tmp_path / "client", getter)
