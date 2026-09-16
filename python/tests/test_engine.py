from __future__ import annotations

from pathlib import Path

import duckdb
import pytest

from insight_mcp.engine import DataEngine
from insight_mcp.security import PathSecurityError
from insight_mcp.sql_policy import SqlPolicyError


def test_csv_discovery_profile_query_and_verify(workspace: Path) -> None:
    engine = DataEngine(workspace)
    source = engine.register_source("sales.csv", "csv")
    source_id = source["source_id"]

    assert engine.list_relations(source_id)["relations"] == ["data"]
    described = engine.describe_relation(source_id, "data")
    assert [column["name"] for column in described["columns"]] == [
        "region",
        "amount",
        "sold_at",
        "note",
    ]
    profile = engine.profile_relation(source_id, "data", ["region", "amount"])
    assert profile["columns"][0]["distinct_count"] == 2

    result = engine.execute_sql(
        source_id,
        "SELECT region, SUM(amount) AS total FROM data GROUP BY region ORDER BY region",
    )
    assert result["rows"] == [["East", 22.0], ["West", 20.0]]
    assert engine.verify_query(result["query_id"])["valid"] is True


def test_sqlite_join_null_and_read_only(workspace: Path) -> None:
    engine = DataEngine(workspace)
    source_id = engine.register_source("shop.sqlite", "sqlite")["source_id"]
    assert engine.list_relations(source_id)["relations"] == ["customers", "orders"]

    result = engine.execute_sql(
        source_id,
        """
        SELECT c.name, COUNT(o.id) AS orders, SUM(o.amount) AS total
        FROM customers c LEFT JOIN orders o ON o.customer_id = c.id
        GROUP BY c.name ORDER BY c.name
        """,
    )
    assert result["rows"] == [["Ada", 2, 12.5], ["Lin", 1, 20.0]]

    with pytest.raises(SqlPolicyError):
        engine.execute_sql(source_id, "DELETE FROM orders")


def test_duckdb_discovery_sample_and_aggregation(workspace: Path) -> None:
    database = workspace / "metrics.duckdb"
    connection = duckdb.connect(str(database))
    connection.execute("CREATE TABLE metrics(category VARCHAR, value INTEGER)")
    connection.execute("INSERT INTO metrics VALUES ('a', 2), ('a', 3), ('b', NULL)")
    connection.close()

    engine = DataEngine(workspace)
    source_id = engine.register_source("metrics.duckdb", "duckdb")["source_id"]
    assert engine.list_relations(source_id)["relations"] == ["metrics"]
    assert engine.describe_relation(source_id, "metrics")["columns"][0]["name"] == "category"
    assert engine.sample_rows(source_id, "metrics", 2)["row_count"] == 2
    result = engine.execute_sql(
        source_id,
        "SELECT category, SUM(value) AS total FROM metrics GROUP BY category ORDER BY category",
    )
    assert result["rows"] == [["a", 5], ["b", None]]


def test_result_truncation_and_stable_query_id(workspace: Path) -> None:
    engine = DataEngine(workspace, default_max_rows=1)
    source_id = engine.register_source("sales.csv", "csv")["source_id"]
    first = engine.execute_sql(source_id, "SELECT region FROM data ORDER BY region")
    second = engine.execute_sql(source_id, "SELECT region FROM data ORDER BY region")
    assert first["truncated"] is True
    assert first["row_count"] == 1
    assert first["query_id"] == second["query_id"]
    assert engine.verify_query(first["query_id"])["warnings"]


def test_rechecks_registered_path_before_each_open(
    workspace: Path, tmp_path_factory: pytest.TempPathFactory
) -> None:
    engine = DataEngine(workspace)
    source_id = engine.register_source("sales.csv", "csv")["source_id"]
    external = tmp_path_factory.mktemp("swap-external") / "sales.csv"
    external.write_text("secret\nvalue\n", encoding="utf-8")
    original = workspace / "sales.csv"
    original.unlink()
    try:
        original.symlink_to(external)
    except OSError:
        pytest.skip("symlink creation is unavailable on this platform")
    with pytest.raises(PathSecurityError, match="inside"):
        engine.list_relations(source_id)
