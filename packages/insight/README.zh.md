---
description: "InsightAgent 会话级分析证据包分组。"
kind: "package-group"
---

# insight/ — 分析证据

[English](README.md) | 中文

## 概述

`insight/` 分组负责提供给 Agent 的分析证据能力。Web 工作台位于 `packages/client/`，会话连接位于 `packages/api/`，只读数据服务位于 `python/insight-mcp/`。

## 包

| 包 | 职责 |
|---|---|
| [`insight-evidence/`](insight-evidence/README.zh.md) | 注册 `submit_analysis`，只接受当前会话中已校验的查询 ID。 |

## 相关文档

[工具子系统](../../docs/subsystems/tools.zh.md)负责会话级工具注册和结果事件；[MCP 子系统](../../docs/subsystems/mcp.zh.md)负责外部工具连接。[InsightAgent 指南](../../docs/insight-agent/README.zh.md)说明完整产品的目录职责。

## 开发说明

本分组的包只有一个 Host 编译面，由 `tsconfig.host.json` 引用。
