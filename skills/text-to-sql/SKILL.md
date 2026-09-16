---
name: text-to-sql
description: Produce safe, inspectable SQL for the discovered source and recover from execution errors.
---

# Text to SQL

Write exactly one `SELECT` or `WITH` statement per `execute_sql` call.

- Use only discovered relations and columns; quote unusual identifiers.
- Aggregate before returning high-cardinality results and request only needed
  columns. The service returns at most 200 rows by default.
- Make time boundaries, NULL handling, denominator rules, and ordering explicit.
- For joins, compare pre/post row counts or key uniqueness when duplication may
  change an aggregate.
- Never use DML, DDL, `ATTACH`, `COPY`, `INSTALL`, `LOAD`, `PRAGMA`, multiple
  statements, URLs, or external-file reader functions.

If SQL fails, read the actual error, re-check the discovered schema, state the
correction, and retry. Do not fabricate a result or a `query_id`.
