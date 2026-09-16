from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


SourceKind = Literal["csv", "sqlite", "duckdb"]


class SourceInfo(BaseModel):
    model_config = ConfigDict(frozen=True)

    source_id: str
    kind: SourceKind
    path: str


class QueryResult(BaseModel):
    model_config = ConfigDict(frozen=True)

    query_id: str
    source_id: str
    sql: str
    columns: list[str]
    rows: list[list[Any]]
    row_count: int = Field(ge=0)
    truncated: bool
    elapsed_ms: int = Field(ge=0)
    result_digest: str


class QueryRecord(BaseModel):
    model_config = ConfigDict(frozen=True)

    result: QueryResult
    read_only: bool = True
    statement_count: int = 1
