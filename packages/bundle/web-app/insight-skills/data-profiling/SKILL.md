---
name: data-profiling
description: Discover a workspace CSV, XLSX, SQLite, or DuckDB source before writing SQL.
---

# Data profiling

Use this skill at the start of every data task.

1. If no path was provided, call `mcp__insight__list_source_files`. Narrow its
   `directory` when the requested files are absent from an incomplete listing.
2. Call `mcp__insight__register_source` with the selected workspace path and kind.
3. Call `mcp__insight__list_relations`; never invent a relation.
4. Call `mcp__insight__describe_relation` for each relevant relation.
5. Use `profile_relation` for candidate filter, grouping, join, date, and NULL
   columns. Use `sample_rows` only to understand representation, never as proof
   of a whole-dataset claim.
6. Preserve the returned `source_id` for all later calls.

If the path is ambiguous, ask the user to choose it. Do not use `glob` or search
outside the workspace; do not bypass the MCP service with Shell, Python, or
database CLIs.
