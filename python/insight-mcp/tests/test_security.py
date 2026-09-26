from __future__ import annotations

import os
from pathlib import Path

import pytest

from insight_mcp.security import PathSecurityError, resolve_workspace_path


def test_allows_workspace_file(workspace: Path) -> None:
    assert resolve_workspace_path(workspace, "sales.csv") == workspace / "sales.csv"


def test_rejects_parent_segments(workspace: Path) -> None:
    with pytest.raises(PathSecurityError, match="parent"):
        resolve_workspace_path(workspace, "data/../sales.csv")


def test_rejects_absolute_external_path(workspace: Path, tmp_path_factory) -> None:
    external = tmp_path_factory.mktemp("external") / "data.csv"
    external.write_text("a\n1\n", encoding="utf-8")
    with pytest.raises(PathSecurityError, match="inside"):
        resolve_workspace_path(workspace, str(external))


def test_rejects_symlink_escape(workspace: Path, tmp_path_factory) -> None:
    external = tmp_path_factory.mktemp("symlink-external") / "data.csv"
    external.write_text("a\n1\n", encoding="utf-8")
    link = workspace / "escape.csv"
    try:
        link.symlink_to(external)
    except OSError:
        pytest.skip("symlink creation is unavailable on this platform")
    with pytest.raises(PathSecurityError, match="inside"):
        resolve_workspace_path(workspace, str(link))
