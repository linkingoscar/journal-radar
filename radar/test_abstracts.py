import json
import threading
import requests
from types import SimpleNamespace

import pytest
from abstracts import (
    AbstractService,
    allowed_url,
    fetch,
    from_html,
    from_openalex,
    readable_abstract,
    usable_abstract,
    valid_abstract,
)

A = {
    "id": "a" * 64,
    "doi": "10.1000/study",
    "title": "How supportive leadership improves employee wellbeing",
    "link": "https://doi.org/10.1000/study",
    "abstract": "Publication date: September 2026Source: A Journal, Volume 9Author(s): Researcher",
}
TEXT = (
    "We examined how supportive leadership affects employee wellbeing across different organizational contexts. "
    "Our longitudinal study found that consistent support improves engagement and reduces employee turnover over time."
)


def test_background_and_batch_skip_legacy_container_metadata_without_requests(tmp_path):
    def getter(url):
        raise AssertionError("Container metadata must not request an abstract")

    service = AbstractService(tmp_path, getter)
    payload = {
        "articles": [{**A, "journal_id": "0021-9010", "article_type": "journal"}],
        "journals": [{"id": "0021-9010", "groups": ["hr35"]}],
    }
    assert service.batch(payload) == {"checked": 0, "found": 0}
    report = service.enrich(payload, threading.Event(), lambda _: None)
    assert report["missing_before"] == report["remaining"] == report["checked"] == 0


def work(article=A):
    index = {}
    for i, word in enumerate(TEXT.split()):
        index.setdefault(word, []).append(i)
    return {
        "id": "https://openalex.org/W123",
        "doi": "https://doi.org/" + article["doi"],
        "title": article["title"],
        "abstract_inverted_index": index,
    }


def test_metadata_is_not_an_abstract_and_index_requires_exact_identity_and_complete_positions():
    assert not readable_abstract(A["abstract"])
    assert readable_abstract(A["abstract"] + " Abstract " + TEXT) == TEXT
    assert not readable_abstract("A Journal, Volume 9, Issue 2")
    assert from_openalex(work(), A) == TEXT
    assert not from_openalex({**work(), "doi": "10.1000/other"}, A)
    assert not from_openalex(
        {**work(), "title": "A completely different research paper"}, A
    )
    assert not from_openalex(
        {**work(), "abstract_inverted_index": {"bad": [900000000]}}, A
    )
    assert not from_openalex({**work(), "abstract_inverted_index": {"missing": [1]}}, A)


def test_html_only_accepts_matching_article_abstracts_not_related_articles_or_teasers():
    metadata = '<meta name="citation_doi" content="10.1000/study">'
    assert (
        from_html(
            metadata
            + '<section id="abstract"><h2>Abstract</h2><p>'
            + TEXT
            + "</p></section>",
            A,
        )
        == TEXT
    )
    assert (
        from_html(
            metadata + '<meta name="citation_abstract" content="' + TEXT + '">', A
        )
        == TEXT
    )
    assert not from_html(
        metadata.replace("10.1000/study", "10.1000/other")
        + '<div class="abstract">'
        + TEXT
        + "</div>",
        A,
    )
    assert not from_html(
        '<meta property="og:description" content="'
        + TEXT
        + '"><div>'
        + TEXT
        + "</div>",
        A,
    )
    assert not from_html(metadata + '<div class="abstract">' + TEXT + "...</div>", A)
    ld = {"@type": "ScholarlyArticle", "headline": A["title"], "abstract": TEXT}
    assert (
        from_html(
            '<script type="application/ld+json">' + json.dumps(ld) + "</script>", A
        )
        == TEXT
    )
    assert not from_html(
        '<script type="application/ld+json">'
        + json.dumps({**ld, "headline": "Another study"})
        + "</script>",
        A,
    )


def test_obvious_fragments_are_not_usable_but_short_intact_abstracts_are_preserved():
    for text in ("= 37,105). " + TEXT, TEXT + "...", "…" + TEXT):
        assert readable_abstract(text) == text
        assert not usable_abstract(text)
        assert not valid_abstract(text)
    assert usable_abstract("An intact short abstract.") == "An intact short abstract."
    assert usable_abstract("Results differed (p < .05), with an effect > 0.")


