# Insight MCP data service

English | [中文](README.zh.md)

This Python package supplies read-only MCP tools for InsightAgent. It registers workspace-local CSV, XLSX, SQLite, and DuckDB sources, runs guarded SQL, records query results, and verifies that a result still refers to the same file bytes. Each source registration has a session-local ID; reusable tasks must store paths and selected regions instead of that ID.

`list_source_files` discovers up to 100 supported files inside the workspace while skipping dependency and build directories. Its `complete` field signals when traversal was capped; callers can provide a narrower directory.

`preview_table` returns bounded physical rows and worksheet names. `register_source` accepts a worksheet, header row, and data row range for one selected table. `diagnose_table` reports missing values, duplicate rows and keys, invalid numeric values, and missing Excel formula caches. A finding records its count, share, classification, and query ID when SQL produced it. Missing values and repeated rows are observations until the user defines a rule that makes them errors. Numeric conflicts block affected measures.

`compare_tables` copies both selected inputs into controlled in-memory DuckDB tables, applies confirmed field links and filters, and computes totals and bounded dimension groups. SQL ranks high-cardinality groups before returning Top N and an Other row for additive measures. It supports sum, count, distinct count, and average. Change percentages require a positive baseline; contribution rates apply only to additive measures. The returned query record includes both source fingerprints. `verify_query` rejects a result if either input changed. SQL and result rows are retained within the live data-service process, not as durable task memory.

The service does not modify source files. Its first release expects one regular header and one data region per selected sheet; merged headers, multiple blocks, and subtotal detection require manual region selection or file preparation.

Install locally with `python -m pip install -e "python/insight-mcp[dev]"` and run focused checks with `python -m pytest python/insight-mcp/tests`. The [product guide](../../docs/insight-agent/README.md) describes the Web flow and [evaluation guide](../../evals/README.md) describes the frozen office cases.
