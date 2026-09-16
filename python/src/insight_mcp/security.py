from __future__ import annotations

from pathlib import Path


class PathSecurityError(ValueError):
    """Raised when a requested data path escapes the workspace."""


def resolve_workspace_path(workspace_root: Path, requested: str) -> Path:
    if not requested.strip():
        raise PathSecurityError("data path must not be blank")

    root = workspace_root.resolve(strict=True)
    candidate = Path(requested).expanduser()
    if ".." in candidate.parts:
        raise PathSecurityError("parent path segments are not allowed")
    if not candidate.is_absolute():
        candidate = root / candidate

    try:
        resolved = candidate.resolve(strict=True)
    except FileNotFoundError as error:
        raise PathSecurityError(f"data path does not exist: {requested}") from error

    if not resolved.is_file():
        raise PathSecurityError(f"data path is not a file: {requested}")
    if not resolved.is_relative_to(root):
        raise PathSecurityError("data path must resolve inside the current workspace")
    return resolved


def workspace_relative_path(workspace_root: Path, path: Path) -> str:
    return path.relative_to(workspace_root.resolve(strict=True)).as_posix()
