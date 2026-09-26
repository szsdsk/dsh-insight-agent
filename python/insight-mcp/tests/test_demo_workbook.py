from __future__ import annotations

from pathlib import Path

from insight_mcp.engine import DataEngine
from insight_mcp.models import AnalysisSpec


def test_public_sales_workbook_matches_documented_ground_truth() -> None:
    repository = Path(__file__).resolve().parents[3]
    engine = DataEngine(repository)
    source_id = engine.register_source(
        "examples/insight-agent/insight-sales-demo.xlsx", "xlsx"
    )["source_id"]

    assert engine.list_relations(source_id)["relations"] == ["订单", "客户"]

    region = engine.execute_analysis(
        source_id,
        AnalysisSpec.model_validate(
            {
                "relation": "订单",
                "join": {
                    "relation": "客户",
                    "kind": "left",
                    "left": {"relation": "订单", "column": "客户ID"},
                    "right": {"relation": "客户", "column": "客户ID"},
                },
                "dimensions": [
                    {"field": {"relation": "客户", "column": "地区"}}
                ],
                "metrics": [
                    {
                        "aggregation": "sum",
                        "field": {"relation": "订单", "column": "销售额"},
                        "alias": "销售额",
                    }
                ],
                "sort": [{"column": "销售额", "direction": "desc"}],
                "limit": 20,
            }
        ),
    )
    assert region["rows"] == [
        ["西部", 392228],
        ["华南", 304528],
        ["华北", 261128],
        ["华东", 230428],
    ]
    assert engine.verify_query(region["query_id"])["valid"] is True

    monthly = engine.execute_analysis(
        source_id,
        AnalysisSpec.model_validate(
            {
                "relation": "订单",
                "dimensions": [
                    {
                        "field": {"relation": "订单", "column": "订单日期"},
                        "date_grain": "month",
                        "alias": "月份",
                    }
                ],
                "metrics": [
                    {
                        "aggregation": "sum",
                        "field": {"relation": "订单", "column": "销售额"},
                        "alias": "销售额",
                    }
                ],
                "sort": [{"column": "月份", "direction": "asc"}],
                "limit": 20,
            }
        ),
    )
    assert monthly["rows"] == [
        ["2026-01-01", 203747],
        ["2026-02-01", 223149],
        ["2026-03-01", 182860],
        ["2026-04-01", 220844],
        ["2026-05-01", 169155],
        ["2026-06-01", 188557],
    ]
    assert engine.verify_query(monthly["query_id"])["valid"] is True
