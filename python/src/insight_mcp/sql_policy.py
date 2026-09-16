from __future__ import annotations

from dataclasses import dataclass

from sqlglot import exp, parse
from sqlglot.errors import ParseError


class SqlPolicyError(ValueError):
    """Raised when SQL is not a single, read-only query."""


_FORBIDDEN_NODE_NAMES = {
    "alter",
    "analyze",
    "attach",
    "cache",
    "command",
    "copy",
    "create",
    "delete",
    "detach",
    "drop",
    "execute",
    "grant",
    "insert",
    "install",
    "load",
    "merge",
    "pragma",
    "revoke",
    "set",
    "transaction",
    "truncate",
    "uncache",
    "update",
    "use",
}

_FORBIDDEN_FUNCTIONS = {
    "delta_scan",
    "glob",
    "httpfs",
    "iceberg_scan",
    "parquet_scan",
    "postgres_scan",
    "read_blob",
    "read_csv",
    "read_csv_auto",
    "read_json",
    "read_json_auto",
    "read_ndjson",
    "read_parquet",
    "sqlite_scan",
}


@dataclass(frozen=True)
class ValidatedSql:
    normalized: str
    statement_count: int = 1


def validate_read_only_sql(sql: str, dialect: str = "duckdb") -> ValidatedSql:
    if not sql.strip():
        raise SqlPolicyError("SQL must not be blank")
    try:
        statements = [item for item in parse(sql, read=dialect) if item is not None]
    except ParseError as error:
        raise SqlPolicyError(f"SQL parse failed: {error}") from error

    if len(statements) != 1:
        raise SqlPolicyError("exactly one SQL statement is required")

    statement = statements[0]
    if not isinstance(statement, exp.Query):
        raise SqlPolicyError("only SELECT or WITH queries are allowed")
    if statement.find(exp.Select) is None:
        raise SqlPolicyError("query must contain SELECT")
    if statement.args.get("into") is not None:
        raise SqlPolicyError("SELECT INTO is not allowed")

    for node in statement.walk():
        node_name = node.__class__.__name__.lower()
        if node_name in _FORBIDDEN_NODE_NAMES:
            raise SqlPolicyError(f"forbidden SQL operation: {node_name.upper()}")
        function_name = _function_name(node)
        if function_name is not None and _is_forbidden_function(function_name):
            raise SqlPolicyError(f"external file or extension function is not allowed: {function_name}")

    return ValidatedSql(normalized=statement.sql(dialect=dialect, pretty=False))


def _function_name(node: exp.Expression) -> str | None:
    if isinstance(node, exp.Anonymous):
        return node.name.lower()
    if isinstance(node, exp.Func):
        return node.sql_name().lower()
    return None


def _is_forbidden_function(name: str) -> bool:
    return (
        name in _FORBIDDEN_FUNCTIONS
        or name.startswith("read_")
        or name.endswith("_scan")
        or name.startswith("http_")
    )
