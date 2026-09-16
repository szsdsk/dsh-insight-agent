---
name: data-profiling
description: Discover a registered CSV, SQLite, or DuckDB source before writing SQL.
---

# Data profiling

Use this skill at the start of every data task.

1. Call `mcp__insight__register_source` with the user-provided workspace path
   and exact kind.
2. Call `mcp__insight__list_relations`; never invent a relation.
3. Call `mcp__insight__describe_relation` for each relevant relation.
4. Use `profile_relation` for candidate filter, grouping, join, date, and NULL
   columns. Use `sample_rows` only to understand representation, never as proof
   of a whole-dataset claim.
5. Preserve the returned `source_id` for all later calls.

If the path is ambiguous, ask the user to choose it. Do not search outside the
workspace or bypass the MCP service with Shell, Python, or database CLIs.
