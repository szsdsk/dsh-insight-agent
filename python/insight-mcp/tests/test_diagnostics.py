from __future__ import annotations

from pathlib import Path

import pytest

from insight_mcp.engine import DataEngine
from insight_mcp.models import ComparisonSpec, TableSelection


def test_quality_and_two_source_comparison(tmp_path: Path) -> None:
    (tmp_path / "before.csv").write_text(
        "Department,Amount,ID\nA,10,1\nB,20,2\nB,20,2\n", encoding="utf-8"
    )
    (tmp_path / "after.csv").write_text(
        "Department,Cost,ID\nA,15,1\nC,8,3\n", encoding="utf-8"
    )
    engine = DataEngine(tmp_path)
    before = engine.register_source("before.csv", "csv", TableSelection())["source_id"]
    after = engine.register_source("after.csv", "csv", TableSelection())["source_id"]
    quality = engine.diagnose_table(before, "data", ["ID"], ["Amount"])
    assert quality["row_total"] == 3
    assert {(item["kind"], item["count"]) for item in quality["findings"]} == {
        ("duplicate_rows", 1), ("duplicate_keys", 1)
    }
    assert engine.verify_query(quality["query_id"])["valid"] is True

    spec = ComparisonSpec.model_validate({
        "baseline": {"source_id": before, "relation": "data"},
        "current": {"source_id": after, "relation": "data"},
        "columns": [
            {"name": "department", "baseline": "Department", "current": "Department"},
            {"name": "amount", "baseline": "Amount", "current": "Cost"},
        ],
        "metrics": [{"name": "expense", "aggregation": "sum", "field": "amount"}],
        "dimensions": ["department"],
        "top_n": 2,
    })
    result = engine.compare_tables(spec)
    assert result["sources"][0]["source_id"] == before
    assert result["sources"][1]["source_id"] == after
    assert engine.verify_query(result["query_id"])["valid"] is True
    groups = {tuple(item["dimensions"]): item["metrics"][0] for item in result["groups"]}
    assert groups[("B",)]["delta"] == -40
    assert groups[("C",)]["delta"] == 8
    assert groups[("Other",)]["delta"] == 5
    assert sum(item["metrics"][0]["delta"] for item in result["groups"]) == -27
    assert sum(item["metrics"][0]["contribution_rate"] for item in result["groups"]) == pytest.approx(1)
    assert result["totals"] == [{"name": "expense", "baseline": 50.0, "current": 23.0, "delta": -27.0, "change_rate": -0.54}]

    filtered = engine.compare_tables(ComparisonSpec.model_validate({
        **spec.model_dump(), "filters": [{"field": "department", "operator": "eq", "value": "A"}],
    }))
    assert filtered["totals"][0]["baseline"] == 10
    assert filtered["totals"][0]["current"] == 15
    assert filtered["totals"][0]["delta"] == 5
    assert engine.verify_query(filtered["query_id"])["valid"] is True

    (tmp_path / "after.csv").write_text(
        "Department,Cost,ID\nA,16,1\nC,8,3\n", encoding="utf-8"
    )
    assert engine.verify_query(result["query_id"])["valid"] is False
    assert engine.get_query_result(result["query_id"])["verified"] is False


def test_comparison_rejects_invalid_numeric_mapping(tmp_path: Path) -> None:
    (tmp_path / "before.csv").write_text("Name,Value\nA,5\n", encoding="utf-8")
    (tmp_path / "after.csv").write_text("Name,Value\nA,n/a\n", encoding="utf-8")
    engine = DataEngine(tmp_path)
    before = engine.register_source("before.csv", "csv", TableSelection())["source_id"]
    after = engine.register_source("after.csv", "csv", TableSelection())["source_id"]
    spec = ComparisonSpec.model_validate({
        "baseline": {"source_id": before, "relation": "data"},
        "current": {"source_id": after, "relation": "data"},
        "columns": [{"name": "value", "baseline": "Value", "current": "Value"}],
        "metrics": [{"name": "total", "aggregation": "sum", "field": "value"}],
    })
    with pytest.raises(ValueError, match="incompatible numeric"):
        engine.compare_tables(spec)


