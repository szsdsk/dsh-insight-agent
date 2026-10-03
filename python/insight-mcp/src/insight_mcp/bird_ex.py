"""Apply the checksum-pinned official Mini-Dev EX function to complete read-only SQLite results."""

from __future__ import annotations

import ast
from contextlib import closing
import hashlib
import json
from pathlib import Path
import threading
from typing import Any
from urllib.request import urlopen

from .engine import DataEngine, QueryTimeoutError
from .serialization import canonical_json
from .sql_policy import validate_read_only_sql


ROOT = Path(__file__).resolve().parents[4]
MANIFEST = ROOT / "evals" / "manifests" / "bird-ex-evaluator.json"
CACHE = ROOT / ".generated" / "evals" / "bird" / "evaluation_ex.py"


def prepare_evaluator() -> dict[str, Any]:
    """Download only the locked official script and reject bytes that differ from its checksum."""
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    url = f"https://raw.githubusercontent.com/bird-bench/mini_dev/{manifest['revision']}/{manifest['path']}"
    with urlopen(url, timeout=30) as response:
        raw = response.read()
    if hashlib.sha256(raw).hexdigest() != manifest["sha256"]:
        raise ValueError("official BIRD EX script checksum differs from the locked manifest")
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_bytes(raw)
    return {"ok": True, "revision": manifest["revision"], "evaluator_sha256": manifest["sha256"]}


def compare_official(request: dict[str, Any]) -> dict[str, Any]:
    """Run locked calculate_ex on full result sets; no 5000-row truncation or input mutation."""
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    if not CACHE.exists():
        raise ValueError("official BIRD EX script is not prepared; run insight:eval bird-evaluator")
    raw = CACHE.read_bytes()
    if hashlib.sha256(raw).hexdigest() != manifest["sha256"]:
        raise ValueError("official BIRD EX script checksum differs from the locked manifest")
    module = ast.parse(raw)
    function = next(item for item in module.body if isinstance(item, ast.FunctionDef) and item.name == manifest["function"])
    namespace: dict[str, Any] = {}
    exec(compile(ast.Module(body=[function], type_ignores=[]), str(CACHE), "exec"), namespace)
    if request["source_kind"] != "sqlite":
        raise ValueError("official Mini-Dev EX requires SQLite")
    engine = DataEngine(Path(request["workspace"]), timeout_seconds=float(request.get("timeout_seconds", 30)))
    registered = engine.register_source(request["source_path"], "sqlite")
    source = engine._source(registered["source_id"])
    queries = [validate_read_only_sql(request[key], "sqlite").normalized for key in ["candidate_sql", "gold_sql"]]
    with closing(engine._connect_sqlite(source)) as connection:
        timer = threading.Timer(engine.timeout_seconds, connection.interrupt)
        timer.daemon = True
        timer.start()
        try:
            candidate = connection.execute(queries[0]).fetchall()
            gold = connection.execute(queries[1]).fetchall()
        except Exception as error:
            if "interrupt" in str(error).lower():
                raise QueryTimeoutError("official EX query deadline exceeded") from error
            raise
        finally:
            timer.cancel()
            timer.join()
    engine._source_path(source)
    equal = namespace[manifest["function"]](candidate, gold) == 1
    fingerprint = hashlib.sha256(canonical_json(sorted({canonical_json(row) for row in candidate})).encode("utf-8")).hexdigest()
    return {"ok": True, "equal": equal, "candidate_fingerprint": fingerprint,
            "candidate_row_count": len(candidate), "gold_row_count": len(gold),
            "method": "official-mini-dev-ex", "revision": manifest["revision"],
            "evaluator_sha256": manifest["sha256"]}
