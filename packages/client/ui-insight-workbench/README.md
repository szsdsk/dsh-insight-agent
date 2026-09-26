---
description: "DSH right-sidebar visual analysis workbench for InsightAgent."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-insight-workbench

English | [中文](README.zh.md)

## Summary

Users can configure and run a verified analysis over workspace CSV, XLSX, SQLite, or DuckDB data without model credentials. The workbench supports one explicit join, date grouping, metrics, filters, sorting, Top N, result tables, and ECharts views. It exports safe UTF-8 CSV and query-identified PNG files. Saved state reopens as a historical snapshot without rerunning data or model operations.

## Table of Contents

- [Restore saved analysis](#restore-saved-analysis)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="restore-saved-analysis"></a>
## Restore saved analysis

After reopening, select **Import data** to reconnect the saved file. Reimporting the same path and format retains the selected relation, join keys, dimensions, metrics, filter, sort, and row limit; importing a different file clears that configuration. Each explicit analysis run registers the file again before executing, so a restarted MCP process or changed file cannot reuse an expired source ID. Cancelled responses do not replace the displayed snapshot, and explanation failures leave the result available.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the explicit Explain action that queues a user request while Insight MCP tools own the result text.

#### KV Cache effect

The explanation request adds one short result reference; query rows enter context only through the Agent's result tool call.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- v0.2 accepts workspace-relative paths; a browser upload transport and OS file picker are deferred.
- The configuration editor supports one explicit two-table join and one filter row.
- A saved result is a historical snapshot after restart or source change and cannot be explained until rerun.
- The initial chart mapping uses the first result column as X and the second as Y. Rich multi-series mapping is deferred.

**Runtime invariant:** No companion is published; the Client plugin owns its slots and releases them with its Cordis effect.

<a id="dev-note"></a>
### Dev Note

None.
