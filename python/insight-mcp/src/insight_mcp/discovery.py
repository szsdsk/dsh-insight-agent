from __future__ import annotations

import os
from collections import deque
from pathlib import Path
from typing import Any

from .security import PathSecurityError, workspace_relative_path


_EXTENSIONS = {".csv": "csv", ".xlsx": "xlsx", ".sqlite": "sqlite", ".sqlite3": "sqlite", ".duckdb": "duckdb", ".db": "sqlite"}
_SKIP_DIRECTORIES = {
    ".git", ".hg", ".svn", ".venv", "venv", "node_modules", "__pycache__",
    ".generated", "dist", "build", "lib", "vendor",
}
_MAX_DEPTH = 5
_MAX_ENTRIES = 5000
_MAX_RESULTS = 100
_DATA_DIRECTORIES = {".insight", "data", "datasets", "uploads", "examples", "evals"}


def list_source_files(workspace_root: Path, directory: str = ".") -> dict[str, Any]:
    """List bounded data-file candidates without descending into dependency trees."""
    root = workspace_root.resolve(strict=True)
    requested = Path(directory)
    if not directory.strip() or requested.is_absolute() or ".." in requested.parts:
        raise PathSecurityError("directory must be a workspace-relative path without parent segments")
    target = (root / requested).resolve(strict=True)
    if not target.is_relative_to(root) or not target.is_dir():
        raise PathSecurityError("directory must resolve to a directory inside the workspace")

    pending = deque([(target, 0)])
    files: list[dict[str, str]] = []
    scanned = 0
    complete = True
    while pending:
        current, depth = pending.popleft()
        try:
            with os.scandir(current) as stream:
                entries = sorted(stream, key=lambda entry: (
                    entry.name not in _DATA_DIRECTORIES, entry.name.casefold()
                ))
        except OSError:
            complete = False
            continue
        for entry in entries:
            scanned += 1
            if scanned > _MAX_ENTRIES:
                complete = False
                pending.clear()
                break
            if entry.is_symlink():
                continue
            if entry.is_dir(follow_symlinks=False):
                if entry.name in _SKIP_DIRECTORIES or entry.name.startswith(".") and entry.name != ".insight":
                    continue
                if depth < _MAX_DEPTH:
                    pending.append((Path(entry.path), depth + 1))
                else:
                    complete = False
                continue
            kind = _EXTENSIONS.get(Path(entry.name).suffix.lower())
            if kind is not None and entry.is_file(follow_symlinks=False):
                files.append({"path": workspace_relative_path(root, Path(entry.path)), "kind": kind})
                if len(files) >= _MAX_RESULTS:
                    complete = False
                    pending.clear()
                    break

    files.sort(key=lambda item: item["path"].casefold())
    return {"files": files, "complete": complete, "scanned_entries": scanned}
