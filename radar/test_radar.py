import datetime as dt
import json
from pathlib import Path
import sys
import pytest

sys.path.insert(0, str(Path(__file__).parent))
from run import (
    RadarStore,
    normalize_crossref,
    normalize_rss,
    collect_crossref,
    collect_rss,
    doi_of,
)

J = {
    "id": "0021-9010",
    "name": "Journal of Applied Psychology",
    "groups": ["hr35", "ft50"],
    "issns": ["0021-9010", "1939-1854"],
}


def paper(
    doi="10.1037/apl0001234", title="An example paper", abstract="A useful abstract"
):
    return {
        "DOI": doi,
        "title": [title],
        "ISSN": ["1939-1854"],
        "abstract": abstract,
        "author": [{"given": "A", "family": "Researcher"}],
        "published-online": {"date-parts": [[2026, 8, 1]]},
        "published-print": {"date-parts": [[2026, 10]]},
        "type": "journal-article",
    }


def test_doi_merge_updates_without_losing_abstract_or_first_seen(tmp_path):
    store = RadarStore(tmp_path)
    item = normalize_crossref(paper(doi="10.1037/APL0001234"), J)
    assert store.ingest(J, [item]) == 1
    with store.get_connection("history") as c:
        before = dict(c.execute("SELECT * FROM matched_entries").fetchone())
    updated = normalize_crossref(paper(title="An updated title", abstract=""), J)
    assert store.ingest(J, [updated]) == 0
    with store.get_connection("history") as c:
        rows = c.execute("SELECT * FROM matched_entries").fetchall()
    assert len(rows) == 1 and rows[0]["title"] == "An updated title"
    assert (
        rows[0]["abstract"] == "A useful abstract"
        and rows[0]["matched_date"] == before["matched_date"]
    )
    assert (
        rows[0]["published_date"] == "2026-08-01" and rows[0]["print_date"] == "2026-10"
    )


def test_citation_metadata_survives_rss_refresh_export_and_cloud_import(tmp_path):
    from desktop import import_cloud

    store = RadarStore(tmp_path / "source")
    record = {
        **paper(),
        "volume": "111",
        "issue": "4",
        "page": "10-29",
        "article-number": "e123",
    }
    store.ingest(J, [normalize_crossref(record, J)])
    store.ingest(
        J,
        [
            normalize_rss(
                {
                    "title": record["title"][0],
                    "doi": record["DOI"],
                    "link": "https://doi.org/" + record["DOI"],
                },
                J,
            )
        ],
    )
    registry = {"journals": [J], "ft50_version": "test", "sources": []}
    payload = store.export(registry, tmp_path / "site")
    citation = payload["articles"][0]["citation"]
    assert citation["authors"] == [{"family": "Researcher", "given": "A"}]
    assert (citation["year"], citation["volume"], citation["pages"]) == (
        "2026",
        "111",
        "10-29",
    )
    destination = RadarStore(tmp_path / "destination")
    import_cloud(destination, registry, payload)
    restored = destination.export(registry, tmp_path / "other-site")
    assert restored["articles"][0]["citation"] == citation


def test_rss_promoted_to_doi_preserves_reading_identity(tmp_path):
    store = RadarStore(tmp_path)
    rss = normalize_rss(
        {
            "title": "An example paper",
            "link": "https://publisher.test/paper",
            "summary": "Abstract",
        },
        J,
    )
    store.ingest(J, [rss])
    with store.get_connection("history") as c:
        identifier = c.execute("SELECT entry_id FROM matched_entries").fetchone()[0]
    assert store.ingest(J, [normalize_crossref(paper(), J)]) == 0
    with store.get_connection("history") as c:
        row = c.execute("SELECT * FROM matched_entries").fetchone()
    assert row["entry_id"] == identifier and row["doi"] == "10.1037/apl0001234"
    assert row["sources"] == "crossref,rss"


def test_different_dois_with_same_title_are_not_collapsed(tmp_path):
    store = RadarStore(tmp_path)
    assert (
        store.ingest(
            J,
            [
                normalize_crossref(paper(doi="10.1000/a", title="Editorial"), J),
                normalize_crossref(paper(doi="10.1000/b", title="Editorial"), J),
            ],
        )
        == 2
    )


