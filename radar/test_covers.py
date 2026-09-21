import io
import base64
import json
import threading
import time
from http.server import ThreadingHTTPServer

import pytest
import requests
from PIL import Image, ImageDraw
from covers import CoverService, image_bytes, download, MISS_TTL, ERROR_TTL, MAX_BYTES
from desktop import Companion, make_handler
from run import ROOT

JOURNAL = {
    "id": "0028-0836",
    "name": "Nature",
    "issns": ["0028-0836", "1476-4687"],
    "groups": [],
}


def picture(color="navy", size=(120, 168), format="PNG"):
    image = Image.new("RGB", size, color)
    ImageDraw.Draw(image).rectangle((10, 10, 100, 40), fill="white")
    output = io.BytesIO()
    image.save(output, format=format)
    return output.getvalue()


def service(tmp_path, **kwargs):
    base = json.loads((ROOT / "radar/journals.json").read_text(encoding="utf-8"))[
        "journals"
    ]
    return CoverService(tmp_path, ROOT / "radar/web", base, **kwargs)


def test_manual_cover_backup_restores_pixels_and_preserves_destination_choice(tmp_path):
    source = service(tmp_path / "source")
    source.manual(JOURNAL, picture("red"))
    rows = source.backup([JOURNAL])
    target = service(tmp_path / "target")
    assert target.restore(rows, [JOURNAL]) == {"restored": 1, "preserved": 0}
    restarted = service(tmp_path / "target")
    result = restarted.backup([JOURNAL])
    with Image.open(io.BytesIO(base64.b64decode(result[0]["data"]))) as image:
        assert image.size == (120, 168) and image.getpixel((0, 0)) == (255, 0, 0)
    restarted.manual(JOURNAL, picture("blue"))
    assert restarted.restore(rows, [JOURNAL]) == {"restored": 0, "preserved": 1}
    with Image.open(
        io.BytesIO(base64.b64decode(restarted.backup([JOURNAL])[0]["data"]))
    ) as image:
        assert image.getpixel((0, 0)) == (0, 0, 255)
    missing = restarted.directory / restarted.records[JOURNAL["id"]]["file"]
    missing.unlink()
    with pytest.raises(ValueError, match="缺失"):
        restarted.backup([JOURNAL])


def test_corrupt_or_unknown_backup_cover_does_not_partially_change_index(tmp_path):
    target = service(tmp_path)
    other = {**JOURNAL, "id": "0021-9010", "issns": ["0021-9010"]}
    good = {"journal_id": JOURNAL["id"], "data": base64.b64encode(picture()).decode()}
    bad = {"journal_id": other["id"], "data": base64.b64encode(picture()[:30]).decode()}
    with pytest.raises(ValueError):
        target.restore([good, bad], [JOURNAL, other])
    assert target.records == {} and not target.path.exists()
    with pytest.raises(ValueError):
        target.restore([good, {**good, "journal_id": "../../outside"}], [JOURNAL])
    assert target.records == {}


