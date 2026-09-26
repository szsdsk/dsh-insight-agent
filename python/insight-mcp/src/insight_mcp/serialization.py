from __future__ import annotations

import base64
import dataclasses
import datetime as dt
import decimal
import enum
import json
import math
import uuid
from pathlib import Path
from typing import Any


def to_json_value(value: Any) -> Any:
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        if math.isnan(value):
            return "NaN"
        if math.isinf(value):
            return "Infinity" if value > 0 else "-Infinity"
        return value
    if isinstance(value, decimal.Decimal):
        return format(value, "f")
    if isinstance(value, (dt.datetime, dt.date, dt.time)):
        return value.isoformat()
    if isinstance(value, dt.timedelta):
        return value.total_seconds()
    if isinstance(value, bytes):
        return "base64:" + base64.b64encode(value).decode("ascii")
    if isinstance(value, (uuid.UUID, Path, enum.Enum)):
        return str(value.value if isinstance(value, enum.Enum) else value)
    if dataclasses.is_dataclass(value):
        return to_json_value(dataclasses.asdict(value))
    if isinstance(value, dict):
        return {str(key): to_json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_json_value(item) for item in value]
    return str(value)


def canonical_json(value: Any) -> str:
    return json.dumps(
        to_json_value(value),
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    )
