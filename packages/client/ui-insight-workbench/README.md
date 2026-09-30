---
description: "DSH right-sidebar visual analysis workbench for InsightAgent."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-insight-workbench

English | [中文](README.zh.md)

## Summary

Users can configure and run verified analysis over workspace CSV, XLSX, SQLite, or DuckDB data without model credentials. The analysis view supports one explicit join, date grouping, metrics, filters, sorting, Top N, result tables, and ECharts views; it exports UTF-8 CSV and query-identified PNG. The diagnostic view uploads two CSV/XLSX files, previews physical rows, selects worksheets and regions, links fields, checks quality, compares up to three measures over two dimensions, and downloads a script-free HTML report. Saved analysis state and diagnostic reports remain historical snapshots until explicitly rerun.

## Table of Contents

- [Restore saved analysis](#restore-saved-analysis)
- [Diagnostic tasks and reports](#diagnostic-tasks-and-reports)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="restore-saved-analysis"></a>
## Restore saved analysis

After reopening, select **Import data** to reconnect the saved file. Reimporting the same path and format retains the selected relation, join keys, dimensions, metrics, filter, sort, and row limit; importing a different file clears that configuration. Each explicit analysis run registers the file again before executing, so a restarted MCP process or changed file cannot reuse an expired source ID. Cancelled responses do not replace the displayed snapshot, and explanation failures leave the result available.

<a id="diagnostic-tasks-and-reports"></a>
## Diagnostic tasks and reports

The diagnostic tab previews at most twelve physical rows before registering either file. It automatically links equal column names; users confirm different names, up to three metrics, two dimensions, shared filters, Top N, and an optional uniqueness key. Named tasks save the selected rows and confirmed calculation choices without runtime source IDs. Reloading a task requires two new uploads and fresh compatibility checks. Each successful run saves a separate report with both file fingerprints, classified quality findings, metric changes, group contributions, and query evidence; cancellation and failures retain the previous displayed report. The downloaded HTML escapes file and query text and embeds a static SVG image without external scripts.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the explicit Explain action that queues a user request while Insight MCP tools own the result text.

#### KV Cache effect

The explanation request adds one short result reference; query rows enter context only through the Agent's result tool call.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The configuration editor supports one explicit two-table join and one filter row.
- A saved result is a historical snapshot after restart or source change and cannot be explained until rerun.
- The initial chart mapping uses the first result column as X and the second as Y. Rich multi-series mapping is deferred.
- The diagnostic editor expects regular detail tables; complex merged headers, subtotal blocks, automatic cleaning, and business-cause verification are outside its scope.

**Runtime invariant:** No companion is published; the Client plugin owns its slots and releases them with its Cordis effect.

<a id="dev-note"></a>
### Dev Note

None.
