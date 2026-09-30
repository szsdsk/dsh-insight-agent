---
description: "InsightAgent 的会话级查询证据与 submit_analysis 工具。"
kind: "package-reference"
---

# @deepseek-ai/dsh-insight-evidence

[English](README.md) | 中文

## 概述

搭配 InsightAgent 加载此包，可要求最终回答有查询证据，并提交有限范围的双期计划。只有同一 Agent 会话中成功执行的 `execute_sql`、`execute_analysis`、`diagnose_table` 或 `compare_tables` 查询通过校验后，其 `query_id` 才能支持 `submit_analysis` 中的结论。数值事实引用精确结果行列；插件根据保留的有限结果行核对数值，并在提交前重新检查源文件。Agent 结束时清除证据；后续会话必须重新运行并校验查询。

## 目录

- 模型体验
- 已知限制与待完成工作
- 开发备注

## 模型体验

### submit_analysis

#### 模型看到的内容

`submit_analysis` 接收答案、至少一条包含 `query_id` 的结论、可选的精确数值事实（`name`、`query_id`、从零开始的 `row`、`column`、`value`），以及假设和限制。结构化结果保留 SQL、数据源、校验状态、结果摘要和已核对数值；模型可见文本返回已接受的答案、查询 ID 和已核对数值。不存在、失败、过期、未校验、跨会话的查询 ID，以及越界或不一致的单元格会被拒绝。查询关联不会语义验证文字结论。

#### Token 影响

InsightAgent Preset 提供稳定的工具 Schema。计划和查询结果会将当前会话的证据加入后续模型请求；Agent 结束时清除这些状态。

#### KV Cache 影响

稳定的工具 Schema 可以复用模型请求前缀。每次结果会把当前会话的计划或查询详情加入后续请求，因此结果 Token 会随分析增长。

### 双期计划

#### 模型看到的内容

`submit_diagnostic_plan` 校验两个不同的数据源、1–32 个带依据的具名字段对应、1–3 个带定义的指标、最多两个维度、最多八个两期共用的分组范围过滤条件、可选键字段和 Top N。`execute_diagnostic_plan` 运行质量检查、比较与校验。默认 `maxDiagnosticCorrections: 2` 允许两次计划修正和两次执行重试；加载时只接受 0–5 的整数。`enableDiagnosticPlan: false` 在对照实验中移除两个规划工具。

#### Token 影响

计划增加有限的字段对应和指标定义。执行结果返回查询 ID、质量计数、总体指标，以及每个下钻结果最多十个分组；完整数据行可通过 `get_query_result` 获取。

#### KV Cache 影响

规划工具的 Schema 在多个回合保持稳定。提交的计划和执行结果会在请求后缀增加变化的 Token。

## 已知限制与待完成工作

- 证据只保存在运行中的 Agent 内存中。重启后仍可查看历史报告，但新的解释必须重新运行并校验查询。数值核对不能证明文字中的业务原因。
- 不发布运行时不变量伴随模块；查询证据和诊断计划各自只有一份会话内权威记录。

### 开发备注

运行 `pnpm exec vitest run packages/insight/insight-evidence/tests` 执行针对性测试。Web bundle 的 `presets/insight-agent.patch.yml` 包含此插件。
