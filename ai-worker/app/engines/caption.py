"""Detailed product caption with Florence-2 (opt-in: ENABLE_CAPTION=true)."""

from __future__ import annotations

from PIL import Image

from ..config import settings

_model = None
_error: str | None = None


def _load():
    global _model, _error
    if not settings.enable_caption:
        _error = "caption disabled (ENABLE_CAPTION=false)"
        return None
    if _model is not None or _error is not None:
        return _model
    try:
        import torch  # type: ignore[import-not-found]
        from transformers import AutoModelForCausalLM, AutoProcessor  # type: ignore[import-not-found]

        # Florence-2 ships custom modelling code; pinning the model revision is recommended in production.
        processor = AutoProcessor.from_pretrained(settings.florence_model, trust_remote_code=True)  # noqa: S615
        model = AutoModelForCausalLM.from_pretrained(settings.florence_model, trust_remote_code=True)  # noqa: S615
        _model = (torch, processor, model.to(settings.device).eval())
    except Exception as e:  # noqa: BLE001 - optional dependency
        _error = f"Florence-2 unavailable: {type(e).__name__}"
    return _model


def available() -> dict:
    return {"engine": settings.florence_model if _load() else None, "note": _error}


def run(img: Image.Image) -> dict | None:
    m = _load()
    if m is None:
        return None
    torch, processor, model = m
    task = "<MORE_DETAILED_CAPTION>"
    with torch.no_grad():
        inputs = processor(text=task, images=img, return_tensors="pt").to(settings.device)
        ids = model.generate(
            input_ids=inputs["input_ids"], pixel_values=inputs["pixel_values"], max_new_tokens=160
        )
    text = processor.batch_decode(ids, skip_special_tokens=True)[0].strip()
    return {"text": text, "model": settings.florence_model}
