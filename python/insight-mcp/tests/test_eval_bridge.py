from __future__ import annotations

from pathlib import Path

from insight_mcp.eval_bridge import check_policy, compare_queries, prepare_fixture


def test_prepare_compare_and_policy_bridge(workspace: Path) -> None:
    schema = workspace / "fixture.sql"
    schema.write_text(
        "CREATE TABLE values_table(value INTEGER);"
        "INSERT INTO values_table VALUES (1), (2), (3);",
        encoding="utf-8",
    )
    prepared = prepare_fixture(
        {
            "workspace": str(workspace),
            "schema_path": "fixture.sql",
            "database_path": "bridge.sqlite",
        }
    )
    assert prepared["ok"] is True
    assert prepared["created"] is True

    comparison = compare_queries(
        {
            "workspace": str(workspace),
            "source_path": "bridge.sqlite",
            "source_kind": "sqlite",
            "candidate_sql": "SELECT SUM(value) AS candidate FROM values_table",
            "gold_sql": "SELECT SUM(value) AS gold FROM values_table",
        }
    )
    assert comparison["ok"] is True
    assert comparison["equal"] is True
    assert len(comparison["candidate_fingerprint"]) == 64

    policy = check_policy({"sql": "DELETE FROM values_table", "dialect": "sqlite"})
    assert policy["ok"] is True
    assert policy["blocked"] is True
