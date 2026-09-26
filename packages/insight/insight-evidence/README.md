---
description: "Session-scoped query evidence and submit_analysis for InsightAgent."
kind: "package-reference"
---

# @deepseek-ai/dsh-insight-evidence

English | [中文](README.zh.md)

## Summary

Mount this package with InsightAgent to require query-backed final answers. `submit_analysis` accepts claims only when their `query_id` came from a successful `execute_sql` or `execute_analysis` call verified in the same Agent session. It stores query metadata and a digest without copying result rows. Agent disposal clears the evidence; another session must run and verify its own queries.

## Table of Contents

- Model Experience
- Known Limitations and Deferred Work
- Dev Note

## Model Experience

### submit_analysis

#### What the model sees

The `submit_analysis` tool accepts an answer, at least one claim with a `query_id`, and optional assumptions and limitations. A successful result returns the accepted answer with SQL, source, verification status, and result summary for each claim. A missing, failed, unverified, or cross-session query ID rejects the call.

#### Token effect

The InsightAgent preset exposes the stable tool schema. Each result contributes current-session evidence to later model requests; disposal clears that state.

#### KV Cache effect

The stable tool schema can reuse a model request prefix. Each tool result adds current-session evidence to later requests, so those result tokens grow with the analysis.

## Known Limitations and Deferred Work

- Evidence stays in memory for the live Agent only. Saved workbench snapshots remain viewable after restart, but a new explanation must rerun and verify its queries.

### Dev Note

Run `pnpm exec vitest run packages/insight/insight-evidence/tests` for the focused tests. The Web bundle includes this package in `presets/insight-agent.patch.yml`.
