"""Build a fixed, query-verified expense report payload from the office fixture."""

from __future__ import annotations

import json
from pathlib import Path

from insight_mcp.engine import DataEngine
from insight_mcp.models import ComparisonSpec, TableSelection


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    engine = DataEngine(root)
    baseline = engine.register_source("evals/data/office/expense-baseline.csv", "csv", TableSelection())
    current = engine.register_source("evals/data/office/expense-current.csv", "csv", TableSelection())
    before = engine.diagnose_table(baseline["source_id"], "data", ["Document"], ["Amount"])
    after = engine.diagnose_table(current["source_id"], "data", ["Document"], ["Cost"])
    spec = {
        "baseline": {"source_id": baseline["source_id"], "relation": "data"},
        "current": {"source_id": current["source_id"], "relation": "data"},
        "columns": [
            {"name": "department", "baseline": "Department", "current": "Department"},
            {"name": "project", "baseline": "Project", "current": "Project"},
            {"name": "amount", "baseline": "Amount", "current": "Cost"},
            {"name": "document", "baseline": "Document", "current": "Document"},
        ],
        "metrics": [{"name": "expense", "aggregation": "sum", "field": "amount"}],
        "dimensions": ["department", "project"],
        "top_n": 10,
    }
    comparison = engine.compare_tables(ComparisonSpec.model_validate(spec))
    breakdowns = [engine.compare_tables(ComparisonSpec.model_validate({**spec, "dimensions": [dimension]}))
                  for dimension in spec["dimensions"]]
    for result in [before, after, comparison, *breakdowns]:
        if engine.verify_query(result["query_id"])["valid"] is not True:
            raise RuntimeError(f"query verification failed: {result['query_id']}")
        result["verified"] = True
        result["warnings"] = result.get("source_warnings", [])
    if comparison["totals"][0]["baseline"] != 50 or comparison["totals"][0]["current"] != 63:
        raise RuntimeError("office fixture totals changed")
    report = {
        "formatVersion": 1,
        "id": "3152869d-a213-4548-8e4a-426134c94fbb",
        "taskId": "f9849ca8-d510-4db8-9f2a-4d8588288aa2",
        "ranAt": "2026-09-29T00:00:00.000Z",
        "baseline": baseline,
        "current": current,
        "baselineQuality": before,
        "currentQuality": after,
        "comparison": comparison,
        "dimensionBreakdowns": breakdowns,
    }
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
