"""Bounded recent feed plus immutable, journal-scoped history chunks."""

import hashlib
import json
from collections import defaultdict
from pathlib import Path
import re

RECENT_LIMIT = 600
CHUNK_SIZE = 250
CHUNK_PATH = re.compile(r"articles/[a-f0-9]{64}\.json")


def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(".tmp")
    temp.write_bytes(encoded(value))
    temp.replace(path)


def write_site(payload, destination, recent_limit=RECENT_LIMIT):
    destination = Path(destination)
    rows = sorted(
        payload["articles"],
        key=lambda a: (a.get("first_seen", ""), a["id"]),
        reverse=True,
    )
    recent, older = rows[:recent_limit], rows[recent_limit:]
    grouped = defaultdict(list)
    for row in older:
        grouped[row["journal_id"]].append(row)
    chunks = []
    for journal, articles in sorted(grouped.items()):
        for offset in range(0, len(articles), CHUNK_SIZE):
            items = articles[offset : offset + CHUNK_SIZE]
            body = {"articles": items}
            path = "articles/" + hashlib.sha256(encoded(body)).hexdigest() + ".json"
            write_json(destination / path, body)
            chunks.append({"url": path, "journal_id": journal, "count": len(items)})
    index = {
        **payload,
        "schema_version": 2,
        "articles": recent,
        "total_articles": len(rows),
        "history_chunks": chunks,
    }
    # Keep the legacy endpoint for already-installed desktop clients and old pages.
    write_json(destination / "data.json", payload)
    # Publish the manifest last: a reader never sees chunks not yet written.
    write_json(destination / "index.json", index)
    return index


def expand(index, read_json):
    rows = list(index["articles"])
    for chunk in index.get("history_chunks", []):
        path = chunk["url"]
        if not CHUNK_PATH.fullmatch(path):
            raise ValueError("Invalid history chunk path")
        body = read_json(path)
        items = body.get("articles", [])
        if len(items) != chunk["count"] or any(
            a.get("journal_id") != chunk["journal_id"] for a in items
        ):
            raise ValueError("History chunk does not match its journal or count")
        rows.extend(items)
    if len({a["id"] for a in rows}) != len(rows) or len(rows) != index.get(
        "total_articles", len(rows)
    ):
        raise ValueError("Missing or duplicate history articles")
    return {**index, "articles": rows}
