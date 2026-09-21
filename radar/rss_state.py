"""Durable RSS validators and per-source retry deadlines."""

import datetime as dt
from email.utils import parsedate_to_datetime


class FeedResult(list):
    def __init__(self, entries=(), *, headers=None, unchanged=False):
        super().__init__(entries)
        self.headers = {k.lower(): v for k, v in (headers or {}).items()}
        self.unchanged = unchanged


class RSSState:
    def __init__(self, store):
        self.store = store
        with store.get_connection("history") as conn:
            conn.execute("""CREATE TABLE IF NOT EXISTS radar_rss (
                journal_id TEXT PRIMARY KEY, url TEXT NOT NULL,
                etag TEXT, modified TEXT, failures INTEGER NOT NULL,
                next_check TEXT NOT NULL, outcome TEXT NOT NULL)""")

    def get(self, journal):
        with self.store.get_connection("history") as conn:
            row = conn.execute(
                "SELECT * FROM radar_rss WHERE journal_id=? AND url=?",
                (journal["id"], journal["rss_url"]),
            ).fetchone()
            return dict(row) if row else {}

    def due(self, journal, attempt):
        deadline = self.get(journal).get("next_check")
        return not deadline or dt.datetime.fromisoformat(
            attempt
        ) >= dt.datetime.fromisoformat(deadline)

    def options(self, journal):
        row = self.get(journal)
        headers = {
            name: row[key]
            for name, key in [
                ("If-None-Match", "etag"),
                ("If-Modified-Since", "modified"),
            ]
            if row.get(key)
        }
        return {"validators": headers} if headers else {}

    def statuses(self):
        with self.store.get_connection("history") as conn:
            return {
                r["journal_id"]: {
                    "next_check": r["next_check"],
                    "outcome": r["outcome"],
                }
                for r in conn.execute(
                    "SELECT journal_id,next_check,outcome FROM radar_rss"
                )
            }

    def record(self, journal, attempt, result, error):
        old = self.get(journal)
        stamp = dt.datetime.fromisoformat(attempt)
        etag, modified = old.get("etag"), old.get("modified")
        if error:
            failures = old.get("failures", 0) + 1
            delay = min(12 * 3600, 900 * 2 ** min(failures - 1, 6))
            response = getattr(error, "response", None)
            status = getattr(
                response, "status_code", getattr(error, "status_code", None)
            )
            headers = {
                k.lower(): v
                for k, v in getattr(
                    response, "headers", getattr(error, "headers", {})
                ).items()
            }
            if status in (401, 403):
                delay = max(delay, 6 * 3600)
            if status == 429:
                delay = max(delay, 3600)
            retry = headers.get("retry-after", "")
            try:
                seconds = float(retry)
            except (ValueError, TypeError):
                try:
                    seconds = (parsedate_to_datetime(retry) - stamp).total_seconds()
                except (ValueError, TypeError, OverflowError):
                    seconds = 0
            delay = max(delay, min(7 * 86400, seconds))
            outcome = "error"
        else:
            failures, delay = 0, 3600
            unchanged = getattr(result, "unchanged", False)
            headers = getattr(result, "headers", {})

            def validator(key, previous):
                value = headers.get(key, previous if unchanged else None)
                return (
                    value
                    if value
                    and len(value) <= 4096
                    and not any(c in value for c in "\r\n")
                    else None
                )

            etag, modified = (
                validator("etag", etag),
                validator("last-modified", modified),
            )
            outcome = "unchanged" if unchanged else "updated"
        deadline = (stamp + dt.timedelta(seconds=delay)).isoformat(timespec="seconds")
        with self.store.get_connection("history") as conn:
            conn.execute(
                """INSERT INTO radar_rss VALUES(?,?,?,?,?,?,?)
                ON CONFLICT(journal_id) DO UPDATE SET url=excluded.url,etag=excluded.etag,
                modified=excluded.modified,failures=excluded.failures,next_check=excluded.next_check,outcome=excluded.outcome""",
                (
                    journal["id"],
                    journal["rss_url"],
                    etag,
                    modified,
                    failures,
                    deadline,
                    outcome,
                ),
            )
