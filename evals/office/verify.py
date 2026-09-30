"""Check frozen office fixtures and deterministic Insight calculations against an independent CSV oracle."""

from __future__ import annotations

from decimal import Decimal
import json
import sys

from prepare import MANIFEST, ROOT, main as check_manifest

from insight_mcp.engine import DataEngine
from insight_mcp.models import ComparisonSpec, TableSelection


def same(actual: object, expected: str) -> bool:
    if expected == "null":
        return actual is None
    return actual is not None and abs(Decimal(str(actual)) - Decimal(expected)) < Decimal("0.000001")


def verify() -> None:
    sys.argv = [sys.argv[0], "--check"]
    check_manifest()
    cases = json.loads(MANIFEST.read_text(encoding="utf-8"))["cases"]
    engine = DataEngine(ROOT)
    for case in cases:
        baseline = engine.register_source(case["baseline"], "csv", TableSelection())["source_id"]
        current = engine.register_source(case["current"], "csv", TableSelection())["source_id"]
        metric = {key: value for key, value in case["metric"].items() if value is not None}
        spec = ComparisonSpec.model_validate({
            "baseline": {"source_id": baseline, "relation": "data"},
            "current": {"source_id": current, "relation": "data"},
            "columns": case["mapping"], "metrics": [metric], "dimensions": case["dimensions"],
            "top_n": 50,
        })
        result = engine.compare_tables(spec)
        target = case["expected"]
        total = result["totals"][0]
        assert same(total["baseline"], target["baseline"]), case["id"]
        assert same(total["current"], target["current"]), case["id"]
        groups = {"|".join("" if item is None else str(item) for item in group["dimensions"]): group["metrics"][0]
                  for group in result["groups"]}
        assert groups.keys() == target["groups"].keys(), case["id"]
        for label, values in target["groups"].items():
            assert same(groups[label]["baseline"], values["baseline"]), case["id"]
            assert same(groups[label]["current"], values["current"]), case["id"]
        assert engine.verify_query(result["query_id"])["valid"] is True, case["id"]
        config = next(domain for domain in ("Department", "Supplier", "Warehouse")
                      if any(item["baseline"] == domain for item in case["mapping"]))
        key = next(item["baseline"] for item in case["mapping"] if item["name"] == "key")
        for role, source_id in (("baseline", baseline), ("current", current)):
            quality = engine.diagnose_table(source_id, "data", [key])
            expected_quality = case["expected_quality"][role]
            assert quality["row_total"] == expected_quality["rows"], case["id"]
            counts = {item["kind"]: item["count"] for item in quality["findings"]}
            assert counts.get("missing", 0) == expected_quality["missing_entity"], case["id"]
            assert counts.get("duplicate_rows", 0) == expected_quality["duplicate_rows"], case["id"]
            assert counts.get("duplicate_keys", 0) == expected_quality["duplicate_keys"], case["id"]
            assert config in [item["name"] for item in engine.describe_relation(source_id, "data")["columns"]]
    print(f"{len(cases)} deterministic office cases match the independent oracle")


if __name__ == "__main__":
    verify()