def test_fragment_cache_is_retried_and_replaced_only_by_a_valid_identity_matched_abstract(
    tmp_path, monkeypatch
):
    monkeypatch.setattr("abstracts.time.sleep", lambda _: None)
    fragment = "= 37,105). " + TEXT
    article = {**A, "abstract": fragment}
    service = AbstractService(
        tmp_path, lambda url: (json.dumps({"results": [work()]}), url)
    )
    service.save(
        article,
        {
            "abstract": fragment,
            "status": "found",
            "source": "Crossref",
            "source_url": A["link"],
        },
    )
    assert service.due(article)
    assert (
        service.overlay({"articles": [dict(article)]})["articles"][0]["abstract"]
        == fragment
    )
    assert service.batch({"articles": [article]}) == {"checked": 1, "found": 1}
    restored = service.overlay({"articles": [dict(article)]})["articles"][0]
    assert restored["abstract"] == TEXT and restored["abstract_source"] == "OpenAlex"
    assert article["abstract"] == fragment


def test_batch_persists_and_overlays_without_overwriting_source_abstract(tmp_path):
    calls = []

    def getter(url):
        calls.append(url)
        return json.dumps({"results": [work()]}), url

    service = AbstractService(tmp_path, getter)
    assert service.batch({"articles": [A]}, 500) == {"checked": 1, "found": 1}
    assert service.batch({"articles": [A]}, 500) == {"checked": 0, "found": 0}
    restored = AbstractService(
        tmp_path, lambda url: pytest.fail("Cache should avoid network")
    )
    result = restored.overlay({"articles": [dict(A)]})["articles"][0]
    assert result["abstract"] == TEXT and result["abstract_source"] == "OpenAlex"
    assert restored.lookup(A)["cached"]
    # A concurrent failure must not erase a successful result.
    restored.save(A, {"abstract": "", "status": "unavailable"})
    assert restored.cached(A)["abstract"] == TEXT
    assert (
        restored.overlay(
            {"articles": [{**A, "abstract": "An existing publisher abstract."}]}
        )["articles"][0]["abstract"]
        == "An existing publisher abstract."
    )
    assert restored.cached({**A, "doi": "10.1000/new"}) is None
    assert len(calls) == 1


def test_missing_index_still_allows_publisher_lookup_and_failures_are_cached(tmp_path):
    calls = []

    def getter(url):
        calls.append(url)
        if "/works?" in url:
            return '{"results":[]}', url
        if "api.openalex" in url:
            return json.dumps({**work(), "abstract_inverted_index": None}), url
        if "api.crossref" in url:
            return '{"message":{}}', url
        return (
            '<meta name="citation_doi" content="10.1000/study"><div class="abstract">'
            + TEXT
            + "</div>",
            "https://onlinelibrary.wiley.com/doi/10.1000/study",
        )

    service = AbstractService(tmp_path, getter)
    assert service.batch({"articles": [A]})["found"] == 0
    assert service.lookup(A)["source"] == "出版商网页"
    count = len(calls)
    assert service.lookup(A)["cached"] and len(calls) == count
    missing = {**A, "id": "b" * 64, "doi": "10.1000/missing"}
    assert service.lookup(missing)["status"] == "unavailable"
    count = len(calls)
    assert service.lookup(missing)["cached"] and len(calls) == count


def test_public_fetch_rejects_untrusted_destinations_and_redirects(monkeypatch):
    for url in (
        "http://doi.org/10.1000/x",
        "https://127.0.0.1/",
        "https://api.openalex.org.evil.test/",
        "https://user:password@doi.org/x",
        "https://doi.org:8766/x",
        "https://evil.test/",
    ):
        assert not allowed_url(url)

    class Redirect:
        status_code = 302
        headers = {"Location": "https://127.0.0.1/admin"}

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

    calls = []

    def get(url, **kwargs):
        calls.append(url)
        return Redirect()

    monkeypatch.setattr("abstracts.requests.get", get)
    with pytest.raises(ValueError, match="支持范围"):
        fetch(A["link"])
    assert calls == [A["link"]]


def test_bilingual_title_exception_requires_same_doi_and_known_journal():
    english = {**A, "doi": "10.1111/1911-3846.99999", "journal_id": "0823-9150"}
    bilingual = {
        **english,
        "title": A["title"]
        + " Comment le leadership améliore le bien-être des employés",
    }
    assert from_openalex(work(english), bilingual) == TEXT
    assert not from_openalex(work(english), {**bilingual, "journal_id": "0021-9010"})
    assert not from_openalex(
        work(english), {**bilingual, "doi": "10.1111/1911-3846.88888"}
    )
    assert not from_openalex({**work(english), "title": "How supportive"}, bilingual)


