---
description: "连接 Insight 工作台与 Insight MCP 工具的 Session 级 Remote 桥接。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-insight-controller

[English](README.md) | 中文

## 概述

可视化工作台可以在当前 Session 中运行指定的 Insight MCP 操作，只接收已校验的查询结果，并在 workspace 的 `.insight/` 目录保存一份带版本的分析文档。它拒绝重叠分析，并等待 Agent 空闲。浏览器提供的数据行不会成为证据，调用方也不能任意选择保存路径。

## 目录

- [Remote API](#remote-api)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="remote-api"></a>
## Remote API

命名空间包含 `register`、`relations`、`describe`、`execute`、`result`、`save` 和 `load`。前五个方法委托给 Insight MCP 的稳定协议。保存和加载接受带版本的 `InsightProject` 契约，并从 Agent workspace 和标识派生存储路径；调用方不能指定任意输出路径。

包根入口导出 Host 服务，`./client` 单独公开浏览器入口，避免 Client 分析加载 Host 文件系统代码。`./remote` 提供工作台调用的生成 Remote 方法。

<a id="model-experience"></a>
## 模型体验

无；Remote 桥接自身不注册提示词、工具 Schema 或结果文本。

#### KV Cache 影响

无直接影响；Insight MCP 和证据包拥有模型可见的工具定义与结果文本。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 结果引用仅在当前 MCP 运行期间有效。保存的快照仍可查看，但用于新解读前必须重新运行。
- v1 项目格式为每个 Session 保存一个分析和一个结果快照。
- 此命名空间不提供上传传输；v0.2 注册当前 workspace 中已有的文件。

**运行时不变量：** 不发布 companion；Host 服务和生成的 Remote 产物共享此包的生命周期。

<a id="dev-note"></a>
### 开发备注

无。