@pytest.mark.parametrize("size", [(40, 4000), (4000, 40)])
def test_narrow_upload_still_round_trips_through_backup(tmp_path, size):
    source = service(tmp_path / "source")
    source.manual(JOURNAL, picture("red", size=size))
    rows = source.backup([JOURNAL])
    target = service(tmp_path / "target")
    assert target.restore(rows, [JOURNAL])["restored"] == 1
    with Image.open(
        io.BytesIO(base64.b64decode(target.backup([JOURNAL])[0]["data"]))
    ) as restored:
        assert 40 <= restored.width <= 600 and 40 <= restored.height <= 840
        assert restored.getpixel((restored.width // 2, restored.height // 2)) == (
            255,
            0,
            0,
        )


def finish(covers):
    with covers.lock:
        worker = covers.worker
    if worker:
        worker.join(5)
        assert not worker.is_alive(), "Cover worker did not finish"


def test_alias_matching_bundled_reuse_and_success_survive_restart(tmp_path):
    calls = []
    covers = service(
        tmp_path,
        getter=lambda key: calls.append(key)
        or (picture() if key == "1476-4687" else None),
    )
    alias = {"id": "1948-0989", "issns": ["1948-0989"]}
    covers.schedule([alias, JOURNAL])
    assert (
        covers.snapshot([alias])["covers"][alias["id"]]["url"] == "cover-0001-4273.jpg"
    )
    covers.start()
    finish(covers)
    assert calls == JOURNAL["issns"]
    row = covers.snapshot([JOURNAL])["covers"][JOURNAL["id"]]
    assert row["matched_issn"] == "1476-4687" and row["source_url"].endswith(
        "1476-4687.png"
    )
    with Image.open(covers.directory / row["file"]) as image:
        assert image.size == (120, 168) and image.getpixel((0, 0)) == (0, 0, 128)
    restarted = service(
        tmp_path, getter=lambda _: pytest.fail("Cached cover was downloaded again")
    )
    alternate = {**JOURNAL, "id": "1476-4687", "issns": ["1476-4687"]}
    restarted.start()
    restarted.schedule([JOURNAL, alternate])
    assert (
        restarted.snapshot([alternate])["covers"][alternate["id"]]["url"] == row["url"]
    )
    assert restarted.worker is None


@pytest.mark.parametrize(
    "invalid,ttl,status", [(False, MISS_TTL, "missing"), (True, ERROR_TTL, "error")]
)
def test_negative_cache_retries_only_when_due(tmp_path, invalid, ttl, status):
    stamp, calls = [1000], []

    def getter(key):
        calls.append(key)
        return b"<html>not an image</html>" if invalid else None

    covers = service(tmp_path, getter=getter, clock=lambda: stamp[0])
    covers.start()
    covers.schedule([JOURNAL, {"id": "rss-" + "a" * 16, "issns": []}])
    finish(covers)
    assert calls == JOURNAL["issns"]
    assert covers.snapshot([JOURNAL])["covers"][JOURNAL["id"]]["status"] == status
    restarted = service(tmp_path, getter=getter, clock=lambda: stamp[0])
    restarted.start()
    restarted.schedule([JOURNAL])
    assert restarted.worker is None
    stamp[0] += ttl + 1
    restarted.schedule([JOURNAL])
    finish(restarted)
    assert calls == JOURNAL["issns"] * 2


def test_add_is_nonblocking_and_manual_upload_wins_over_running_download(
    tmp_path, monkeypatch
):
    entered, release = threading.Event(), threading.Event()

    def getter(key):
        entered.set()
        assert release.wait(5)
        return picture()

    app = Companion(tmp_path)
    app.covers.getter = getter
    app.covers.start()
    monkeypatch.setattr(app, "start_sync_unlocked", lambda: True)
    app.candidates["verified"] = (time.monotonic() + 60, JOURNAL)
    try:
        result = app.change_library(
            "journals", {"candidate": "verified", "revision": app.library_revision()}
        )
        assert result["journal_id"] == JOURNAL["id"] and entered.wait(2)
        assert (
            app.covers.snapshot([JOURNAL])["covers"][JOURNAL["id"]]["status"]
            == "pending"
        )
        app.covers.manual(JOURNAL, picture("red", format="JPEG"))
    finally:
        release.set()
        finish(app.covers)
    restarted = service(tmp_path)
    row = restarted.snapshot([JOURNAL])["covers"][JOURNAL["id"]]
    assert row["manual"] and row["source"] == "manual"
    with Image.open(restarted.directory / row["file"]) as image:
        red, green, blue = image.getpixel((0, 0))
        assert red > 240 and green < 10 and blue < 10


@pytest.mark.parametrize(
    "raw",
    [
        b"<svg></svg>",
        b"<html>blocked</html>",
        picture(size=(10, 10)),
        picture()[:40],
        b"x" * (MAX_BYTES + 1),
    ],
    ids=["svg", "html", "tiny", "truncated", "oversized"],
)
def test_reject_invalid_uploads(raw):
    with pytest.raises(ValueError):
        image_bytes(raw)


def test_automatic_rejects_logo_shape_and_blank_placeholder():
    with pytest.raises(ValueError):
        image_bytes(picture(size=(120, 120)), automatic=True)
    with pytest.raises(ValueError):
        image_bytes(picture("white"), automatic=True)
    assert image_bytes(picture(size=(120, 120)))  # Manual choice is authoritative.


def test_download_rejects_redirects_and_bounds_stream(monkeypatch):
    class Response:
        status_code = 200
        headers = {"Content-Type": "application/octet-stream"}
        body = picture()

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def raise_for_status(self):
            pass

        def iter_content(self, size):
            yield self.body

    response = Response()

    def request(url, **options):
        assert url == "https://assets.thirdiron.com/images/covers/0028-0836.png"
        assert options["allow_redirects"] is False and options["stream"] is True
        return response

    monkeypatch.setattr("covers.requests.get", request)
    assert Image.open(
        io.BytesIO(image_bytes(download(JOURNAL["id"]), automatic=True))
    ).size == (120, 168)
    response.body = b"x" * (MAX_BYTES + 1)
    with pytest.raises(ValueError):
        download(JOURNAL["id"])
    response.status_code = 302
    with pytest.raises(ValueError):
        download(JOURNAL["id"])
    response.status_code = 404
    assert download(JOURNAL["id"]) is None


def test_cover_api_auth_upload_validation_and_private_storage(tmp_path):
    app = Companion(tmp_path)
    journal = app.registry["journals"][0]
    server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(app, 0))
    server.RequestHandlerClass = make_handler(app, server.server_port)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{server.server_port}"
    endpoint = url + "/api/covers/" + journal["id"]
    headers = {"X-Radar-Token": app.token, "Content-Type": "application/octet-stream"}
    try:
        assert requests.post(endpoint, data=picture()).status_code == 403
        assert (
            requests.post(
                endpoint,
                headers={**headers, "Origin": "https://bad.test"},
                data=picture(),
            ).status_code
            == 403
        )
        assert (
            requests.post(endpoint, headers=headers, data=b"not an image").status_code
            == 400
        )
        assert (
            requests.post(
                url + "/api/covers/0028-0836", headers=headers, data=picture()
            ).status_code
            == 400
        )
        result = requests.post(endpoint, headers=headers, data=picture("red")).json()
        row = result["covers"][journal["id"]]
        assert row["manual"] and row["url"].startswith("/api/covers/image/")
        response = requests.get(url + row["url"])
        assert response.headers["Content-Type"] == "image/png"
        with Image.open(io.BytesIO(response.content)) as image:
            assert image.getpixel((0, 0)) == (255, 0, 0)
        assert requests.get(url + "/api/covers/image/index.json").status_code == 404
        assert (
            requests.get(url + "/api/covers/image/%2e%2e%2flibrary.json").status_code
            == 404
        )
        assert (
            requests.get(
                url + row["url"], headers={"Origin": "https://bad.test"}
            ).status_code
            == 403
        )
        snapshot = requests.get(url + "/api/covers").json()
        assert snapshot["covers"][journal["id"]]["manual"]
        portable = requests.get(url + "/api/covers/backup").json()
        assert portable[0]["journal_id"] == journal["id"]
        endpoint_restore = url + "/api/covers/restore"
        assert requests.post(endpoint_restore, json=portable).status_code == 403
        token = {"X-Radar-Token": app.token}
        assert (
            requests.post(
                endpoint_restore,
                headers={**token, "Origin": "https://bad.test"},
                json=portable,
            ).status_code
            == 403
        )
        response = requests.post(endpoint_restore, headers=token, json=portable)
        assert response.status_code == 200 and response.json() == {
            "restored": 0,
            "preserved": 1,
        }
        assert (
            requests.post(
                endpoint_restore,
                headers=token,
                json=[{**portable[0], "data": "broken"}],
            ).status_code
            == 400
        )
        assert not list((tmp_path / "site").glob("**/covers/index.json"))
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
