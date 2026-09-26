---
description: "InsightAgent 的会话级查询证据与 submit_analysis 工具。"
kind: "package-reference"
---

# @deepseek-ai/dsh-insight-evidence

[English](README.md) | 中文

## 概述

搭配 InsightAgent 加载此包，可要求最终回答有查询证据。只有同一 Agent 会话中成功执行的 `execute_sql` 或 `execute_analysis` 查询，并且通过 `verify_query` 后，其 `query_id` 才能支持 `submit_analysis` 中的事实性结论。插件保存查询元数据和摘要，不复制结果行。Agent 结束时清除证据；后续会话必须重新运行并校验查询。

## 目录

- 模型体验
- 已知限制与待完成工作
- 开发备注

## 模型体验

### submit_analysis

#### 模型看到的内容

`submit_analysis` 接收答案、至少一条包含 `query_id` 的结论，以及可选的假设和限制。成功时返回已接受的答案，并为每条结论提供 SQL、数据源、校验状态和结果摘要。不存在、执行失败、未校验或来自其他会话的查询 ID 会被拒绝。

#### Token 影响

InsightAgent Preset 提供稳定的工具 Schema。每次工具结果会将当前会话的证据加入后续模型请求；Agent 结束时清除这些状态。

#### KV Cache 影响

稳定的工具 Schema 可以复用模型请求前缀。每次工具结果会把当前会话的证据加入后续请求，因此结果 Token 会随分析增长。

## 已知限制与待完成工作

- 证据只保存在运行中的 Agent 内存中。重启后仍可查看工作台快照，但新的解释必须重新运行并校验查询。

### 开发备注

运行 `pnpm exec vitest run packages/insight/insight-evidence/tests` 执行针对性测试。Web bundle 的 `presets/insight-agent.patch.yml` 包含此插件。
