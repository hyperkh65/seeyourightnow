"""NMEA AIS decoding (pyais, MIT) for self-hosted AIS receivers / feeds."""

from __future__ import annotations

from pyais import decode
from pyais.exceptions import (
    InvalidNMEAMessageException,
    MissingMultipartMessageException,
    UnknownMessageException,
)

POSITION_TYPES = {1, 2, 3, 18, 19, 27}


def decode_sentences(sentences: list[str]) -> dict:
    positions: list[dict] = []
    statics: list[dict] = []
    errors: list[str] = []
    buffer: list[bytes] = []
    for raw in sentences:
        line = raw.strip()
        if not line:
            continue
        buffer.append(line.encode())
        try:
            msg = decode(*buffer)
        except MissingMultipartMessageException:
            continue
        except (InvalidNMEAMessageException, UnknownMessageException, ValueError) as e:
            errors.append(f"{line[:40]}: {type(e).__name__}")
            buffer = []
            continue
        buffer = []
        d = msg.asdict()
        mt = d.get("msg_type")
        if mt in POSITION_TYPES:
            lat, lon = d.get("lat"), d.get("lon")
            if lat is None or lon is None or abs(lat) > 90 or abs(lon) > 180:
                continue
            positions.append(
                {
                    "mmsi": str(d.get("mmsi")),
                    "lat": lat,
                    "lon": lon,
                    "speedKnots": d.get("speed"),
                    "courseDeg": d.get("course"),
                    "headingDeg": None if d.get("heading") in (None, 511) else d.get("heading"),
                    "navStatus": int(d["status"]) if d.get("status") is not None else None,
                }
            )
        elif mt in (5, 24):
            statics.append(
                {
                    "mmsi": str(d.get("mmsi")),
                    "imo": str(d.get("imo")) if d.get("imo") else None,
                    "name": (d.get("shipname") or "").strip() or None,
                    "destination": (d.get("destination") or "").strip() or None,
                }
            )
    return {"positions": positions, "statics": statics, "errors": errors}
