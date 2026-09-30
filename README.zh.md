# InsightAgent

[English](README.md) | 中文

InsightAgent 是基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 构建的本地数据分析工作台与 Agent。在 Web 界面配置分析、查看结果表格和图表后，可以让 Agent 解释已校验的结果并推荐下一步分析。Agent 的事实性结论必须引用当前会话中执行并校验过的查询。

## 可以做什么

| 能力 | 当前行为 |
|---|---|
| 分析本地数据 | 使用所选工作区内的 XLSX、CSV、SQLite 和 DuckDB 文件。 |
| 双期诊断复盘 | 预览两份 XLSX/CSV，选择工作表和数据行，对应字段，检查质量，比较最多三个指标和两个维度，并下载离线 HTML 报告。 |
| 复用任务 | 保存具名字段映射和指标口径，替换两份文件，生成单独校验的运行报告。 |
| 配置分析结果 | 在 Web 工作台选择字段、过滤条件、日期粒度、排序、Top N 和受支持的关联方式。 |
| 查看查询证据 | 查看查询结果和图表；`submit_analysis` 只接受当前会话已校验的 `query_id`，并核对引用的数值单元格。 |
| 评测 Agent | 运行 `evals/` 中的确定性办公样例、冻结的 30 个办公任务、合成 SQL 题和固定 BIRD Mini-Dev 题集。 |

工作台执行确定性的表格诊断与比较；Agent 制定分析计划、处理字段歧义、解释结果，并将业务原因列为待验证解释。SQL 只读执行。数据路径必须位于已配置的工作区内。

## 开始使用 <a id="run"></a><a id="run-from-source"></a>

按照 [Windows 安装与启动指南](docs/insight-agent/README.zh.md)安装 Node.js、pnpm 和 Python 依赖，配置 DeepSeek 模型 Provider，并从本仓库启动 Web。启动前设置 `INSIGHT_WORKSPACE`，然后在 Web 界面选择同一目录；`INSIGHT_AGENT_PYTHON` 指向已安装 `insight-mcp` 的 Python 解释器。

新建空白会话并选择 InsightAgent Preset。导入[销售示例工作簿](examples/insight-agent/insight-sales-demo.xlsx)，配置分析，将表格和图表与[预期结果](examples/insight-agent/README.zh.md)核对，再让 Agent 解释结果并查看已接受的查询证据。指南还提供验证命令和评测说明。

双期流程可在诊断页比较[上期费用表](evals/data/office/expense-baseline.csv)和[本期费用表](evals/data/office/expense-current.csv)，并用[离线示例报告](evals/examples/expense-diagnostic.html)核对已校验结果。

## 仓库目录

| 目录 | 职责 |
|---|---|
| `packages/client/ui-insight-workbench/` | 数据选择、分析配置、表格和图表 |
| `packages/api/insight-controller/` | Web 会话与数据服务连接 |
| `packages/insight/insight-evidence/` | 会话证据与 `submit_analysis` |
| `packages/bundle/web-app/` | 随 Web 发布的 InsightAgent Preset 和分析 Skills |
| `python/insight-mcp/` | 只读数据服务与 SQL 策略 |
| `evals/`、`examples/insight-agent/` | 评测运行器与可复现示例数据 |

完整目录说明见 [InsightAgent 指南](docs/insight-agent/README.zh.md)。参与开发可先阅读[开发指南](docs/development.zh.md)、[架构文档](docs/architecture.zh.md)和 [Agent 指令](AGENTS.md)。

[InsightAgent GitHub Actions 工作流](.github/workflows/insight-agent.yml)在 `main` 和拉取请求中检查 Web 构建、分析软件包、Preset 集成及 Python 数据服务。继承的 DeepSeek Harness 工作流面向其 `master` 分支，并使用独立的发布和服务凭据。

## 来源与许可

本仓库整合了 DeepSeek AI 开发的 DeepSeek Harness，采用 [MIT 许可证](LICENSE)。第三方致谢见[仓库声明](THIRD_PARTY_NOTICES.md)和 [InsightAgent 声明](docs/insight-agent/THIRD_PARTY_NOTICES.zh.md)。
