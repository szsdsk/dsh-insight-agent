from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import sys
from pathlib import Path
from typing import Any

from .engine import DataEngine
from .serialization import canonical_json
from .sql_policy import SqlPolicyError, validate_read_only_sql


def main() -> None:
    parser = argparse.ArgumentParser(description="JSON bridge used by the TypeScript eval runner")
    parser.add_argument("action", choices=["prepare", "compare", "policy"])
    args = parser.parse_args()
    request = json.load(sys.stdin)
    try:
        if args.action == "prepare":
            response = prepare_fixture(request)
        elif args.action == "compare":
            response = compare_queries(request)
        else:
            response = check_policy(request)
    except Exception as error:  # The bridge always returns machine-readable failure.
        response = {"ok": False, "error": f"{error.__class__.__name__}: {error}"}
    json.dump(response, sys.stdout, ensure_ascii=False, sort_keys=True)
    sys.stdout.write("\n")


def prepare_fixture(request: dict[str, Any]) -> dict[str, Any]:
    workspace = Path(request["workspace"]).resolve(strict=True)
    schema_path = (workspace / request["schema_path"]).resolve(strict=True)
    database_path = (workspace / request["database_path"]).resolve(strict=False)
    if not schema_path.is_relative_to(workspace) or not database_path.is_relative_to(workspace):
        raise ValueError("fixture paths must stay inside workspace")
    if database_path.exists():
        return {"ok": True, "created": False, "path": str(database_path)}
    database_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database_path)
    try:
        connection.executescript(schema_path.read_text(encoding="utf-8"))
        connection.commit()
    finally:
        connection.close()
    return {"ok": True, "created": True, "path": str(database_path)}


def compare_queries(request: dict[str, Any]) -> dict[str, Any]:
    engine = DataEngine(Path(request["workspace"]), default_max_rows=5_000)
    source = engine.register_source(request["source_path"], request["source_kind"])
    candidate = engine.execute_sql(source["source_id"], request["candidate_sql"], 5_000)
    gold = engine.execute_sql(source["source_id"], request["gold_sql"], 5_000)
    if candidate["truncated"] or gold["truncated"]:
        return {"ok": False, "equal": False, "error": "comparison result exceeded 5000 rows"}
    order_sensitive = "order by" in request["gold_sql"].lower()
    candidate_rows = normalized_rows(candidate["rows"], order_sensitive)
    gold_rows = normalized_rows(gold["rows"], order_sensitive)
    return {
        "ok": True,
        "equal": candidate_rows == gold_rows,
        "candidate_fingerprint": hashlib.sha256(
            canonical_json(candidate_rows).encode("utf-8")
        ).hexdigest(),
        "candidate_row_count": len(candidate_rows),
        "gold_row_count": len(gold_rows),
    }


def check_policy(request: dict[str, Any]) -> dict[str, Any]:
    try:
        validate_read_only_sql(request["sql"], dialect=request.get("dialect", "sqlite"))
    except SqlPolicyError as error:
        return {"ok": True, "blocked": True, "error": str(error)}
    return {"ok": True, "blocked": False, "error": None}


def normalized_rows(rows: list[list[Any]], order_sensitive: bool) -> list[str]:
    encoded = [canonical_json(row) for row in rows]
    return encoded if order_sensitive else sorted(encoded)


if __name__ == "__main__":
    main()
