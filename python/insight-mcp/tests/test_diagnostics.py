from __future__ import annotations

from pathlib import Path

import pytest

from insight_mcp.engine import DataEngine
from insight_mcp.models import ComparisonSpec, TableSelection
from openpyxl import Workbook


def test_quality_samples_keep_original_locations_across_blank_rows(tmp_path: Path) -> None:
    book = Workbook()
    sheet = book.active
    sheet.title = "Expenses"
    sheet.append(["Title"])
    sheet.append(["ID", "Amount"])
    sheet.append([1, 10])
    sheet.append([None, None])
    sheet.append([1, "bad"])
    sheet.append([2, None])
    sheet.append([3, "=SUM(B3)"])
    book.save(tmp_path / "expense.xlsx")
    book.close()
    engine = DataEngine(tmp_path)
    source = engine.register_source("expense.xlsx", "xlsx", TableSelection(sheet="Expenses", header_row=2))["source_id"]
    quality = engine.diagnose_table(source, "Expenses", ["ID"], ["Amount"])
    findings = {item["kind"]: item for item in quality["findings"]}
    assert findings["invalid_numeric"]["samples"][0]["source_row"] == 5
    assert findings["invalid_numeric"]["samples"][0]["cells"] == ["B5"]
    assert findings["invalid_numeric"]["samples"][0]["values"] == {"Amount": "bad"}
    assert findings["invalid_numeric"]["samples"][0]["values_truncated"] is False
    assert [sample["source_row"] for sample in findings["duplicate_keys"]["samples"]] == [3, 5]
    assert findings["formula_cache_missing"]["samples"][0]["cells"] == ["B7"]
    assert findings["formula_cache_missing"]["samples"][0]["sheet"] == "Expenses"
    assert all(item["query_id"] == quality["query_id"] for item in quality["findings"] if "query_id" in item)
    assert engine.verify_query(quality["query_id"])["valid"] is True


def test_csv_samples_respect_region_and_bound_values(tmp_path: Path) -> None:
    (tmp_path / "values.csv").write_text("Title\nID,Value\n0,excluded\n1," + "x" * 220 + "\n\n2,bad\n3,ignored\n", encoding="utf-8")
    engine = DataEngine(tmp_path, diagnostic_sample_limit=1)
    source = engine.register_source("values.csv", "csv", TableSelection(header_row=2, data_start_row=4, data_end_row=6))["source_id"]
    quality = engine.diagnose_table(source, "data", metric_columns=["Value"])
    finding = next(item for item in quality["findings"] if item["kind"] == "invalid_numeric")
    assert finding["count"] == 2
    assert len(finding["samples"]) == 1
    assert finding["samples"][0]["source_row"] == 4
    assert finding["samples"][0]["values"] == {"Value": "x" * 200}
    assert finding["samples"][0]["values_truncated"] is True
    assert len(quality["rows"][0]) == len(quality["columns"])


def test_duplicate_samples_mark_omitted_fields(tmp_path: Path) -> None:
    fields = [f"field_{index}" for index in range(10)]
    row = ",".join(str(index) for index in range(10))
    (tmp_path / "wide.csv").write_text(",".join(fields) + f"\n{row}\n{row}\n", encoding="utf-8")
    engine = DataEngine(tmp_path)
    source = engine.register_source("wide.csv", "csv", TableSelection())["source_id"]
    quality = engine.diagnose_table(source, "data")
    finding = next(item for item in quality["findings"] if item["kind"] == "duplicate_rows")
    assert finding["count"] == 1
    assert [sample["source_row"] for sample in finding["samples"]] == [2, 3]
    assert all(sample["values_truncated"] is True for sample in finding["samples"])
    assert all(list(sample["values"]) == fields[:8] for sample in finding["samples"])
    assert engine.verify_query(quality["query_id"])["valid"] is True


@pytest.mark.parametrize("limit", [0, 11])
def test_quality_sample_limit_rejects_invalid_configuration(tmp_path: Path, limit: int) -> None:
    with pytest.raises(ValueError, match="diagnostic_sample_limit"):
        DataEngine(tmp_path, diagnostic_sample_limit=limit)


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