def test_generic_rss_titles_keep_separate_issues_and_link_updates(tmp_path):
    store = RadarStore(tmp_path)
    first = normalize_rss(
        {"title": "Editorial", "link": "https://publisher.test/issue1"}, J
    )
    second = normalize_rss(
        {"title": "Editorial", "link": "https://publisher.test/issue2"}, J
    )
    assert store.ingest(J, [first, second]) == 2
    updated = {**first, "title": "Editorial: updated title"}
    assert store.ingest(J, [updated]) == 0
    with store.get_connection("history") as c:
        rows = c.execute("SELECT title FROM matched_entries").fetchall()
    assert {r["title"] for r in rows} == {"Editorial", "Editorial: updated title"}


def test_reject_wrong_journal_and_ignore_reference_doi():
    wrong = paper()
    wrong["ISSN"] = ["1111-1111"]
    with pytest.raises(ValueError):
        normalize_crossref(wrong, J)
    assert doi_of({"summary": "Prior work: https://doi.org/10.1000/another"}) == ""
    assert normalize_rss({"title": "bad", "link": "javascript:alert(1)"}, J) is None
    assert (
        normalize_crossref(
            paper(
                doi="10.1037/apl0001234.supp",
                title="Supplemental Material for An example paper",
            ),
            J,
        )
        is None
    )
    assert (
        normalize_rss(
            {
                "title": "Supplemental Material for A paper",
                "link": "https://publisher.test/supp",
            },
            J,
        )
        is None
    )
    relative = normalize_rss(
        {"title": "HBR article", "link": "/2026/09/example"},
        {**J, "site_url": "https://hbr.org/"},
    )
    assert relative["link"] == "https://hbr.org/2026/09/example"


def test_failure_preserves_checkpoint_and_history(tmp_path):
    store = RadarStore(tmp_path)
    store.ingest(J, [normalize_crossref(paper(), J)])
    store.record_health(J["id"], "rss", "2026-09-01T00:00:00+00:00", None, 1)
    store.record_health(J["id"], "rss", "2026-09-02T00:00:00+00:00", "HTTP 403", 0)
    health = store.health()[J["id"], "rss"]
    assert (
        health["last_success"] == "2026-09-01T00:00:00+00:00"
        and health["error"] == "HTTP 403"
    )
    with store.get_connection("history") as c:
        assert c.execute("SELECT COUNT(*) FROM matched_entries").fetchone()[0] == 1


class Response:
    def __init__(self, items, cursor="next"):
        self.items = items
        self.cursor = cursor

    def json(self):
        return {"message": {"items": self.items, "next-cursor": self.cursor}}


def test_crossref_paginates_and_uses_update_window():
    calls = []

    def getter(url, params):
        calls.append(params)
        return (
            Response([paper(doi=f"10.1000/{i}") for i in range(100)])
            if len(calls) == 1
            else Response([paper(doi="10.1000/last")])
        )

    result = collect_crossref(
        J, "2026-09-10T00:00:00+00:00", "2026-09-13T00:00:00+00:00", 90, getter
    )
    assert len(result) == 101 and calls[1]["cursor"] == "next"
    assert (
        "from-update-date:2026-09-03" in calls[0]["filter"]
        and "from-pub-date" not in calls[0]["filter"]
    )


def test_html_instead_of_rss_is_failure():
    class Html:
        content = b"<html><body>Sign in required</body></html>"

    with pytest.raises(ValueError):
        collect_rss({"rss_url": "https://publisher.test/rss"}, lambda url: Html())


