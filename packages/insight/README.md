---
description: "InsightAgent's session-scoped analysis evidence package group."
kind: "package-group"
---

# insight/ — analysis evidence

English | [中文](README.zh.md)

## Summary

The `insight/` group owns Agent-facing analysis evidence. The Web workbench lives under `packages/client/`, its session bridge under `packages/api/`, and the read-only data service under `python/insight-mcp/`.

## Packages

| Package | Role |
|---|---|
| [`insight-evidence/`](insight-evidence/README.md) | Registers `submit_analysis` and accepts only current-session verified query IDs. |

## Related documentation

The [tools subsystem](../../docs/subsystems/tools.md) owns scoped tool registration and result events; the [MCP subsystem](../../docs/subsystems/mcp.md) owns external tool connections. The [InsightAgent guide](../../docs/insight-agent/README.md) maps the complete product.

## Dev Note

The package has one Host compiler face and is referenced by `tsconfig.host.json`.
