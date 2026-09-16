from __future__ import annotations

import hashlib
import os
import re
import sqlite3
import threading
import time
from contextlib import closing
from pathlib import Path
from typing import Any, Iterable, Sequence
from urllib.parse import quote

import duckdb

from .models import QueryRecord, QueryResult, SourceInfo, SourceKind
from .security import resolve_workspace_path, workspace_relative_path
from .serialization import canonical_json, to_json_value
from .sql_policy import SqlPolicyError, validate_read_only_sql


class SourceError(ValueError):
    pass


class QueryTimeoutError(TimeoutError):
    pass


class DataEngine:
    HARD_MAX_ROWS = 5_000
    HARD_MAX_TIMEOUT_SECONDS = 30.0
    CSV_RELATION = "data"

    def __init__(
        self,
        workspace_root: Path | str,
        *,
        default_max_rows: int = 200,
        timeout_seconds: float = 10.0,
    ) -> None:
        self.workspace_root = Path(workspace_root).resolve(strict=True)
        self.default_max_rows = self._bounded_rows(default_max_rows)
        if not 0 < timeout_seconds <= self.HARD_MAX_TIMEOUT_SECONDS:
            raise ValueError("timeout_seconds must be within (0, 30]")
        self.timeout_seconds = timeout_seconds
        self._sources: dict[str, SourceInfo] = {}
        self._queries: dict[str, QueryRecord] = {}
        self._lock = threading.RLock()

    @classmethod
    def from_environment(cls) -> "DataEngine":
        root = Path(os.environ.get("INSIGHT_WORKSPACE", os.getcwd()))
        max_rows = int(os.environ.get("INSIGHT_MAX_ROWS", "200"))
        timeout = float(os.environ.get("INSIGHT_QUERY_TIMEOUT_SECONDS", "10"))
        return cls(root, default_max_rows=max_rows, timeout_seconds=timeout)

    def register_source(self, path: str, kind: SourceKind) -> dict[str, Any]:
        resolved = resolve_workspace_path(self.workspace_root, path)
        detected = self._validate_kind(resolved, kind)
        relative = workspace_relative_path(self.workspace_root, resolved)
        source_id = "src_" + self._digest({"kind": detected, "path": relative})[:16]
        info = SourceInfo(source_id=source_id, kind=detected, path=relative)
        with self._lock:
            self._sources[source_id] = info
        return info.model_dump(mode="json")

    def list_relations(self, source_id: str) -> dict[str, Any]:
        source = self._source(source_id)
        # Even metadata-only operations must detect a file that was replaced
        # by an escaping symlink after registration.
        self._source_path(source)
        if source.kind == "csv":
            relations = [self.CSV_RELATION]
        elif source.kind == "sqlite":
            with closing(self._connect_sqlite(source)) as connection:
                rows = connection.execute(
                    "SELECT name FROM sqlite_master "
                    "WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name"
                ).fetchall()
            relations = [str(row[0]) for row in rows]
        else:
            with closing(self._connect_duckdb(source)) as connection:
                rows = connection.execute(
                    "SELECT table_name FROM information_schema.tables "
                    "WHERE table_schema NOT IN ('information_schema', 'pg_catalog') "
                    "ORDER BY table_name"
                ).fetchall()
            relations = [str(row[0]) for row in rows]
        return {"source_id": source_id, "relations": relations}

    def describe_relation(self, source_id: str, relation: str) -> dict[str, Any]:
        source = self._source(source_id)
        self._require_relation(source, relation)
        if source.kind == "sqlite":
            with closing(self._connect_sqlite(source)) as connection:
                rows = connection.execute(
                    f"PRAGMA table_info({quote_identifier(relation)})"
                ).fetchall()
            columns = [
                {
                    "name": str(row[1]),
                    "type": str(row[2] or "UNKNOWN"),
                    "nullable": not bool(row[3]),
                    "primary_key": bool(row[5]),
                }
                for row in rows
            ]
        else:
            with closing(self._connect_duckdb(source)) as connection:
                cursor = connection.execute(
                    f"DESCRIBE SELECT * FROM {quote_identifier(relation)}"
                )
                rows = cursor.fetchall()
            columns = [
                {
                    "name": str(row[0]),
                    "type": str(row[1]),
                    "nullable": str(row[2]).upper() != "NO",
                    "primary_key": False,
                }
                for row in rows
            ]
        return {"source_id": source_id, "relation": relation, "columns": columns}

    def profile_relation(
        self,
        source_id: str,
        relation: str,
        columns: Sequence[str] | None = None,
    ) -> dict[str, Any]:
        source = self._source(source_id)
        schema = self.describe_relation(source_id, relation)["columns"]
        available = {item["name"]: item["type"] for item in schema}
        selected = list(columns) if columns else list(available)
        if len(selected) > 32:
            raise SourceError("profile_relation accepts at most 32 columns")
        unknown = [name for name in selected if name not in available]
        if unknown:
            raise SourceError(f"unknown columns: {', '.join(unknown)}")

        profiles = []
        for name in selected:
            identifier = quote_identifier(name)
            numeric = is_numeric_type(str(available[name]))
            mean_expr = f", AVG({identifier})" if numeric else ""
            sql = (
                f"SELECT COUNT(*), COUNT({identifier}), COUNT(DISTINCT {identifier}), "
                f"MIN({identifier}), MAX({identifier}){mean_expr} "
                f"FROM {quote_identifier(relation)}"
            )
            row = self._internal_query(source, sql)[0]
            total, non_null, distinct, minimum, maximum, *mean = row
            profiles.append(
                {
                    "name": name,
                    "type": available[name],
                    "null_count": int(total) - int(non_null),
                    "distinct_count": int(distinct),
                    "min": to_json_value(minimum),
                    "max": to_json_value(maximum),
                    "mean": to_json_value(mean[0]) if mean else None,
                }
            )
        return {"source_id": source_id, "relation": relation, "columns": profiles}

    def sample_rows(self, source_id: str, relation: str, limit: int = 5) -> dict[str, Any]:
        source = self._source(source_id)
        self._require_relation(source, relation)
        safe_limit = min(max(int(limit), 1), 50)
        columns, rows = self._internal_query_with_columns(
            source,
            f"SELECT * FROM {quote_identifier(relation)} LIMIT {safe_limit}",
        )
        return {
            "source_id": source_id,
            "relation": relation,
            "columns": columns,
            "rows": [to_json_value(row) for row in rows],
            "row_count": len(rows),
        }

    def execute_sql(
        self,
        source_id: str,
        sql: str,
        max_rows: int | None = None,
    ) -> dict[str, Any]:
        source = self._source(source_id)
        dialect = "sqlite" if source.kind == "sqlite" else "duckdb"
        validated = validate_read_only_sql(sql, dialect=dialect)
        limit = self.default_max_rows if max_rows is None else self._bounded_rows(max_rows)
        started = time.perf_counter()
        columns, fetched = self._query(source, validated.normalized, limit + 1)
        elapsed_ms = max(0, round((time.perf_counter() - started) * 1_000))
        truncated = len(fetched) > limit
        rows = [to_json_value(row) for row in fetched[:limit]]
        result_digest = "sha256:" + self._digest({"columns": columns, "rows": rows})
        query_id = "qry_" + self._digest(
            {
                "source_id": source_id,
                "sql": validated.normalized,
                "result_digest": result_digest,
            }
        )[:20]
        result = QueryResult(
            query_id=query_id,
            source_id=source_id,
            sql=validated.normalized,
            columns=columns,
            rows=rows,
            row_count=len(rows),
            truncated=truncated,
            elapsed_ms=elapsed_ms,
            result_digest=result_digest,
        )
        with self._lock:
            self._queries[query_id] = QueryRecord(result=result)
        return result.model_dump(mode="json")

    def verify_query(self, query_id: str) -> dict[str, Any]:
        with self._lock:
            record = self._queries.get(query_id)
        if record is None:
            raise SourceError(f"unknown query_id: {query_id}")
        result = record.result
        warnings = []
        if result.row_count == 0:
            warnings.append("query returned no rows")
        if result.truncated:
            warnings.append("result was truncated; aggregate before drawing complete-set conclusions")
        checks = {
            "read_only": record.read_only,
            "single_statement": record.statement_count == 1,
            "stable_result_digest": result.result_digest.startswith("sha256:"),
            "column_row_shape": all(len(row) == len(result.columns) for row in result.rows),
        }
        return {
            "query_id": query_id,
            "valid": all(checks.values()),
            "checks": checks,
            "warnings": warnings,
            "result_summary": {
                "source_id": result.source_id,
                "columns": result.columns,
                "row_count": result.row_count,
                "truncated": result.truncated,
                "result_digest": result.result_digest,
            },
        }

    def _source(self, source_id: str) -> SourceInfo:
        with self._lock:
            source = self._sources.get(source_id)
        if source is None:
            raise SourceError(f"unknown source_id: {source_id}")
        return source

    def _require_relation(self, source: SourceInfo, relation: str) -> None:
        relations = self.list_relations(source.source_id)["relations"]
        if relation not in relations:
            raise SourceError(f"unknown relation for {source.source_id}: {relation}")

    def _query(self, source: SourceInfo, sql: str, fetch_limit: int) -> tuple[list[str], list[Any]]:
        if source.kind == "sqlite":
            with closing(self._connect_sqlite(source)) as connection:
                deadline = time.monotonic() + self.timeout_seconds
                connection.set_progress_handler(lambda: int(time.monotonic() >= deadline), 1_000)
                try:
                    cursor = connection.execute(sql)
                    columns = [item[0] for item in cursor.description or []]
                    return columns, cursor.fetchmany(fetch_limit)
                except sqlite3.OperationalError as error:
                    if "interrupt" in str(error).lower():
                        raise QueryTimeoutError(
                            f"query exceeded {self.timeout_seconds:g} seconds"
                        ) from error
                    raise

        with closing(self._connect_duckdb(source)) as connection:
            timer = threading.Timer(self.timeout_seconds, connection.interrupt)
            timer.daemon = True
            timer.start()
            try:
                cursor = connection.execute(sql)
                columns = [item[0] for item in cursor.description or []]
                return columns, cursor.fetchmany(fetch_limit)
            except duckdb.Error as error:
                if "interrupt" in str(error).lower():
                    raise QueryTimeoutError(
                        f"query exceeded {self.timeout_seconds:g} seconds"
                    ) from error
                raise
            finally:
                timer.cancel()

    def _internal_query(self, source: SourceInfo, sql: str) -> list[Any]:
        return self._query(source, sql, self.HARD_MAX_ROWS)[1]

    def _internal_query_with_columns(
        self, source: SourceInfo, sql: str
    ) -> tuple[list[str], list[Any]]:
        return self._query(source, sql, self.HARD_MAX_ROWS)

    def _connect_sqlite(self, source: SourceInfo) -> sqlite3.Connection:
        path = self._source_path(source)
        uri = f"file:{quote(path.as_posix(), safe='/:')}?mode=ro"
        connection = sqlite3.connect(uri, uri=True)
        connection.execute("PRAGMA query_only = ON")
        return connection

    def _connect_duckdb(self, source: SourceInfo) -> duckdb.DuckDBPyConnection:
        path = self._source_path(source)
        if source.kind == "duckdb":
            connection = duckdb.connect(str(path), read_only=True)
            connection.execute("SET enable_external_access = false")
            return connection
        connection = duckdb.connect(":memory:")
        literal = quote_literal(str(path))
        connection.execute(
            f"CREATE TABLE {quote_identifier(self.CSV_RELATION)} AS "
            f"SELECT * FROM read_csv_auto({literal}, sample_size = -1)"
        )
        connection.execute("SET enable_external_access = false")
        return connection

    def _source_path(self, source: SourceInfo) -> Path:
        """Re-check the path on every open to prevent symlink-swap escapes."""
        resolved = resolve_workspace_path(self.workspace_root, source.path)
        if workspace_relative_path(self.workspace_root, resolved) != source.path:
            raise SourceError("registered source path changed after registration")
        return resolved

    @staticmethod
    def _validate_kind(path: Path, kind: SourceKind) -> SourceKind:
        extensions = {
            "csv": {".csv"},
            "sqlite": {".sqlite", ".sqlite3", ".db"},
            "duckdb": {".duckdb"},
        }
        if kind not in extensions:
            raise SourceError(f"unsupported source kind: {kind}")
        if path.suffix.lower() not in extensions[kind]:
            raise SourceError(f"file extension does not match kind {kind}: {path.name}")
        return kind

    @classmethod
    def _bounded_rows(cls, value: int) -> int:
        value = int(value)
        if value <= 0:
            raise ValueError("max_rows must be positive")
        return min(value, cls.HARD_MAX_ROWS)

    @staticmethod
    def _digest(value: Any) -> str:
        return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def quote_identifier(identifier: str) -> str:
    if not identifier or "\x00" in identifier:
        raise SourceError("invalid SQL identifier")
    return '"' + identifier.replace('"', '""') + '"'


def quote_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def is_numeric_type(type_name: str) -> bool:
    return bool(
        re.search(
            r"\b(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|REAL|FLOAT|DOUBLE|DECIMAL|NUMERIC)\b",
            type_name.upper(),
        )
    )
