from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sqlite3

import pytest

from insight_mcp import bird_ex


def pinned_fixture(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    script = tmp_path / "evaluation_ex.py"
    script.write_text("raise AssertionError('module side effects must not execute')\n"
                      "def calculate_ex(predicted_res, ground_truth_res):\n"
                      "    return int(set(predicted_res) == set(ground_truth_res))\n", encoding="utf-8")
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps({"revision": "fixture", "function": "calculate_ex",
                                   "sha256": hashlib.sha256(script.read_bytes()).hexdigest()}), encoding="utf-8")
    monkeypatch.setattr(bird_ex, "CACHE", script)
    monkeypatch.setattr(bird_ex, "MANIFEST", manifest)
    database = tmp_path / "large.sqlite"
    with sqlite3.connect(database) as connection:
        connection.execute("CREATE TABLE numbers(value INTEGER)")
        connection.executemany("INSERT INTO numbers VALUES (?)", ((index,) for index in range(6001)))
    return database


def test_official_ex_reads_complete_sets_and_preserves_database(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    database = pinned_fixture(tmp_path, monkeypatch)
    before = database.read_bytes()
    result = bird_ex.compare_official({"workspace": str(tmp_path), "source_path": database.name, "source_kind": "sqlite",
                                      "candidate_sql": "SELECT CAST(value AS REAL) FROM numbers UNION ALL SELECT value FROM numbers",
                                      "gold_sql": "SELECT value FROM numbers ORDER BY value DESC"})
    assert result["equal"] is True
    assert result["candidate_row_count"] == 12002
    assert result["gold_row_count"] == 6001
    assert result["method"] == "official-mini-dev-ex"
    assert database.read_bytes() == before


def test_official_ex_rejects_modified_evaluator_and_write_sql(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    database = pinned_fixture(tmp_path, monkeypatch)
    request = {"workspace": str(tmp_path), "source_path": database.name, "source_kind": "sqlite",
               "candidate_sql": "DELETE FROM numbers", "gold_sql": "SELECT value FROM numbers"}
    with pytest.raises(ValueError, match="SELECT|WITH|allowed"):
        bird_ex.compare_official(request)
    bird_ex.CACHE.write_text("def calculate_ex(a,b): return 1\n", encoding="utf-8")
    with pytest.raises(ValueError, match="checksum"):
        bird_ex.compare_official(request)
