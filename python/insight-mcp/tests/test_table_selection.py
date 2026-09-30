from __future__ import annotations

import csv
from pathlib import Path

import pytest
from openpyxl import Workbook

from insight_mcp.engine import DataEngine, SourceError
from insight_mcp.models import TableSelection


def test_excel_title_row_and_selected_sheet(tmp_path: Path) -> None:
    book = Workbook()
    noise = book.active
    noise.title = "Notes"
    noise.append(["description"])
    sheet = book.create_sheet("Current")
    sheet.append(["Expense report"])
    sheet.append(["Department", "Amount"])
    sheet.append(["Support", 12])
    sheet.append(["Sales", 8])
    sheet.append(["Total", 20])
    book.save(tmp_path / "current.xlsx")

    engine = DataEngine(tmp_path)
    assert engine.preview_table("current.xlsx", "xlsx", "Current")["rows"][1] == ["Department", "Amount"]
    source = engine.register_source(
        "current.xlsx", "xlsx",
        TableSelection(sheet="Current", header_row=2, data_end_row=4),
    )["source_id"]
    assert engine.list_relations(source)["relations"] == ["Current"]
    result = engine.execute_sql(source, 'SELECT SUM("Amount") AS total FROM "Current"')
    assert result["rows"] == [[20]]
    assert engine.verify_query(result["query_id"])["valid"] is True


def test_csv_title_row_and_numeric_types(tmp_path: Path) -> None:
    with (tmp_path / "old.csv").open("w", newline="", encoding="utf-8") as stream:
        writer = csv.writer(stream)
        writer.writerows([["Quarterly expenses"], ["Department", "Amount"], ["A", "10.5"], ["B", "7"], ["Total", "17.5"]])
    engine = DataEngine(tmp_path)
    source = engine.register_source(
        "old.csv", "csv", TableSelection(header_row=2, data_end_row=4)
    )["source_id"]
    assert engine.describe_relation(source, "data")["columns"][1]["type"] == "DOUBLE"
    assert engine.execute_sql(source, "SELECT SUM(Amount) FROM data")["rows"] == [[17.5]]


def test_selection_rejects_unavailable_ranges(tmp_path: Path) -> None:
    (tmp_path / "data.csv").write_text("name,value\nA,1\n", encoding="utf-8")
    engine = DataEngine(tmp_path)
    with pytest.raises(SourceError, match="follow header_row"):
        engine.register_source("data.csv", "csv", TableSelection(header_row=3, data_start_row=2))
    with pytest.raises(SourceError, match="header row is absent"):
        engine.register_source("data.csv", "csv", TableSelection(header_row=4))
