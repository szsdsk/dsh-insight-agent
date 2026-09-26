---
description: "InsightAgent 的 DSH 右侧栏可视化分析工作台。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-insight-workbench

[English](README.md) | 中文

## 概述

用户无需模型凭据即可对 workspace 中的 CSV、XLSX、SQLite 或 DuckDB 数据配置并运行已校验的分析。工作台支持一次显式关联、日期分组、指标、过滤、排序、Top N、结果表和 ECharts 图表。它可以导出安全的 UTF-8 CSV 和带查询标识的 PNG 文件。保存的状态会作为历史快照重新打开，不会自动重跑数据或模型操作。

## 目录

- [恢复保存的分析](#restore-saved-analysis)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="restore-saved-analysis"></a>
## 恢复保存的分析

重新打开后，点击**导入数据**重新连接保存的文件。重新导入相同路径和格式会保留选定表、关联键、维度、指标、过滤、排序和行数上限；导入不同文件会清空这些配置。每次显式运行分析都会先重新注册文件，避免 MCP 重启或文件变化后复用失效的数据源 ID。取消后的响应不会替换当前快照，解释失败也会保留已有结果。

<a id="model-experience"></a>
## 模型体验

间接影响；显式的“解释”操作会提交一条用户请求，而 Insight MCP 工具拥有结果文本。

#### KV Cache 影响

解释请求只添加一个较短的结果引用；查询数据行仅通过 Agent 的结果工具调用进入上下文。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- v0.2 接受 workspace 相对路径；浏览器上传传输和操作系统文件选择器留待后续实现。
- 配置编辑器支持一个显式双表关联和一行过滤条件。
- 重启或数据源变化后，保存的结果是历史快照；重新运行前不能用于解释。
- 初始图表映射使用第一列作为 X、第二列作为 Y；丰富的多系列映射留待后续实现。

**运行时不变量：** 不发布 companion；Client 插件拥有这些插槽，并随 Cordis effect 一起释放。

<a id="dev-note"></a>
### 开发备注

无。
