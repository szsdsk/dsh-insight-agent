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

`submit_diagnostic_plan` validates two distinct source tables, 1–32 named field links with reasons, 1–3 measures with definitions, up to two dimensions, up to eight shared cohort filters, optional key columns, and Top N. Fields, dimensions, keys and filters use the shared mapping name. Each measure returns both periods, delta and rate. `execute_diagnostic_plan` verifies both quality checks before comparing. Blocking numeric findings return `status: blocked` with counts and location examples, without accepting a completed run or saving a report; the user can correct values or confirm a revised plan. `drill_diagnostic_plan` filters both periods to an observed group and compares the remaining dimensions, for at most two levels; it rejects the aggregate Other group. The default `maxDiagnosticCorrections: 2` permits two corrections after the initial submission or execution per user message, counting invalid submissions and retaining the execution count across plan revisions; load-time validation accepts integers from 0 to 5. `enableDiagnosticPlan: false` removes diagnostic planning, drilldown and task tools for controlled comparisons.

#### Token effect

The plan adds bounded field links and metric definitions. Execution returns query IDs, quality counts, total measures, and up to ten groups per breakdown; use `get_query_result` for full rows.

#### KV Cache effect

Planning tool schemas remain stable across turns. Submitted plans and execution results add variable tokens to the request suffix.

### Operation lifetime

#### What the model sees

Each session accepts one diagnostic operation at a time, sharing cancellation and the `diagnosticTimeoutMs` deadline with its nested calls. The default deadline is 120000 ms and the allowed range is 1000–600000 ms. Timeout and cancellation reject unfinished operations; plugin disposal aborts active operations and waits for them to settle.

#### Token effect

A rejected overlap or timeout contributes an error result. Cancelled work does not add an accepted diagnostic result.

#### KV Cache effect

Operation deadlines do not change tool schemas; errors append variable result text.

### Reusable tasks and reports

#### What the model sees

`save_diagnostic_task` saves a successfully executed plan under a new user-requested name, along with its verified JSON and offline HTML report. `list_diagnostic_tasks` reads workspace task definitions. `run_diagnostic_task` accepts an exact name or ID and two replacement CSV/XLSX paths, restores selections and calculations, registers fresh sources, checks mapped fields, reruns and saves an independent report. Missing fields or incompatible numeric types return `status: needs_confirmation`, both fresh source references, and the discovered columns. After the user confirms and successfully executes a revised plan, `update_diagnostic_task` atomically replaces that task's configuration while retaining its ID, name and historical reports. `save_diagnostic_report` saves the latest successful run, including subsequent drilldowns, after rechecking every source. All writes remain under `.insight/diagnostics/`; returned paths are workspace-relative. Reports use the shared [offline renderer](../../api/insight-controller/README.md). Calling `submit_analysis` before saving attaches its accepted answer, query-linked claims, cell-verified facts, assumptions, limitations and separate business hypotheses. Plan revisions, reruns and further drilldowns require a fresh submission; prose is linked to evidence but is not semantically verified. Accepted output records the latest logged request's model and provider, without inferring either from configuration labels.

#### Token effect

Listing returns saved configurations. Rerunning adds fresh plans, source registration, query results and report paths to the current session; saved reports do not become current evidence by being listed.

#### KV Cache effect

Task and report tool schemas remain stable. Task definitions, replacement paths and fresh results vary in the request suffix.

## Known Limitations and Deferred Work

- Evidence stays in memory for the live Agent only. Saved reports remain viewable after restart, but a new explanation must rerun and verify its queries. Numeric checks do not establish the truth of business-cause explanations.
- Saved tasks use the workbench version 1 document, preserve optional mapping reasons and measure definitions through the Remote API, and support one uniqueness key. Workbench edits retain those explanations while the linked fields and calculations remain unchanged; changing a link or calculation clears its explanation. Duplicate names require an explicit task ID when selecting a task; saving a new task rejects an existing name.
- Saving stages all new documents before publishing complete files exclusively. A cancellation or publication failure rolls back files created by that operation; new-task saves do not overwrite existing tasks or reports. Explicit task revisions replace only the existing configuration after source verification and a successful revised run. Abrupt process termination can leave temporary or partially published new files and requires a separate recovery check.
- No runtime invariant companion is published; query evidence and diagnostic plans each have one authoritative session-local record.

### Dev Note

Run `pnpm exec vitest run packages/insight/insight-evidence/tests` for the focused tests. The Web bundle includes this package in `presets/insight-agent.patch.yml`.
