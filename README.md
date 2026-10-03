# InsightAgent

English | [中文](README.zh.md)

InsightAgent is a local data analysis workbench and agent built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Ask the agent to compare two periods, inspect data quality, drill into changes, and save a report and reusable task. You can also configure analyses in the Web interface and inspect tables and charts. The agent's factual claims must cite queries executed and verified in the current session.

## What you can do

| Capability | Available behavior |
|---|---|
| Analyze local data | Use XLSX, CSV, SQLite, and DuckDB files inside the selected workspace. |
| Diagnose two periods | Preview two XLSX/CSV tables, select worksheets and data rows, link fields, inspect quality, compare up to three measures and two dimensions, and download an offline HTML report. |
| Reuse a task | Save named calculations, rerun with replacement files in a new session or after restart, and confirm incompatible fields before updating the original task. |
| Drill into changes | Inspect up to two levels of observed groups with verified queries; retain previous reports when saving a new result. |
| Save a review | Include accepted query-backed conclusions, assumptions, limitations, and business hypotheses in JSON and offline HTML reports. |
| Configure results | Choose fields, filters, date granularity, sorting, Top N, and supported joins in the Web workbench. |
| Inspect evidence | View query results and charts; `submit_analysis` accepts current-session verified query IDs and checks cited numeric cells. |
| Evaluate the agent | Run deterministic office fixtures, 30 frozen office tasks, synthetic SQL cases, and the fixed BIRD Mini-Dev manifest from `evals/`. |

The workbench runs deterministic table diagnosis and comparison; the agent plans analysis, resolves field ambiguity, interprets results, and states business causes as hypotheses. SQL execution is read-only. Data paths must stay inside the configured workspace.

## Get started <a id="run"></a><a id="run-from-source"></a>

Follow the [Windows setup and launch guide](docs/insight-agent/README.md) to install Node.js, pnpm, and Python dependencies, configure a DeepSeek model provider, and start the Web app from this repository. Set `INSIGHT_WORKSPACE` before launch and select that same directory in the Web interface; `INSIGHT_AGENT_PYTHON` selects the Python interpreter with `insight-mcp` installed.

Create a new blank session with the InsightAgent preset. Import the [sample sales workbook](examples/insight-agent/insight-sales-demo.xlsx), configure an analysis, and compare the table and chart with the [expected results](examples/insight-agent/README.md). Ask the agent to explain the result and inspect the accepted query evidence. The guide also covers verification commands and evaluation.

For the two-period workflow, compare the [expense baseline](evals/data/office/expense-baseline.csv) and [current table](evals/data/office/expense-current.csv) in the diagnostic tab. The [offline example report](evals/examples/expense-diagnostic.html) shows the verified result.

To run the same workflow through the agent, send this request in an InsightAgent chat with this repository selected as the workspace:

> Compare evals/data/office/expense-baseline.csv with evals/data/office/expense-current.csv. Map Amount to Cost, sum every physical row without deduplication, and retain missing departments. Use Document as the uniqueness key and analyze Department and Project. Check quality, verify the queries, and save a review and reusable task named Expense review. Treat business causes as hypotheses that require validation.

The sample totals are 50 and 63, a change of 13 (26%). Continue by asking to drill into Department=A and then Project=P1. In a new session, ask to rerun the saved task with [the replacement current table](evals/data/office/expense-current-v2.csv). The agent registers fresh sources and saves a new report; incompatible fields require confirmation. See the [evaluation guide](evals/README.md) for recorded evidence and formal batches; the 80% target requires a complete 30-task model run.

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
