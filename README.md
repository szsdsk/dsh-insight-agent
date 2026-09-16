# InsightAgent

[![CI](https://github.com/szsdsk/dsh-insight-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/szsdsk/dsh-insight-agent/actions/workflows/ci.yml)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-0.1.5--rc.1-4c6ef5)](https://github.com/deepseek-ai/deepseek-harness)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

InsightAgent 是一个基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的证据驱动数据分析 Agent。它面向 CSV、SQLite 和 DuckDB 数据源，通过 Schema 探查、安全 Text-to-SQL、执行反馈与查询证据校验完成分析，并将最终结论绑定到本次会话中真实执行过的 SQL。

项目由可分发的 DSH Preset、只读 Python MCP 数据服务、TypeScript 证据插件和可重复评测框架组成。核心目标是让数据分析 Agent 的结论可验证、执行边界可控制、效果可量化。

## Features

| 能力 | 说明 |
|---|---|
| 多数据源分析 | 支持工作区内的 CSV、SQLite 与 DuckDB 文件 |
| Schema-first 工作流 | 在生成 SQL 前发现表、字段、类型、NULL 与值域分布 |
| 安全 Text-to-SQL | 使用 `sqlglot` 解析 AST，仅允许单条 `SELECT/WITH` 查询 |
| 执行反馈恢复 | SQL 失败后依据真实错误和 Schema 修正并重试 |
| 查询级证据 | 每次成功查询生成稳定 `query_id` 和结果摘要 |
| Session 隔离 | 最终答案只能引用当前 Session 中成功执行的查询 |
| 结构化交付 | `submit_analysis` 输出答案、证据、假设、限制和运行指标 |
| 可重复评测 | 内置 20 条合成用例、BIRD Mini-Dev 固定 100 条清单和消融实验 |

## Architecture

```mermaid
flowchart LR
    U[User question] --> H[DeepSeek Harness]
    H --> P[InsightAgent Preset]
    P --> K[Analysis Skills]
    K --> M[Python stdio MCP]
    M --> G[Workspace path guard]
    G --> Q[Read-only SQL policy]
    Q --> D[(CSV / SQLite / DuckDB)]
    D --> R[Query result + query_id]
    R --> V[Verification]
    V --> E[Session evidence store]
    E --> S[submit_analysis]
    S --> O[Evidence-grounded JSON]
```

InsightAgent 使用固定分析流程：

```text
Discover → Plan → Query → Verify → Report
```

1. 注册工作区内的数据源并探查 Schema。
2. 明确指标口径、粒度、过滤条件、Join 和 NULL 处理。
3. 生成并执行只读 SQL。
4. 检查结果形状、截断、空结果和聚合一致性。
5. 通过 `submit_analysis` 提交带查询证据的最终结论。

## Tool Contract

Python MCP 服务提供以下工具：

| 工具 | 用途 |
|---|---|
| `register_source(path, kind)` | 注册工作区内的数据文件并返回 `source_id` |
| `list_relations(source_id)` | 枚举可用表或受控关系 |
| `describe_relation(source_id, relation)` | 返回字段、类型、可空性和主键信息 |
| `profile_relation(source_id, relation, columns?)` | 统计 NULL、去重数、范围和数值均值 |
| `sample_rows(source_id, relation, limit)` | 获取少量样本以识别数据表示 |
| `execute_sql(source_id, sql, max_rows?)` | 执行经过策略校验的只读 SQL |
| `verify_query(query_id)` | 校验查询策略、结果形状和截断状态 |

TypeScript 插件额外注册 `submit_analysis`。每条 evidence 必须包含 claim 和当前 Session 内有效的 `query_id`；伪造、失败或跨 Session 的查询会被拒绝。

## Requirements

- Windows 10/11；核心 TypeScript 与 Python 模块保持跨平台
- Node.js `22.20.0`
- pnpm `10.14.0`
- DeepSeek Harness `0.1.5-rc.1`
- Conda 或其他 Python `3.11` 隔离环境

当前版本只声明兼容 DSH `0.1.5-rc.1`。DeepSeek Harness 仍处于预稳定阶段，升级前应运行完整回归。

## Quick Start

### 1. Clone and install Node dependencies

```powershell
git clone https://github.com/szsdsk/dsh-insight-agent.git
Set-Location dsh-insight-agent
pnpm install --frozen-lockfile
```

### 2. Create the Python environment

```powershell
conda create -n insight-agent python=3.11
conda run -n insight-agent python -m pip install -e ".\python[dev]"

$pythonPath = (conda run -n insight-agent python -c "import sys; print(sys.executable)").Trim()
```

### 3. Install the DSH Preset

先按照 DeepSeek Harness 文档配置模型 Provider，然后执行：

```powershell
.\scripts\install.ps1 -PythonPath $pythonPath
```

安装脚本会构建 TypeScript 插件，并将 Preset、Skills 与插件复制到：

```text
$DSH_HOME/.agent-presets/insight-agent
```

本机 Python、插件和 Skills 的绝对路径只写入安装目录中的生成配置，不会写回 Git。重启 DSH 后即可选择 `InsightAgent` Preset。

卸载 Preset：

```powershell
.\scripts\uninstall.ps1
```

### 4. Run with the headless profile

```powershell
.\scripts\generate-headless-patch.ps1 -PythonPath $pythonPath

dsh --profile headless `
  --patch .generated\headless.cordis.patch.yml `
  "分析 data/sales.csv，按地区汇总 2025 年销售额。"
```

## Output

最终结果是稳定的 JSON 对象。证据插件不会复制完整数据行，只保留验证结论所需的 SQL 和结果摘要。

```json
{
  "answer": "2025 年 East 地区销售额为 128000 元。",
  "evidence": [
    {
      "query_id": "qry_8f61...",
      "claim": "2025 年 East 地区销售额为 128000 元。",
      "sql": "SELECT region, SUM(revenue) ...",
      "data_source": "src_32d1...",
      "result_summary": {
        "columns": ["region", "revenue"],
        "row_count": 3,
        "truncated": false,
        "digest": "sha256:..."
      }
    }
  ],
  "assumptions": [],
  "limitations": [],
  "model": "deepseek-chat",
  "steps": 8,
  "elapsed_ms": 4200,
  "sql_attempts": 2,
  "invalid_sql_count": 1,
  "recovered": true
}
```

## Security Model

安全约束在数据执行层实现，不依赖模型遵守提示词：

- 数据路径必须解析到当前 workspace 内；拒绝 `..`、外部绝对路径和符号链接逃逸。
- 每次数据源操作都会重新验证真实路径，防止注册后的符号链接替换。
- SQLite 使用只读 URI 与 `query_only`。
- DuckDB 文件使用只读连接，并关闭外部文件访问。
- CSV 在路径校验后物化为受控内存关系，再关闭外部访问。
- SQL 必须是单条 `SELECT/WITH`；拒绝 DML、DDL、`ATTACH`、`COPY`、`INSTALL`、`LOAD`、`PRAGMA` 和多语句。
- 拒绝 `read_*`、`*_scan`、HTTP 和其他外部读取函数。
- 默认最多返回 200 行，硬上限 5,000 行；默认超时 10 秒，硬上限 30 秒。
- `submit_analysis` 只接受当前 Session 中成功执行的查询 ID。
- 密钥、完整数据集和敏感结果行不会写入插件日志。

对于来源不可信的数据库文件，仍建议在低权限容器或虚拟机中运行。数据库内容安全与操作系统级隔离不属于本项目的信任边界。

## Evaluation

评测逻辑复用产品 Agent 的 Persona、Skills、MCP 服务与证据插件。真实 Benchmark 不在 CI 中运行，避免消耗模型额度并防止随机波动影响合并。

### Suites

- **Synthetic**：20 条确定性用例，覆盖聚合、过滤、Join、时间边界、NULL、窗口函数、歧义、SQL 恢复和危险 SQL。
- **BIRD Mini-Dev**：通过 `BIRD_DATA_ROOT` 引用外置官方数据，仓库只保存 100 条固定索引，不提交数据库与 Gold SQL。

### Variants

- Direct SQL
- Standard DSH + data MCP
- InsightAgent
- InsightAgent without Schema exploration
- InsightAgent without SQL verification
- InsightAgent without evidence enforcement

### Metrics

- Execution Accuracy
- Task Success Rate
- Dangerous SQL Block Rate
- Invalid SQL Rate
- Recovery Rate
- Result Consistency Rate
- Average Steps
- P50 / P95 Latency
- Token Cost and Cost CV（Provider 提供 usage 时）

### Run the synthetic suite

```powershell
$env:INSIGHT_MODEL_LABEL = "provider/model"

pnpm eval -- `
  --python $pythonPath `
  --suite synthetic `
  --variants "direct-sql,standard-dsh,insight-agent,no-schema,no-verification,no-evidence" `
  --repeats 3
```

### Run BIRD Mini-Dev

下载 [BIRD Mini-Dev](https://github.com/bird-bench/mini_dev) SQLite 数据并放在仓库外：

```powershell
$env:BIRD_DATA_ROOT = "D:\datasets\bird-mini-dev"

pnpm eval:bird:manifest
pnpm eval -- `
  --python $pythonPath `
  --suite bird `
  --variants "direct-sql,standard-dsh,insight-agent,no-schema,no-verification,no-evidence"
```

运行记录写入 `evals/runs/*.json`，汇总报告写入 Markdown。失败样本不会被过滤，缺失 Token 成本显示为 `N/A`，不会按零处理。

### Acceptance targets

| 验收项 | 目标 |
|---|---:|
| Synthetic task success | ≥ 80% |
| Dangerous SQL block rate | 100% |
| BIRD EX improvement over Direct SQL | ≥ 10 percentage points |

上述数值是验收门槛，不是预填的实验结果。评测报告会根据实际运行数据输出 PASS/FAIL。

## Development

TypeScript：

```powershell
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run check:config
```

Python：

```powershell
conda run -n insight-agent python -m pytest python/tests --cov=insight_mcp
```

CI 运行 TypeScript 单测、Python 单测、真实 MCP stdio 协议测试、Preset 结构检查和固定数据库回归，不调用真实模型。

## Repository Layout

```text
agent.cordis.yml              DSH product Preset
preset.yml                    Preset metadata
skills/                       Analysis workflow Skills
src/                          TypeScript evidence plugin
python/src/insight_mcp/       Read-only MCP data service
python/tests/                 Python and MCP integration tests
evals/                        Synthetic/BIRD suites and reports
scripts/                      Install, uninstall and config tools
.github/workflows/ci.yml      Deterministic no-model CI
```

## Limitations

Version 1 does not include Excel ingestion, chart generation, RAG, multi-Agent orchestration, a custom Web UI, or Spider 2.0. These capabilities are intentionally deferred so the initial release can focus on read-only execution, evidence integrity and reproducible evaluation.

## License

This project is licensed under the [MIT License](LICENSE).

`agent.cordis.yml` is adapted from the official DeepSeek Harness Standard Preset. Upstream attribution is documented in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
