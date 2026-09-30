"""Check the shipped data service against the independent retail oracle."""

from __future__ import annotations

from decimal import Decimal
import json
from pathlib import Path

from insight_mcp.engine import DataEngine
from insight_mcp.models import ComparisonSpec


ROOT = Path(__file__).resolve().parents[2]
EXPECTED = json.loads(Path(__file__).with_name("expected.json").read_text(encoding="utf-8"))


def main() -> None:
    """Verify two high-cardinality comparisons and their source-bound queries."""
    engine = DataEngine(ROOT, timeout_seconds=30)
    baseline = engine.register_source("evals/runs/retail/online-retail-baseline.csv", "csv")["source_id"]
    current = engine.register_source("evals/runs/retail/online-retail-current.csv", "csv")["source_id"]
    expected_before = Decimal(EXPECTED["periods"]["baseline"]["signed_revenue"])
    expected_after = Decimal(EXPECTED["periods"]["current"]["signed_revenue"])
    for role, source_id in (("baseline", baseline), ("current", current)):
        quality = engine.diagnose_table(source_id, "data", metric_columns=["LineRevenue"])
        missing = next((item["count"] for item in quality["findings"]
                        if item["kind"] == "missing" and item["field"] == "CustomerID"), 0)
        if missing != EXPECTED["periods"][role]["missing_customer_rows"]:
            raise AssertionError(f"{role} missing CustomerID count differs from the independent oracle")
        if not engine.verify_query(quality["query_id"])["valid"]:
            raise AssertionError(f"{role} quality query did not verify")
    for dimension in ("Country", "StockCode"):
        spec = ComparisonSpec.model_validate({
            "baseline": {"source_id": baseline, "relation": "data"},
            "current": {"source_id": current, "relation": "data"},
            "columns": [
                {"name": "country", "baseline": "Country", "current": "Country"},
                {"name": "stock", "baseline": "StockCode", "current": "StockCode"},
                {"name": "revenue", "baseline": "LineRevenue", "current": "LineRevenue"},
            ],
            "metrics": [{"name": "signed_revenue", "aggregation": "sum", "field": "revenue"}],
            "dimensions": ["country" if dimension == "Country" else "stock"],
            "top_n": 10,
        })
        result = engine.compare_tables(spec)
        if not engine.verify_query(result["query_id"])["valid"]:
            raise AssertionError(f"{dimension} query did not verify")
        total = result["totals"][0]
        if abs(Decimal(str(total["baseline"])) - expected_before) > Decimal("0.000001"):
            raise AssertionError(f"{dimension} baseline total differs from the independent oracle")
        if abs(Decimal(str(total["current"])) - expected_after) > Decimal("0.000001"):
            raise AssertionError(f"{dimension} current total differs from the independent oracle")
        group_delta = sum((Decimal(str(item["metrics"][0]["delta"])) for item in result["groups"]), Decimal(0))
        if abs(group_delta - (expected_after - expected_before)) > Decimal("0.000001"):
            raise AssertionError(f"{dimension} groups and Other do not reconcile to the total change")
        if result["group_count"] > 10 and result["groups"][-1]["dimensions"] != ["Other"]:
            raise AssertionError(f"{dimension} comparison omitted Other")
        print(f"{dimension}: {result['group_count']} groups, {len(result['rows'])} evidence rows, verified")


if __name__ == "__main__":
    main()
