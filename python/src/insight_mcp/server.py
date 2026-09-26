from __future__ import annotations

from typing import Any, Literal

from mcp.server.fastmcp import FastMCP

from .engine import DataEngine
from .models import AnalysisSpec


mcp = FastMCP(
    "InsightAgent Data",
    instructions=(
        "Read-only analytics over CSV, SQLite, and DuckDB files inside the current "
        "workspace. Register a source, inspect it, execute a SELECT/WITH query, "
        "then verify the returned query_id before submitting conclusions."
    ),
)
_engine: DataEngine | None = None


def engine() -> DataEngine:
    global _engine
    if _engine is None:
        _engine = DataEngine.from_environment()
    return _engine


@mcp.tool(structured_output=True)
def register_source(path: str, kind: Literal["csv", "xlsx", "sqlite", "duckdb"]) -> dict[str, Any]:
    """Register a workspace-local data file and return its opaque source_id."""
    return engine().register_source(path, kind)


@mcp.tool(structured_output=True)
def list_relations(source_id: str) -> dict[str, Any]:
    """List tables or controlled views available in a registered source."""
    return engine().list_relations(source_id)


@mcp.tool(structured_output=True)
def describe_relation(source_id: str, relation: str) -> dict[str, Any]:
    """Return column names, types, nullability, and primary-key metadata."""
    return engine().describe_relation(source_id, relation)


@mcp.tool(structured_output=True)
def profile_relation(
    source_id: str,
    relation: str,
    columns: list[str] | None = None,
) -> dict[str, Any]:
    """Return null, distinct, range, and numeric mean statistics for columns."""
    return engine().profile_relation(source_id, relation, columns)


@mcp.tool(structured_output=True)
def sample_rows(source_id: str, relation: str, limit: int = 5) -> dict[str, Any]:
    """Read up to 50 sample rows after relation discovery."""
    return engine().sample_rows(source_id, relation, limit)


@mcp.tool(structured_output=True)
def execute_sql(source_id: str, sql: str, max_rows: int | None = None) -> dict[str, Any]:
    """Execute one AST-validated SELECT/WITH statement with a bounded result."""
    return engine().execute_sql(source_id, sql, max_rows)


@mcp.tool(structured_output=True)
def verify_query(query_id: str) -> dict[str, Any]:
    """Validate the recorded query policy and result-shape checks."""
    return engine().verify_query(query_id)


@mcp.tool(structured_output=True)
def execute_analysis(source_id: str, spec: dict[str, Any]) -> dict[str, Any]:
    """Build and execute a bounded read-only query from a structured analysis specification."""
    return engine().execute_analysis(source_id, AnalysisSpec.model_validate(spec))


@mcp.tool(structured_output=True)
def get_query_result(query_id: str) -> dict[str, Any]:
    """Return a query result from this MCP process together with its verification state."""
    return engine().get_query_result(query_id)


def main() -> None:
    mcp.run(transport="stdio")
