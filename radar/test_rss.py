import socket
from types import SimpleNamespace

import pytest
import requests

import run
from library import FeedHTTPError, public_feed_get
from rss_state import FeedResult
from run import RadarStore, collect_rss

J = {
    "id": "0021-9010",
    "short_name": "JAP",
    "name": "Journal of Applied Psychology",
    "issns": ["0021-9010"],
    "groups": ["hr35"],
    "rss_url": "https://example.org/feed",
    "crossref_enabled": False,
}
XML = b"""<rss version="2.0"><channel><title>JAP</title><link>https://example.org</link>
<description>Research</description><item><title>Leadership and teams</title>
<link>https://example.org/paper</link><guid>https://example.org/paper</guid>
</item></channel></rss>"""


def test_rss_does_not_retry_before_a_server_retry_after_deadline(tmp_path, monkeypatch):
    store = RadarStore(tmp_path)
    response = requests.Response()
    response.status_code = 429
    response.headers["Retry-After"] = "7200"
    calls = []
    monkeypatch.setattr(run, "now", lambda: "2026-09-21T00:00:00+00:00")
    monkeypatch.setattr(
        run.requests, "get", lambda *a, **k: calls.append(a[0]) or response
    )
    monkeypatch.setattr(run.time, "sleep", lambda *a: None)
    assert run.sync({"journals": [J]}, store) == 0
    assert calls == [J["rss_url"]]
    assert store.rss.get(J)["next_check"] == "2026-09-21T02:00:00+00:00"


def test_conditional_sync_survives_restart_and_keeps_articles_on_304(
    tmp_path, monkeypatch
):
    store = RadarStore(tmp_path)
    calls = []
    stamp = ["2026-09-21T00:00:00+00:00"]
    monkeypatch.setattr(run, "now", lambda: stamp[0])

    def getter(url, headers=None):
        calls.append(headers)
        return SimpleNamespace(
            content=XML if len(calls) == 1 else b"not XML; must not be parsed",
            status_code=200 if len(calls) == 1 else 304,
            headers={"ETag": '"v1"', "Last-Modified": "Sun, 20 Sep 2026 00:00:00 GMT"}
            if len(calls) == 1
            else {},
        )

    monkeypatch.setattr(
        run, "collect_rss", lambda journal, **kw: collect_rss(journal, getter, **kw)
    )
    assert run.sync({"journals": [J]}, store) == 1
    assert calls == [None]
    restarted = RadarStore(tmp_path)
    assert run.sync({"journals": [J]}, restarted) is None
    stamp[0] = "2026-09-21T01:00:00+00:00"
    assert run.sync({"journals": [J]}, restarted) == 1
    assert calls[1] == {
        "If-None-Match": '"v1"',
        "If-Modified-Since": "Sun, 20 Sep 2026 00:00:00 GMT",
    }
    assert restarted.health()[J["id"], "rss"]["outcome"] == "unchanged"
    with restarted.get_connection("history") as conn:
        assert (
            conn.execute("SELECT title FROM matched_entries").fetchone()[0]
            == "Leadership and teams"
        )
    assert restarted.rss.options(J)["validators"]["If-None-Match"] == '"v1"'
    changed = {**J, "rss_url": "https://example.org/replaced"}
    assert restarted.rss.options(changed) == {} and restarted.rss.due(changed, stamp[0])


@pytest.mark.parametrize("failure", ["parse", "storage"])
def test_unsaved_responses_do_not_acknowledge_new_validators(
    tmp_path, monkeypatch, failure
):
    store = RadarStore(tmp_path)
    store.rss.record(
        J, "2026-09-20T00:00:00+00:00", FeedResult(headers={"ETag": '"old"'}), None
    )
    monkeypatch.setattr(run, "now", lambda: "2026-09-21T00:00:00+00:00")
    response = SimpleNamespace(
        content=b"<html>Blocked</html>" if failure == "parse" else XML,
        status_code=200,
        headers={"ETag": '"new"'},
    )
    monkeypatch.setattr(
        run,
        "collect_rss",
        lambda journal, **kw: collect_rss(journal, lambda *a, **k: response, **kw),
    )
    if failure == "storage":
        monkeypatch.setattr(
            store, "ingest", lambda *a: (_ for _ in ()).throw(OSError("disk full"))
        )
    assert run.sync({"journals": [J]}, store) == 0
    assert store.rss.options(J)["validators"]["If-None-Match"] == '"old"'
    assert store.rss.get(J)["outcome"] == "error"


def test_per_source_backoff_honors_retry_after_and_does_not_block_other_sources(
    tmp_path,
):
    store = RadarStore(tmp_path)
    stamp = "2026-09-21T00:00:00+00:00"
    store.rss.record(J, stamp, [], ValueError("temporarily unavailable"))
    assert store.rss.get(J)["next_check"] == "2026-09-21T00:15:00+00:00"
    store.rss.record(J, stamp, [], ValueError("still unavailable"))
    assert store.rss.get(J)["next_check"] == "2026-09-21T00:30:00+00:00"
    for value, expected in [
        ("7200", "02:00:00"),
        ("Mon, 21 Sep 2026 03:00:00 GMT", "03:00:00"),
    ]:
        store.rss.record(J, stamp, [], FeedHTTPError(429, {"Retry-After": value}))
        assert store.rss.get(J)["next_check"] == "2026-09-21T" + expected + "+00:00"
    restarted = RadarStore(tmp_path)
    assert not restarted.rss.due(J, "2026-09-21T01:00:00+00:00")
    assert restarted.rss.due({**J, "id": "another"}, stamp)
    restarted.rss.record(J, stamp, FeedResult(), None)
    assert restarted.rss.get(J)["failures"] == 0
    assert restarted.rss.options(J) == {}


def test_secure_fetch_forwards_only_validators_and_returns_304(monkeypatch):
    sent = []
    monkeypatch.setattr(
        socket, "getaddrinfo", lambda *a, **k: [(2, 1, 6, "", ("93.184.216.34", 443))]
    )

    class Pool:
        def __init__(self, host, **kw):
            assert host == "93.184.216.34" and kw["assert_hostname"] == "example.org"

        def __enter__(self):
            return self

        def __exit__(self, *a):
            pass

        def urlopen(self, *a, **kw):
            sent.append(kw["headers"])
            return SimpleNamespace(
                status=304, headers={"ETag": '"v1"'}, close=lambda: None
            )

    monkeypatch.setattr("library.urllib3.HTTPSConnectionPool", Pool)
    response = public_feed_get(
        J["rss_url"],
        headers={"If-None-Match": '"v1"', "Host": "localhost", "Cookie": "private"},
    )
    assert response.status_code == 304 and response.content == b""
    assert sent[0]["If-None-Match"] == '"v1"'
    assert sent[0]["Host"] == "example.org" and "Cookie" not in sent[0]
    with pytest.raises(ValueError, match="304"):
        collect_rss(J, lambda *a: response)