def test_zero_baseline_and_non_additive_metric(tmp_path: Path) -> None:
    (tmp_path / "before.csv").write_text("Group,Amount,Buyer\nA,0,x\n", encoding="utf-8")
    (tmp_path / "after.csv").write_text("Group,Amount,Buyer\nA,4,x\nB,8,y\n", encoding="utf-8")
    engine = DataEngine(tmp_path)
    before = engine.register_source("before.csv", "csv", TableSelection())["source_id"]
    after = engine.register_source("after.csv", "csv", TableSelection())["source_id"]
    result = engine.compare_tables(ComparisonSpec.model_validate({
        "baseline": {"source_id": before, "relation": "data"},
        "current": {"source_id": after, "relation": "data"},
        "columns": [
            {"name": "group", "baseline": "Group", "current": "Group"},
            {"name": "amount", "baseline": "Amount", "current": "Amount"},
            {"name": "buyer", "baseline": "Buyer", "current": "Buyer"},
        ],
        "metrics": [
            {"name": "total", "aggregation": "sum", "field": "amount"},
            {"name": "average", "aggregation": "avg", "field": "amount"},
            {"name": "buyers", "aggregation": "count_distinct", "field": "buyer"},
        ],
        "dimensions": ["group"], "top_n": 1,
    }))
    assert result["totals"][0]["baseline"] == 0
    assert result["totals"][0]["current"] == 12
    assert result["totals"][0]["change_rate"] is None
    assert result["totals"][1]["current"] == 6
    assert result["totals"][2]["current"] == 2
    assert result["groups"][-1]["dimensions"] == ["Other"]
    assert result["groups"][-1]["is_other"] is True
    assert result["groups"][-1]["combined_groups"] == 1
    assert result["groups"][-1]["metrics"][0]["delta"] == 4
    assert result["groups"][-1]["metrics"][1]["delta"] is None
    assert result["groups"][-1]["metrics"][1]["contribution_rate"] is None


def test_high_cardinality_groups_keep_top_n_and_other(tmp_path: Path) -> None:
    (tmp_path / "before.csv").write_text(
        "Group,Amount\n" + "".join(f"G{index:03d},1\n" for index in range(250)), encoding="utf-8"
    )
    (tmp_path / "after.csv").write_text(
        "Group,Amount\n" + "".join(f"G{index:03d},2\n" for index in range(250)), encoding="utf-8"
    )
    engine = DataEngine(tmp_path, default_max_rows=20)
    before = engine.register_source("before.csv", "csv")["source_id"]
    after = engine.register_source("after.csv", "csv")["source_id"]
    result = engine.compare_tables(ComparisonSpec.model_validate({
        "baseline": {"source_id": before, "relation": "data"},
        "current": {"source_id": after, "relation": "data"},
        "columns": [{"name": "group", "baseline": "Group", "current": "Group"},
                    {"name": "amount", "baseline": "Amount", "current": "Amount"}],
        "metrics": [{"name": "total", "aggregation": "sum", "field": "amount"}],
        "dimensions": ["group"], "top_n": 5,
    }))
    assert result["group_count"] == 250
    assert len(result["rows"]) == 6
    assert [item["dimensions"] for item in result["groups"][:5]] == [[f"G{index:03d}"] for index in range(5)]
    assert result["groups"][-1]["dimensions"] == ["Other"]
    assert result["groups"][-1]["is_other"] is True
    assert result["groups"][-1]["combined_groups"] == 245
    assert result["groups"][-1]["metrics"][0]["delta"] == 245
    assert sum(item["metrics"][0]["delta"] for item in result["groups"]) == 250
    assert engine.verify_query(result["query_id"])["valid"] is True
