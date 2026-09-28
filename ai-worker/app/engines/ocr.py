"""OCR: PaddleOCR (ch + en, handles Chinese packaging text) when installed."""

from __future__ import annotations

import numpy as np
from PIL import Image

_ocr = None
_error: str | None = None


def _load():
    global _ocr, _error
    if _ocr is not None or _error is not None:
        return _ocr
    try:
        from paddleocr import PaddleOCR  # type: ignore[import-not-found]

        _ocr = PaddleOCR(use_angle_cls=True, lang="ch", show_log=False)
    except Exception as e:  # noqa: BLE001 - optional dependency
        _error = f"PaddleOCR unavailable: {type(e).__name__}"
    return _ocr


def available() -> dict:
    return {"engine": "paddleocr" if _load() else None, "note": _error}


def run(img: Image.Image) -> dict | None:
    ocr = _load()
    if ocr is None:
        return None
    result = ocr.ocr(np.asarray(img), cls=True) or []
    lines: list[str] = []
    for page in result:
        for item in page or []:
            text, score = item[1]
            if score >= 0.6 and text.strip():
                lines.append(text.strip())
    return {"text": "\n".join(lines), "lines": lines, "engine": "paddleocr"}
