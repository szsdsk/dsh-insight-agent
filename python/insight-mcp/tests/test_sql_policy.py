import pytest

from insight_mcp.sql_policy import SqlPolicyError, validate_read_only_sql


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT 1",
        "WITH totals AS (SELECT 1 AS n) SELECT n FROM totals",
        "SELECT 1 UNION ALL SELECT 2",
    ],
)
def test_allows_read_only_queries(sql: str) -> None:
    assert validate_read_only_sql(sql).statement_count == 1


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT 1; SELECT 2",
        "INSERT INTO x VALUES (1)",
        "UPDATE x SET y = 1",
        "DELETE FROM x",
        "CREATE TABLE x(y INT)",
        "DROP TABLE x",
        "ATTACH 'outside.db' AS other",
        "COPY x TO 'outside.csv'",
        "INSTALL httpfs",
        "LOAD httpfs",
        "PRAGMA version",
        "SELECT * FROM read_csv_auto('outside.csv')",
        "SELECT * FROM read_parquet('https://example.com/a.parquet')",
        "SELECT read_text('outside.txt')",
        "SELECT * FROM sqlite_scan('outside.db', 'x')",
        "SELECT * FROM postgres_scan('host=outside', 'public', 'x')",
    ],
)
def test_rejects_unsafe_sql(sql: str) -> None:
    with pytest.raises(SqlPolicyError):
        validate_read_only_sql(sql)