def test_doi_resolution_is_unique_and_journal_verified_and_survives_restart(
    tmp_path, monkeypatch
):
    monkeypatch.setattr("abstracts.time.sleep", lambda _: None)
    article = {**A, "doi": "", "journal_id": "0021-9010"}
    record = {
        "DOI": A["doi"],
        "title": [A["title"]],
        "type": "journal-article",
        "ISSN": ["0021-9010"],
    }
    records = [record]

    def getter(url):
        if "api.crossref.org/journals/" in url:
            return json.dumps({"message": {"items": records}}), url
        if "api.openalex.org" in url:
            return json.dumps(work()), url
        pytest.fail("Unexpected source " + url)

    service = AbstractService(tmp_path, getter)
    records.append({**record, "DOI": "10.1000/ambiguous"})
    assert service.resolve_doi(article) is None
    records[:] = [{**record, "ISSN": ["9999-9999"]}]
    assert service.resolve_doi(article) is None
    records[:] = [record]
    assert service.lookup(article)["abstract"] == TEXT
    restored = AbstractService(tmp_path, lambda _: pytest.fail("Should reuse cache"))
    result = restored.overlay({"articles": [dict(article)]})["articles"][0]
    assert result["id"] == article["id"] and result["doi"] == ""
    assert result["resolved_doi"] == A["doi"] and result["abstract"] == TEXT
    assert restored.lookup(article)["cached"]


def test_source_backoff_persists_and_other_sources_remain_available(
    tmp_path, monkeypatch
):
    from abstracts import SourceDeferred

    monkeypatch.setattr("abstracts.time.sleep", lambda _: None)
    calls = []

    def getter(url):
        calls.append(url)
        if "wiley.com" in url:
            response = requests.Response()
            response.status_code = 429
            response.url = url
            response.headers["Retry-After"] = "600"
            raise requests.HTTPError(response=response)
        return "ok", url

    service = AbstractService(tmp_path, getter)
    with pytest.raises(SourceDeferred) as error:
        service.request("https://onlinelibrary.wiley.com/a")
    assert error.value.reason == "rate_limited"
    restored = AbstractService(tmp_path, getter)
    with pytest.raises(SourceDeferred):
        restored.request("https://onlinelibrary.wiley.com/b")
    assert len(calls) == 1
    assert restored.request("https://api.openalex.org/works")[0] == "ok"


def test_aom_http_redirect_is_upgraded_before_request(monkeypatch):
    class Response:
        encoding = "utf-8"

        def __init__(self, status, headers):
            self.status_code = status
            self.headers = headers

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def raise_for_status(self):
            pass

        def iter_content(self, _):
            return [b"<html></html>"]

    calls = []

    def get(url, **kwargs):
        calls.append(url)
        return (
            Response(
                302, {"Location": "http://journals.aom.org/doi/full/10.1000/study"}
            )
            if len(calls) == 1
            else Response(200, {})
        )

    monkeypatch.setattr("abstracts.requests.get", get)
    assert fetch(A["link"])[1] == "https://journals.aom.org/doi/full/10.1000/study"
    assert all(url.startswith("https://") for url in calls)


def test_background_queue_prioritizes_hr35_and_resumes_without_repeating_done_items(
    tmp_path, monkeypatch
):
    monkeypatch.setattr("abstracts.time.sleep", lambda _: None)
    first = {**A, "abstract": "", "journal_id": "0021-9010", "sources": "crossref"}
    second = {
        **first,
        "id": "b" * 64,
        "doi": "10.1000/second",
        "journal_id": "9999-9999",
        "link": "https://doi.org/10.1000/second",
    }
    payload = {
        "journals": [
            {
                "id": first["journal_id"],
                "issns": [first["journal_id"]],
                "groups": ["hr35"],
            },
            {"id": second["journal_id"], "issns": [second["journal_id"]], "groups": []},
        ],
        "articles": [second, first],
    }
    calls = []
    stop = threading.Event()

    def getter(url):
        calls.append(url)
        if "api.openalex.org" in url:
            return '{"results":[]}', url
        identifier = "10.1000/second" if "second" in url else A["doi"]
        return (
            '<meta name="citation_doi" content="'
            + identifier
            + '"><div class="abstract">'
            + TEXT
            + "</div>",
            url,
        )

    service = AbstractService(tmp_path, getter)

    def progress(report):
        if report["stage"] == "pages" and report["checked"] == 1:
            stop.set()

    report = service.enrich(payload, stop, progress)
    assert report["paused"] and report["found"] == 1 and report["remaining"] == 1
    assert first["abstract"] == TEXT and second["abstract"] == ""
    assert calls[-1] == first["link"]
    stop.clear()
    calls.clear()
    report = service.enrich(payload, stop, lambda _: None)
    assert report["found"] == 1 and report["remaining"] == 0 and not report["paused"]
    assert calls == [second["link"]]
