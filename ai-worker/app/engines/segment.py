"""Subject (product) localisation.

Preferred: rembg (U^2-Net) foreground mask when installed.
Fallback: a deterministic border-colour difference box computed with Pillow/NumPy.
The fallback is a real algorithm (not a mock) and is labelled as such in the response.
"""

from __future__ import annotations

import numpy as np
from PIL import Image

_rembg = None
_rembg_error: str | None = None


def _load_rembg():
    global _rembg, _rembg_error
    if _rembg is not None or _rembg_error is not None:
        return _rembg
    try:
        from rembg import new_session, remove  # type: ignore[import-not-found]

        _rembg = (new_session("u2netp"), remove)
    except Exception as e:  # noqa: BLE001 - optional dependency
        _rembg_error = f"rembg unavailable: {type(e).__name__}"
    return _rembg


def available() -> dict:
    return {"engine": "rembg" if _load_rembg() else "border-diff", "note": _rembg_error}


def _bbox_from_mask(mask: np.ndarray) -> dict | None:
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return None
    h, w = mask.shape
    x0, x1, y0, y1 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
    return {"x": x0 / w, "y": y0 / h, "w": (x1 - x0 + 1) / w, "h": (y1 - y0 + 1) / h}


def subject_box(img: Image.Image) -> dict:
    small = img.copy()
    small.thumbnail((512, 512))
    r = _load_rembg()
    if r is not None:
        session, remove = r
        out = remove(small, session=session, only_mask=True)
        mask = np.asarray(out) > 127
        box = _bbox_from_mask(mask)
        return {"box": box, "engine": "rembg-u2netp"}
    arr = np.asarray(small).astype(np.int16)
    border = np.concatenate([arr[0, :], arr[-1, :], arr[:, 0], arr[:, -1]])
    bg = np.median(border, axis=0)
    diff = np.abs(arr - bg).sum(axis=2)
    mask = diff > 60
    # Ignore tiny specks: require at least 0.5% of pixels.
    if mask.mean() < 0.005:
        return {"box": None, "engine": "border-diff"}
    return {"box": _bbox_from_mask(mask), "engine": "border-diff"}
