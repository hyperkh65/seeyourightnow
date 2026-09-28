"""Sourcing OS AI worker.

Endpoints
- GET  /health        liveness (no auth)
- GET  /capabilities  which engines are actually installed/enabled
- POST /v1/analyze    segment · OCR · caption · embedding for one product image
- POST /v1/embed      text or image embedding
- POST /v1/ais/decode NMEA AIS sentences → positions / static data

Engines that are not installed are reported as unavailable with a reason. The worker never
returns placeholder data as if it were a model result.
"""

from __future__ import annotations

import hmac
import logging
import time

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from . import ais
from .config import settings
from .engines import caption, embed, ocr, segment
from .imaging import ImageError, decode_image

log = logging.getLogger("ai-worker")
app = FastAPI(title="Sourcing OS AI worker", version="0.1.0", docs_url=None, redoc_url=None)

if not settings.token and not settings.dev_mode:
    log.warning("WORKER_TOKEN is not set: all authenticated endpoints will reject requests")


def require_token(authorization: str | None = Header(default=None)) -> None:
    if settings.token is None:
        if settings.dev_mode:
            return
        raise HTTPException(status_code=503, detail="worker token not configured")
    expected = f"Bearer {settings.token}"
    if not authorization or not hmac.compare_digest(authorization.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="unauthorized")


class AnalyzeIn(BaseModel):
    image_base64: str = Field(min_length=16)
    tasks: list[str] = Field(default_factory=lambda: ["segment", "ocr", "caption", "embed"], max_length=4)


class EmbedIn(BaseModel):
    text: str | None = Field(default=None, max_length=2000)
    image_base64: str | None = None


class AisIn(BaseModel):
    sentences: list[str] = Field(max_length=5000)


@app.get("/health")
def health() -> dict:
    return {"status": "OK"}


@app.get("/capabilities", dependencies=[Depends(require_token)])
def capabilities() -> dict:
    off = {"engine": None, "note": "disabled"}
    return {
        "segment": segment.available() if settings.enable_segmentation else off,
        "ocr": ocr.available() if settings.enable_ocr else off,
        "embedding": embed.available() if settings.enable_embedding else off,
        "caption": caption.available(),
        "ais": {"engine": "pyais"},
    }


@app.post("/v1/analyze", dependencies=[Depends(require_token)])
def analyze(body: AnalyzeIn) -> dict:
    try:
        img = decode_image(body.image_base64)
    except ImageError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    out: dict = {"size": {"width": img.width, "height": img.height}, "errors": {}, "timings_ms": {}}
    tasks = set(body.tasks)
    subject_img = img

    def timed(name: str, fn):
        t = time.perf_counter()
        try:
            return fn()
        except Exception as e:  # noqa: BLE001 - one engine failing must not fail the request
            log.exception("engine %s failed", name)
            out["errors"][name] = f"{type(e).__name__}"
            return None
        finally:
            out["timings_ms"][name] = round((time.perf_counter() - t) * 1000)

    if "segment" in tasks and settings.enable_segmentation:
        seg = timed("segment", lambda: segment.subject_box(img))
        out["subject"] = seg if seg and seg.get("box") else None
        if seg and seg.get("box"):
            b = seg["box"]
            left, top = int(b["x"] * img.width), int(b["y"] * img.height)
            right, bottom = int((b["x"] + b["w"]) * img.width), int((b["y"] + b["h"]) * img.height)
            if right - left > 16 and bottom - top > 16:
                subject_img = img.crop((left, top, right, bottom))
    if "ocr" in tasks:
        r = timed("ocr", lambda: ocr.run(img)) if settings.enable_ocr else None
        out["ocr"] = r
        if r is None and "ocr" not in out["errors"]:
            out["errors"]["ocr"] = ocr.available()["note"] or "OCR disabled"
    if "caption" in tasks:
        r = timed("caption", lambda: caption.run(subject_img))
        out["caption"] = r
        if r is None and "caption" not in out["errors"]:
            out["errors"]["caption"] = caption.available()["note"] or "caption unavailable"
    if "embed" in tasks:
        r = timed("embed", lambda: embed.image_vector(subject_img)) if settings.enable_embedding else None
        out["embedding"] = r
        if r is None and "embed" not in out["errors"]:
            out["errors"]["embed"] = embed.available()["note"] or "embedding disabled"
    return out


@app.post("/v1/embed", dependencies=[Depends(require_token)])
def embed_endpoint(body: EmbedIn) -> dict:
    if bool(body.text) == bool(body.image_base64):
        raise HTTPException(status_code=422, detail="provide exactly one of text or image_base64")
    if body.text:
        r = embed.text_vector(body.text)
    else:
        try:
            r = embed.image_vector(decode_image(body.image_base64 or ""))
        except ImageError as e:
            raise HTTPException(status_code=422, detail=str(e)) from e
    if r is None:
        raise HTTPException(status_code=503, detail=embed.available()["note"] or "embedding unavailable")
    return r


@app.post("/v1/ais/decode", dependencies=[Depends(require_token)])
def ais_decode(body: AisIn) -> dict:
    return ais.decode_sentences(body.sentences)
