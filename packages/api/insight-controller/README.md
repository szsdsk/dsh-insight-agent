---
description: "Session-scoped Remote bridge between the Insight workbench and Insight MCP tools."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-insight-controller

English | [中文](README.zh.md)

## Summary

The visual workbench can run named Insight MCP operations in its current Session, receive only verified query results, and save one versioned analysis document under the workspace `.insight/` directory. It rejects overlapping analysis and waits for an idle Agent. Browser-supplied rows never become evidence, and callers cannot choose an arbitrary save path.

## Table of Contents

- [Remote API](#remote-api)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="remote-api"></a>
## Remote API

The namespace contains `register`, `relations`, `describe`, `execute`, `result`, `save`, and `load`. The first five methods delegate to the Insight MCP's stable protocol. Save and load accept the versioned `InsightProject` contract and derive the storage path from the Agent workspace and id; callers cannot choose an arbitrary output path.

The package root exports the Host service; `./client` exposes the browser entry separately so Client analysis does not load Host filesystem code. `./remote` supplies the generated Remote methods consumed by the workbench.

<a id="model-experience"></a>
## Model Experience

None, as the Remote bridge registers no prompt, tool schema, or result text of its own.

#### KV Cache effect

No direct effect; Insight MCP and evidence packages own model-visible tool definitions and result text.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Result references are valid only in the current MCP runtime. Saved snapshots remain viewable but must be rerun before they can support a new explanation.
- The v1 project format stores one analysis and one result snapshot per Session.
- Upload transport is not part of this namespace; v0.2 registers files already present in the current workspace.

**Runtime invariant:** No companion is published; the Host service and generated Remote artifacts share this package's lifecycle.

<a id="dev-note"></a>
### Dev Note

None.
