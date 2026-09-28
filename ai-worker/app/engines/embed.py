"""Image/text embeddings with SigLIP (768-d for siglip-base), L2-normalised."""

from __future__ import annotations

from PIL import Image

from ..config import settings

_model = None
_error: str | None = None


def _load():
    global _model, _error
    if _model is not None or _error is not None:
        return _model
    try:
        import torch  # type: ignore[import-not-found]
        from transformers import AutoModel, AutoProcessor  # type: ignore[import-not-found]

        processor = AutoProcessor.from_pretrained(settings.siglip_model)
        model = AutoModel.from_pretrained(settings.siglip_model).to(settings.device).eval()
        _model = (torch, processor, model)
    except Exception as e:  # noqa: BLE001 - optional dependency / weights missing
        _error = f"SigLIP unavailable: {type(e).__name__}"
    return _model


def available() -> dict:
    return {"engine": settings.siglip_model if _load() else None, "note": _error}


def image_vector(img: Image.Image) -> dict | None:
    m = _load()
    if m is None:
        return None
    torch, processor, model = m
    with torch.no_grad():
        inputs = processor(images=img, return_tensors="pt").to(settings.device)
        feats = model.get_image_features(**inputs)
        feats = feats / feats.norm(dim=-1, keepdim=True)
    return {"vector": [round(float(x), 6) for x in feats[0].tolist()], "model": settings.siglip_model}


def text_vector(text: str) -> dict | None:
    m = _load()
    if m is None:
        return None
    torch, processor, model = m
    with torch.no_grad():
        inputs = processor(text=[text], padding="max_length", return_tensors="pt").to(settings.device)
        feats = model.get_text_features(**inputs)
        feats = feats / feats.norm(dim=-1, keepdim=True)
    return {"vector": [round(float(x), 6) for x in feats[0].tolist()], "model": settings.siglip_model}
