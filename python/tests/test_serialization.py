import datetime as dt
import decimal

from insight_mcp.serialization import canonical_json, to_json_value


def test_stable_json_conversion() -> None:
    value = {
        "decimal": decimal.Decimal("12.340"),
        "date": dt.date(2025, 1, 2),
        "null": None,
        "bytes": b"ok",
    }
    converted = to_json_value(value)
    assert converted == {
        "decimal": "12.340",
        "date": "2025-01-02",
        "null": None,
        "bytes": "base64:b2s=",
    }
    assert canonical_json({"b": 1, "a": 2}) == '{"a":2,"b":1}'