def test_recent_deposit_with_year_only_date_and_precise_rss(tmp_path):
    calls = []
    item = paper()
    item["published-online"] = {"date-parts": [[2026]]}
    item.pop("published-print")

    def getter(url, params):
        calls.append(params["filter"])
        return Response([] if "from-pub-date" in params["filter"] else [item])

    entries = collect_crossref(J, None, "2026-09-13T00:00:00+00:00", 90, getter)
    assert len(calls) == 2 and "from-created-date:2026-06-15" in calls[1]
    assert len(entries) == 1 and entries[0]["published_date"] == "2026"
    store = RadarStore(tmp_path)
    store.ingest(J, entries)
    rss = normalize_rss(
        {
            "title": "An example paper",
            "doi": item["DOI"],
            "link": "https://publisher.test/paper",
        },
        J,
    )
    rss["published_date"] = "2026-07-29"
    store.ingest(J, [rss])
    store.ingest(J, entries)
    with store.get_connection("history") as c:
        row = c.execute(
            "SELECT published_date,online_date FROM matched_entries"
        ).fetchone()
    assert row["published_date"] == "2026-07-29" and row["online_date"] == "2026"


def test_registry_groups_and_identity():
    registry = json.loads(
        (Path(__file__).parent / "journals.json").read_text(encoding="utf-8")
    )
    journals = registry["journals"]
    assert len(journals) == len({j["id"] for j in journals})
    assert len(journals) == 95 and all("core10" not in j["groups"] for j in journals)
    assert {
        g: sum(g in j["groups"] for j in journals) for g in ["hr35", "ft50", "utd24"]
    } == {"hr35": 35, "ft50": 50, "utd24": 24}
    hrm = next(j for j in journals if j["id"] == "0090-4848")
    hrmj = next(j for j in journals if j["id"] == "0954-5395")
    assert hrm["rss_url"] != hrmj["rss_url"]


def test_requested_hr35_journals_are_enabled_with_verified_identity():
    registry = json.loads(
        (Path(__file__).parent / "journals.json").read_text(encoding="utf-8")
    )
    selected = {j["name"]: j for j in registry["journals"] if "hr35" in j["groups"]}
    expected = {
        "Journal of Applied Psychology": "0021-9010",
        "Personnel Psychology": "0031-5826",
        "Academy of Management Journal": "0001-4273",
        "Human Resource Management": "0090-4848",
        "Journal of Management": "0149-2063",
        "Organizational Behavior and Human Decision Processes": "0749-5978",
        "Human Resource Management Journal": "0954-5395",
        "International Journal of Human Resource Management": "0958-5192",
        "Journal of Organizational Behavior": "0894-3796",
        "Academy of Management Review": "0363-7425",
        "Organization Science": "1047-7039",
        "Administrative Science Quarterly": "0001-8392",
        "Journal of Business Research": "0148-2963",
        "Human Resource Management Review": "1053-4822",
        "Journal of Vocational Behavior": "0001-8791",
        "Journal of Business and Psychology": "0889-3268",
        "Personnel Review": "0048-3486",
        "Employee Relations": "0142-5455",
        "Human Resource Development Quarterly": "1044-8004",
        "Human Resource Development International": "1367-8868",
        "Asia Pacific Journal of Human Resources": "1038-4111",
        "International Journal of Manpower": "0143-7720",
        "International Journal of Selection and Assessment": "0965-075X",
        "Management Decision": "0025-1747",
        "European Journal of Training and Development": "2046-9012",
        "Evidence-based HRM: a Global Forum for Empirical Scholarship": "2049-3983",
        "Industrial and Labor Relations Review": "0019-7939",
        "Human Relations": "0018-7267",
        "Group & Organization Management": "1059-6011",
        "New Technology, Work and Employment": "0268-1072",
        "Journal of Managerial Psychology": "0268-3946",
        "Career Development International": "1362-0436",
        "European Management Journal": "0263-2373",
        "Asia Pacific Journal of Management": "0217-4561",
        "International Journal of Contemporary Hospitality Management": "0959-6119",
    }
    assert {name: j["id"] for name, j in selected.items()} == expected
    assert all(
        j["enabled"] and j["crossref_identity_verified"] and j["id"] in j["issns"]
        for j in selected.values()
    )
    all_issns = [issn for j in registry["journals"] for issn in j["issns"]]
    assert len(all_issns) == len(set(all_issns)), "Duplicate journal identities"
