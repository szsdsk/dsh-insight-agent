from __future__ import annotations

from pathlib import Path

import pytest

from insight_mcp.discovery import list_source_files
from insight_mcp.security import PathSecurityError


def test_discovery_skips_dependencies_and_symlinks(workspace: Path, tmp_path: Path) -> None:
    (workspace / "data").mkdir()
    (workspace / "data" / "current.csv").write_text("value\n1\n", encoding="utf-8")
    (workspace / "node_modules").mkdir()
    (workspace / "node_modules" / "ignored.csv").write_text("value\n2\n", encoding="utf-8")
    external = tmp_path.parent / f"{tmp_path.name}-outside.csv"
    external.write_text("value\n3\n", encoding="utf-8")
    try:
        (workspace / "link.csv").symlink_to(external)
    except OSError:
        pass

    result = list_source_files(workspace)
    assert result["complete"] is True
    assert {item["path"] for item in result["files"]} == {
        "data/current.csv", "sales.csv", "shop.sqlite", "sales.xlsx"
    }


def test_discovery_rejects_outside_directory(workspace: Path) -> None:
    with pytest.raises(PathSecurityError):
        list_source_files(workspace, "../")
    with pytest.raises(PathSecurityError):
        list_source_files(workspace, str(workspace))
