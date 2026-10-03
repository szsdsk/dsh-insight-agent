---
description: "连接 Insight 工作台与 Insight MCP 工具的 Session 级 Remote 桥接。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-insight-controller

[English](README.md) | 中文

## 概述

可视化工作台在当前 Session 中运行指定的 Insight MCP 操作并接收已校验查询结果。原有分析文档与独立版本化的诊断任务、报告保存在 workspace 的 `.insight/` 目录。浏览器提供的数据行不会进入 Agent 证据存储，调用方不能任意选择保存路径。`./report` 导出浏览器工作台与 Agent 任务工具共用的纯函数 `diagnosticHtml` 和 `displayCell`，生成经过转义、不含脚本、内嵌 SVG 图表的离线报告。

## 目录

- [Remote API](#remote-api)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="remote-api"></a>
## Remote API

命名空间包含单源分析的 `register`、`relations`、`describe`、`execute`、`result`、`save`、`load`，以及 `preview`、`registerSelected`、`diagnose`、`compare`、`saveTask`、`listTasks` 和 `saveReport`。诊断方法在返回结果前校验查询 ID。任务在 `.insight/diagnostics/tasks/` 保存可复用字段与指标，不保存运行时数据源 ID；仅当数据源身份与完整 Remote 结果字段和同一 Session 发出的已校验结果一致时，报告才在 `.insight/diagnostics/reports/` 保存独立运行快照。返回并暂存结果前会去除仅供 MCP 使用的元数据。原有 `InsightProject` 仍以版本 1 保存在会话目录。

包根入口导出 Host 服务，`./client` 单独公开浏览器入口，避免 Client 分析加载 Host 文件系统代码。`./remote` 提供工作台调用的生成 Remote 方法。

任务中的字段对应和指标通过 Remote API 保留可选依据与定义。比较只向 MCP 发送计算字段。已取消的工具响应会在更新暂存诊断结果前被拒绝。报告 ID 不可变：保存到已有 ID 时会失败，并保留该文件。质量结果保留有限行号与单元格样例。报告复盘内容须与同一运行查询的已接受 `submit_analysis` 结果完全相同；浏览器任意填写的文字会被拒绝。离线报告分别展示复盘结论、已校验数值单元格、假设、限制及待验证业务解释。

<a id="model-experience"></a>
## 模型体验

无；Remote 桥接自身不注册提示词、工具 Schema 或结果文本。

#### KV Cache 影响

无直接影响；Insight MCP 和证据包拥有模型可见的工具定义与结果文本。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 结果引用仅在当前 MCP 运行期间有效。保存的快照仍可查看，但用于新解读前必须重新运行。
- v1 项目格式为每个 Session 保存一个分析和一个结果快照。
- 浏览器上传通过 `storeUpload` 写入工作区相对路径；诊断 API 只接受选定区域的 CSV/XLSX。

**运行时不变量：** 不发布 companion；Host 服务和生成的 Remote 产物共享此包的生命周期。

<a id="dev-note"></a>
### 开发备注

无。
