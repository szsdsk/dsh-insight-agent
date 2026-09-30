from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


SourceKind = Literal["csv", "xlsx", "sqlite", "duckdb"]


class TableSelection(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    sheet: str | None = None
    header_row: int = Field(default=1, ge=1, le=200)
    data_start_row: int | None = Field(default=None, ge=2)
    data_end_row: int | None = Field(default=None, ge=2)


class SourceInfo(BaseModel):
    model_config = ConfigDict(frozen=True)

    source_id: str
    kind: SourceKind
    path: str
    fingerprint: str
    selection: TableSelection | None = None


class FieldRef(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    relation: str
    column: str


class JoinSpec(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    relation: str
    kind: Literal["inner", "left"] = "inner"
    left: FieldRef
    right: FieldRef


class DimensionSpec(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    field: FieldRef
    alias: str | None = None
    date_grain: Literal["day", "month", "year"] | None = None


class MetricSpec(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    aggregation: Literal["sum", "avg", "min", "max", "count", "count_distinct"]
    field: FieldRef | None = None
    alias: str


class FilterSpec(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    field: FieldRef
    operator: Literal["eq", "ne", "gt", "gte", "lt", "lte", "contains", "in", "is_null", "not_null"]
    value: Any = None


class SortSpec(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    column: str
    direction: Literal["asc", "desc"] = "asc"


class AnalysisSpec(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    relation: str
    join: JoinSpec | None = None
    dimensions: list[DimensionSpec] = Field(default_factory=list, max_length=8)
    metrics: list[MetricSpec] = Field(default_factory=list, min_length=1, max_length=8)
    filters: list[FilterSpec] = Field(default_factory=list, max_length=16)
    sort: list[SortSpec] = Field(default_factory=list, max_length=8)
    limit: int = Field(default=200, ge=1, le=5_000)


class QueryResult(BaseModel):
    model_config = ConfigDict(frozen=True)

    query_id: str
    source_id: str
    source_fingerprint: str
    sql: str
    columns: list[str]
    rows: list[list[Any]]
    row_count: int = Field(ge=0)
    truncated: bool
    elapsed_ms: int = Field(ge=0)
    result_digest: str
    sources: list[SourceInfo] = Field(default_factory=list)


class TableRef(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    source_id: str
    relation: str


class ComparisonColumn(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    name: str
    baseline: str
    current: str


class ComparisonMetric(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    name: str
    aggregation: Literal["sum", "count", "count_distinct", "avg"]
    field: str | None = None


class ComparisonFilter(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    field: str
    operator: Literal["eq", "ne", "gt", "gte", "lt", "lte", "is_null", "not_null"]
    value: Any = None


class ComparisonSpec(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    baseline: TableRef
    current: TableRef
    columns: list[ComparisonColumn] = Field(min_length=1, max_length=32)
    metrics: list[ComparisonMetric] = Field(min_length=1, max_length=3)
    dimensions: list[str] = Field(default_factory=list, max_length=2)
    filters: list[ComparisonFilter] = Field(default_factory=list, max_length=8)
    top_n: int = Field(default=10, ge=1, le=50)


class QueryRecord(BaseModel):
    model_config = ConfigDict(frozen=True)

    result: QueryResult
    read_only: bool = True
    statement_count: int = 1
