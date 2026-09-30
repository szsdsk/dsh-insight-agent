---
description: "Session-scoped query evidence and submit_analysis for InsightAgent."
kind: "package-reference"
---

# @deepseek-ai/dsh-insight-evidence

English | [中文](README.zh.md)

## Summary

Mount this package with InsightAgent to require query-backed final answers and bounded two-period plans. `submit_analysis` accepts claims only when their `query_id` came from a successful `execute_sql`, `execute_analysis`, `diagnose_table`, or `compare_tables` call verified in the same Agent session. Numeric facts cite an exact result row and column; the plugin checks their values against retained bounded rows and rechecks the source immediately before submission. Agent disposal clears the evidence; another session must run and verify its own queries.

## Table of Contents

- Model Experience
- Known Limitations and Deferred Work
- Dev Note

## Model Experience

### submit_analysis

#### What the model sees

The `submit_analysis` tool accepts an answer, at least one claim with a `query_id`, optional exact numeric facts (`name`, `query_id`, zero-based `row`, `column`, `value`), assumptions, and limitations. Its structured result retains SQL, source, verification status, result summary, and checked numeric facts; the model-visible text returns the accepted answer, query IDs, and checked facts. Missing, failed, stale, unverified, or cross-session query IDs and mismatched or out-of-range cells reject the call. Prose claims are linked to queries but are not semantically proved by this check.

#### Token effect

The InsightAgent preset exposes stable tool schemas. Plan and query results contribute current-session evidence to later model requests; disposal clears that state.

#### KV Cache effect

Stable tool schemas can reuse a model request prefix. Each result adds current-session plan or query details to later requests, so those result tokens grow with the analysis.

### Two-period plan

#### What the model sees

`submit_diagnostic_plan` validates two distinct source tables, 1–32 named field links with reasons, 1–3 measures with definitions, up to two dimensions, up to eight shared cohort filters, optional key columns, and Top N. `execute_diagnostic_plan` runs quality checks, comparisons, and verification. The default `maxDiagnosticCorrections: 2` permits two plan revisions and two execution retries; load-time validation accepts integers from 0 to 5. `enableDiagnosticPlan: false` removes both planning tools for controlled comparisons.

#### Token effect

The plan adds bounded field links and metric definitions. Execution returns query IDs, quality counts, total measures, and up to ten groups per breakdown; use `get_query_result` for full rows.

#### KV Cache effect

Planning tool schemas remain stable across turns. Submitted plans and execution results add variable tokens to the request suffix.

## Known Limitations and Deferred Work

- Evidence stays in memory for the live Agent only. Saved reports remain viewable after restart, but a new explanation must rerun and verify its queries. Numeric checks do not establish the truth of business-cause explanations.
- No runtime invariant companion is published; query evidence and diagnostic plans each have one authoritative session-local record.

### Dev Note

Run `pnpm exec vitest run packages/insight/insight-evidence/tests` for the focused tests. The Web bundle includes this package in `presets/insight-agent.patch.yml`.
