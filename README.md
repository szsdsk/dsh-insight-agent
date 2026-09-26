# InsightAgent

English | [中文](README.zh.md)

InsightAgent is a local data analysis workbench and agent built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Configure an analysis in the Web interface, inspect its table and chart, then ask the agent to explain verified results and recommend the next analysis. The agent's factual claims must cite queries executed and verified in the current session.

## What you can do

| Capability | Available behavior |
|---|---|
| Analyze local data | Use XLSX, CSV, SQLite, and DuckDB files inside the selected workspace. |
| Configure results | Choose fields, filters, date granularity, sorting, Top N, and supported joins in the Web workbench. |
| Inspect evidence | View query results and charts; `submit_analysis` accepts claims only with verified `query_id` values from the same session. |
| Evaluate the agent | Run synthetic cases and the fixed BIRD Mini-Dev manifest from `evals/`. |

The workbench configures and runs analysis; the agent interprets results. SQL execution is read-only. Data paths must stay inside the configured workspace.

## Get started <a id="run"></a><a id="run-from-source"></a>

Follow the [Windows setup and launch guide](docs/insight-agent/README.md) to install Node.js, pnpm, and Python dependencies, configure a DeepSeek model provider, and start the Web app from this repository. Set `INSIGHT_WORKSPACE` before launch and select that same directory in the Web interface; `INSIGHT_AGENT_PYTHON` selects the Python interpreter with `insight-mcp` installed.

Create a new blank session with the InsightAgent preset. Import the [sample sales workbook](examples/insight-agent/insight-sales-demo.xlsx), configure an analysis, and compare the table and chart with the [expected results](examples/insight-agent/README.md). Ask the agent to explain the result and inspect the accepted query evidence. The guide also covers verification commands and evaluation.

## Repository guide

| Directory | Responsibility |
|---|---|
| `packages/client/ui-insight-workbench/` | Data selection, analysis controls, tables, and charts |
| `packages/api/insight-controller/` | Web session and data-service connection |
| `packages/insight/insight-evidence/` | Session evidence and `submit_analysis` |
| `packages/bundle/web-app/` | Shipped InsightAgent preset and analysis skills |
| `python/insight-mcp/` | Read-only data service and SQL policy |
| `evals/`, `examples/insight-agent/` | Evaluation runner and reproducible sample data |

See the [InsightAgent guide](docs/insight-agent/README.md) for the full map. Contributors can start with the [development guide](docs/development.md), [architecture](docs/architecture.md), and [agent instructions](AGENTS.md).

The [InsightAgent GitHub Actions workflow](.github/workflows/insight-agent.yml) checks the Web build, analysis packages, preset integration, and Python data service on `main` and pull requests. The inherited DeepSeek Harness workflows target its `master` branch and use separate release and service credentials.

## Source and license

This repository incorporates DeepSeek Harness, developed by DeepSeek AI, and is distributed under the [MIT license](LICENSE). See the [third-party notices](THIRD_PARTY_NOTICES.md) and [InsightAgent notices](docs/insight-agent/THIRD_PARTY_NOTICES.md).
