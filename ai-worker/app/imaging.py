"""Safe image decoding: size limits, decompression-bomb protection, EXIF orientation."""

from __future__ import annotations

import base64
import binascii
import io

from PIL import Image, ImageOps

from .config import settings


class ImageError(ValueError):
    pass


def decode_image(b64: str) -> Image.Image:
    try:
        raw = base64.b64decode(b64, validate=True)
    except (binascii.Error, ValueError) as e:
        raise ImageError("image_base64 is not valid base64") from e
    if len(raw) > settings.max_image_bytes:
        raise ImageError("image is too large")
    Image.MAX_IMAGE_PIXELS = settings.max_pixels
    try:
        img = Image.open(io.BytesIO(raw))
        if img.format not in {"JPEG", "PNG", "WEBP", "GIF", "BMP", "TIFF", "MPO"}:
            raise ImageError(f"unsupported image format: {img.format}")
        img.load()
    except Image.DecompressionBombError as e:
        raise ImageError("image has too many pixels") from e
    except ImageError:
        raise
    except Exception as e:  # noqa: BLE001 - any decoder failure is a client error
        raise ImageError("image could not be decoded") from e
    img = ImageOps.exif_transpose(img)
    return img.convert("RGB")
