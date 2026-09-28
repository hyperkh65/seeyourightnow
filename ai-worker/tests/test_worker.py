import base64
import importlib
import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("WORKER_TOKEN", "t0ken")
    monkeypatch.setenv("ENABLE_CAPTION", "false")
    import app.config as cfg

    importlib.reload(cfg)
    import app.imaging
    import app.main as main

    importlib.reload(app.imaging)
    importlib.reload(main)
    return TestClient(main.app)


AUTH = {"Authorization": "Bearer t0ken"}


def png_with_box() -> str:
    img = Image.new("RGB", (400, 300), (250, 250, 250))
    for x in range(120, 280):
        for y in range(80, 220):
            img.putpixel((x, y), (20, 90, 200))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def test_health_is_public(client):
    assert client.get("/health").json() == {"status": "OK"}


def test_auth_required(client):
    assert client.get("/capabilities").status_code == 401
    assert client.get("/capabilities", headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert client.get("/capabilities", headers=AUTH).status_code == 200


def test_analyze_localises_subject_and_reports_missing_engines(client):
    r = client.post("/v1/analyze", json={"image_base64": png_with_box()}, headers=AUTH)
    assert r.status_code == 200
    body = r.json()
    box = body["subject"]["box"]
    assert abs(box["x"] - 0.30) < 0.03 and abs(box["y"] - 0.2667) < 0.03
    assert abs(box["w"] - 0.40) < 0.03 and abs(box["h"] - 0.4667) < 0.03
    # Engines that are not installed must be reported, never faked.
    caps = client.get("/capabilities", headers=AUTH).json()
    if caps["ocr"]["engine"] is None:
        assert body["ocr"] is None and body["errors"]["ocr"]
    if caps["embedding"]["engine"] is None:
        assert body["embedding"] is None and body["errors"]["embed"]
    assert body["caption"] is None


def test_rejects_invalid_or_non_image_payloads(client):
    bad = base64.b64encode(b"%PDF-1.4 not an image").decode()
    assert client.post("/v1/analyze", json={"image_base64": bad}, headers=AUTH).status_code == 422
    junk = {"image_base64": "!!!notbase64!!!!!!"}
    assert client.post("/v1/analyze", json=junk, headers=AUTH).status_code == 422


def test_embed_requires_exactly_one_input(client):
    assert client.post("/v1/embed", json={}, headers=AUTH).status_code == 422
    r = client.post("/v1/embed", json={"text": "usb fan"}, headers=AUTH)
    assert r.status_code in (200, 503)
    if r.status_code == 200:
        assert len(r.json()["vector"]) > 0


def test_ais_decodes_position_reports(client):
    sentences = [
        "!AIVDM,1,1,,B,15M67FC000G?ufbE`FepT@3n00Sa,0*5C",
        "!AIVDM,1,1,,A,13u?etPv2;0n:dDPwUM1U1Cb069D,0*23",
        "garbage",
    ]
    r = client.post("/v1/ais/decode", json={"sentences": sentences}, headers=AUTH).json()
    assert len(r["positions"]) == 2
    p = r["positions"][0]
    assert p["mmsi"] == "366053209" and -90 <= p["lat"] <= 90
    assert r["errors"]
