---
description: "InsightAgent 的 DSH 右侧栏可视化分析工作台。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-insight-workbench

[English](README.md) | 中文

## 概述

用户无需模型凭据即可对 workspace 中的 CSV、XLSX、SQLite 或 DuckDB 数据配置并运行已校验的分析。分析视图支持一次显式关联、日期分组、指标、过滤、排序、Top N、结果表和 ECharts 图表，并导出 UTF-8 CSV 与带查询标识的 PNG。诊断视图上传两份 CSV/XLSX 文件、预览物理行、选择工作表和区域、对应字段、检查质量、比较最多三个指标与两个维度，并下载不含脚本的 HTML 报告。保存的分析状态和诊断报告在显式重跑前都是历史快照。

## 目录

- [恢复保存的分析](#restore-saved-analysis)
- [诊断任务与报告](#diagnostic-tasks-and-reports)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="restore-saved-analysis"></a>
## 恢复保存的分析

重新打开后，点击**导入数据**重新连接保存的文件。重新导入相同路径和格式会保留选定表、关联键、维度、指标、过滤、排序和行数上限；导入不同文件会清空这些配置。每次显式运行分析都会先重新注册文件，避免 MCP 重启或文件变化后复用失效的数据源 ID。取消后的响应不会替换当前快照，解释失败也会保留已有结果。

<a id="diagnostic-tasks-and-reports"></a>
## 诊断任务与报告

诊断页在登记文件前预览最多十二个物理行。同名列自动对应；用户确认异名字段、最多三个指标、两个维度、两期共用过滤条件、Top N 和可选唯一键。具名任务保存选定区域与已确认计算配置，不保存运行时数据源 ID。重新载入任务后须上传两份新文件并检查兼容性。每次成功运行单独保存包含两个文件指纹、分类质量发现、指标变化、分组贡献及查询证据的报告；取消或失败会保留之前显示的报告。下载的 HTML 会转义文件与查询文字，并嵌入无外部脚本的静态 SVG 图像。

<a id="model-experience"></a>
## 模型体验

间接影响；显式的“解释”操作会提交一条用户请求，而 Insight MCP 工具拥有结果文本。

#### KV Cache 影响

解释请求只添加一个较短的结果引用；查询数据行仅通过 Agent 的结果工具调用进入上下文。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 配置编辑器支持一个显式双表关联和一行过滤条件。
- 重启或数据源变化后，保存的结果是历史快照；重新运行前不能用于解释。
- 初始图表映射使用第一列作为 X、第二列作为 Y；丰富的多系列映射留待后续实现。
- 诊断编辑器处理规则明细表；复杂合并表头、小计区块、自动清洗和业务原因验证不在其范围内。

**运行时不变量：** 不发布 companion；Client 插件拥有这些插槽，并随 Cordis effect 一起释放。

<a id="dev-note"></a>
### 开发备注

无。
