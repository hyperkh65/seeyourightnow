"""Worker configuration from environment variables (no secrets are logged)."""

from __future__ import annotations

import os
from dataclasses import dataclass


def _bool(name: str, default: bool) -> bool:
    v = os.getenv(name)
    return default if v is None else v.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    token: str | None
    dev_mode: bool
    max_image_bytes: int
    max_pixels: int
    enable_ocr: bool
    enable_embedding: bool
    enable_caption: bool
    enable_segmentation: bool
    siglip_model: str
    florence_model: str
    device: str


def _secret(name: str) -> str | None:
    """Reads NAME or, following the Docker secrets convention, the file in NAME_FILE."""
    value = os.getenv(name)
    path = os.getenv(f"{name}_FILE")
    if not value and path:
        with open(path, encoding="utf-8") as f:
            value = f.read().strip()
    return value or None


def load() -> Settings:
    return Settings(
        token=_secret("WORKER_TOKEN"),
        dev_mode=_bool("DEV_MODE", False),
        max_image_bytes=int(os.getenv("MAX_IMAGE_BYTES", str(10 * 1024 * 1024))),
        max_pixels=int(os.getenv("MAX_IMAGE_PIXELS", str(40_000_000))),
        enable_ocr=_bool("ENABLE_OCR", True),
        enable_embedding=_bool("ENABLE_EMBEDDING", True),
        enable_caption=_bool("ENABLE_CAPTION", False),
        enable_segmentation=_bool("ENABLE_SEGMENTATION", True),
        siglip_model=os.getenv("SIGLIP_MODEL", "google/siglip-base-patch16-224"),
        florence_model=os.getenv("FLORENCE_MODEL", "microsoft/Florence-2-base"),
        device=os.getenv("DEVICE", "cpu"),
    )


settings = load()
