"""Minimal FIT file writer, for tests only.

`fitdecode` reads FIT files but cannot write them, and there is no Garmin data on this
machine to borrow a real file from. So the test fixtures are *built*: this module emits
a byte-exact FIT binary (header, definition and data messages, both CRCs) that
`fitdecode` then parses with its own profile. That makes `ingest/fitfile.py` testable
end-to-end against the real library rather than against stub objects.

Only the handful of message types the app reads are supported: file_id, record, session.
"""

from __future__ import annotations

import struct
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Sequence

# FIT timestamps count seconds from 1989-12-31T00:00:00Z.
FIT_EPOCH = 631065600

# FIT's own CRC-16 (nibble table variant, from the SDK).
CRC_TABLE = [
    0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401,
    0xA001, 0x6C00, 0x7800, 0xB401, 0x5000, 0x9C01, 0x8801, 0x4400,
]

# Base type ids.
ENUM, UINT8, UINT16, UINT32 = 0x00, 0x02, 0x84, 0x86

GLOBAL_FILE_ID, GLOBAL_SESSION, GLOBAL_RECORD = 0, 18, 20


def crc16(data: bytes, crc: int = 0) -> int:
    for byte in data:
        tmp = CRC_TABLE[crc & 0xF]
        crc = (crc >> 4) & 0x0FFF
        crc = crc ^ tmp ^ CRC_TABLE[byte & 0xF]
        tmp = CRC_TABLE[crc & 0xF]
        crc = (crc >> 4) & 0x0FFF
        crc = crc ^ tmp ^ CRC_TABLE[(byte >> 4) & 0xF]
    return crc & 0xFFFF


def to_fit_time(dt: datetime) -> int:
    return int(dt.replace(tzinfo=dt.tzinfo or timezone.utc).timestamp()) - FIT_EPOCH


_PACK = {ENUM: "<B", UINT8: "<B", UINT16: "<H", UINT32: "<I"}
_SIZE = {ENUM: 1, UINT8: 1, UINT16: 2, UINT32: 4}


def definition(local_type: int, global_num: int, fields: Sequence[tuple[int, int]]) -> bytes:
    """fields: [(field_def_num, base_type)]. Little-endian, one field per entry."""
    out = bytearray()
    out.append(0x40 | local_type)                       # definition message header
    out += struct.pack("<BBHB", 0, 0, global_num, len(fields))
    for field_num, base_type in fields:
        out += struct.pack("<BBB", field_num, _SIZE[base_type], base_type)
    return bytes(out)


def data(local_type: int, fields: Sequence[tuple[int, int]], values: Sequence[int]) -> bytes:
    out = bytearray()
    out.append(local_type & 0x0F)                       # data message header
    for (_, base_type), value in zip(fields, values):
        out += struct.pack(_PACK[base_type], int(value))
    return bytes(out)


FILE_ID_FIELDS = [(0, ENUM), (1, UINT16), (4, UINT32)]          # type, manufacturer, time_created
RECORD_FIELDS = [
    (253, UINT32),   # timestamp
    (5, UINT32),     # distance, scale 100 -> m
    (3, UINT8),      # heart_rate, bpm
    (6, UINT16),     # speed, scale 1000 -> m/s
    (4, UINT8),      # cadence, rpm
    (2, UINT16),     # altitude, scale 5 offset 500 -> m
]
SESSION_FIELDS = [
    (254, UINT16),   # message_index
    (253, UINT32),   # timestamp
    (2, UINT32),     # start_time
    (5, ENUM),       # sport (1 = running)
    (7, UINT32),     # total_elapsed_time, scale 1000 -> s
    (8, UINT32),     # total_timer_time, scale 1000 -> s
    (9, UINT32),     # total_distance, scale 100 -> m
    (16, UINT8),     # avg_heart_rate
    (17, UINT8),     # max_heart_rate
]


def build_fit(
    start: datetime,
    records: Iterable[dict],
    sport: int = 1,
    manufacturer: int = 1,
) -> bytes:
    """`records` items: {offset_s, distance_m, hr, speed_mps, cadence, altitude_m}."""
    records = list(records)
    body = bytearray()

    body += definition(0, GLOBAL_FILE_ID, FILE_ID_FIELDS)
    body += data(0, FILE_ID_FIELDS, [4, manufacturer, to_fit_time(start)])  # 4 = activity

    body += definition(1, GLOBAL_RECORD, RECORD_FIELDS)
    for r in records:
        body += data(1, RECORD_FIELDS, [
            to_fit_time(start) + int(r["offset_s"]),
            round(r["distance_m"] * 100),
            round(r["hr"]),
            round(r["speed_mps"] * 1000),
            round(r.get("cadence", 0)),
            round((r.get("altitude_m", 0.0) + 500.0) * 5),
        ])

    last = records[-1]
    hrs = [r["hr"] for r in records]
    body += definition(2, GLOBAL_SESSION, SESSION_FIELDS)
    body += data(2, SESSION_FIELDS, [
        0,
        to_fit_time(start) + int(last["offset_s"]),
        to_fit_time(start),
        sport,
        round(last["offset_s"] * 1000),
        round(last["offset_s"] * 1000),
        round(last["distance_m"] * 100),
        round(sum(hrs) / len(hrs)),
        round(max(hrs)),
    ])

    header = bytearray()
    header += struct.pack("<BBHI", 14, 0x20, 2140, len(body))
    header += b".FIT"
    header += struct.pack("<H", crc16(bytes(header)))

    out = bytes(header) + bytes(body)
    return out + struct.pack("<H", crc16(out))


def write_fit(path: Path | str, start: datetime, records: Iterable[dict], **kw) -> Path:
    path = Path(path)
    path.write_bytes(build_fit(start, records, **kw))
    return path


def steady_run(
    start: datetime,
    duration_s: int = 2400,
    step_s: int = 10,
    speed_mps: float = 3.0,
    hr_first_half: float = 150,
    hr_second_half: float = 158,
) -> list[dict]:
    """A synthetic 40-minute run with a clean HR step at halfway.

    Deliberately boring: every quantity is exactly predictable, so the assertions on
    distance, average HR and decoupling can be worked out on paper.
    """
    out = []
    for t in range(0, duration_s + 1, step_s):
        out.append({
            "offset_s": t,
            "distance_m": speed_mps * t,
            "hr": hr_first_half if t < duration_s / 2 else hr_second_half,
            "speed_mps": speed_mps,
            "cadence": 172,
            "altitude_m": 10.0,
        })
    return out
