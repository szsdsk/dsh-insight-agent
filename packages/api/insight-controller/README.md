---
description: "Session-scoped Remote bridge between the Insight workbench and Insight MCP tools."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-insight-controller

English | [中文](README.zh.md)

## Summary

The visual workbench runs named Insight MCP operations in its current Session and receives verified query results. It saves the original analysis document and independent versioned diagnostic tasks and reports under workspace `.insight/`. Browser-supplied rows never enter the Agent's evidence store, and callers cannot choose an arbitrary save path. The `./report` export provides the pure `diagnosticHtml` and `displayCell` functions shared by the browser workbench and Agent task tools, rendering escaped, script-free offline reports with embedded SVG charts.

## Table of Contents

- [Remote API](#remote-api)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="remote-api"></a>
## Remote API

The namespace contains single-source `register`, `relations`, `describe`, `execute`, `result`, `save`, and `load`, plus `preview`, `registerSelected`, `diagnose`, `compare`, `saveTask`, `listTasks`, and `saveReport`. Diagnostic methods verify query IDs before returning results. Tasks store reusable field and metric choices under `.insight/diagnostics/tasks/` without runtime source IDs; reports store independent run snapshots under `.insight/diagnostics/reports/` only when their source identities and complete Remote result fields match verified outputs issued to the same Session. MCP-only metadata is removed before results are returned and retained for this comparison. The original `InsightProject` remains version 1 under its session directory.

The package root exports the Host service; `./client` exposes the browser entry separately so Client analysis does not load Host filesystem code. `./remote` supplies the generated Remote methods consumed by the workbench.

Task field links and measures retain optional reasons and definitions through the Remote API. Comparison sends only calculation fields to MCP. Cancelled tool responses are rejected before they can update retained diagnostic results. Report IDs are immutable: saving to an existing ID fails and preserves that file. Quality results preserve bounded row and cell examples. Report narratives must exactly match an accepted `submit_analysis` result for the same run's queries; arbitrary browser text is rejected. Offline reports display the retrospective, checked numerical cells, assumptions, limitations and unverified business hypotheses separately.

<a id="model-experience"></a>
## Model Experience

None, as the Remote bridge registers no prompt, tool schema, or result text of its own.

#### KV Cache effect

No direct effect; Insight MCP and evidence packages own model-visible tool definitions and result text.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Result references are valid only in the current MCP runtime. Saved snapshots remain viewable but must be rerun before they can support a new explanation.
- The v1 project format stores one analysis and one result snapshot per Session.
- Browser upload transport supplies workspace-relative files through `storeUpload`; the diagnostic API accepts only selected CSV/XLSX regions.

**Runtime invariant:** No companion is published; the Host service and generated Remote artifacts share this package's lifecycle.

<a id="dev-note"></a>
### Dev Note

None.
