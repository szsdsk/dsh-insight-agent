# dsh-insight-agent

一个基于 DeepSeek Harness 的可验证数据分析 Agent。它不是聊天式 BI 演示：每个最终事实都必须来自本 Session 中真实成功的只读 SQL，并携带可追踪的 `query_id`。

当前版本面向 CSV、SQLite 和 DuckDB，重点展示 Agent 应用开发岗位最看重的四件事：工具设计、安全边界、运行时状态约束和可重复评测。

> Status: v1 implementation。TypeScript、Python 和真实 MCP stdio 测试均已通过；真实模型 Benchmark 需要你自己的 DSH provider/model 配置和外置 BIRD Mini-Dev 数据。仓库不会提交模型凭据或 BIRD 数据。

## Architecture

```mermaid
flowchart LR
    U[User question] --> D[DeepSeek Harness 0.1.5-rc.1]
    D --> P[InsightAgent persona + 5 skills]
    P --> M[Python stdio MCP]
    M --> G[Workspace path guard]
    G --> S[sqlglot read-only policy]
    S --> DB[(CSV / SQLite / DuckDB)]
    DB --> Q[query_id + stable result digest]
    Q --> V[verify_query]
    V --> E[TypeScript evidence store]
    E --> A[submit_analysis]
    A --> O[Evidence-grounded JSON answer]
    O --> R[Eval JSON + Markdown report]
```

工作流固定为：探查 → 计划 → 查询 → 验证 → 报告。Schema、SQL 和结果校验是实际工具调用，不是提示词里的一句“请仔细检查”。

## What is implemented

- 基于官方 Standard Preset 的根目录 DSH Preset，保留 Shell、文件、Skills、Plan、Goal、Compaction、Workflow 等能力。
- 5 个仓库内 Skills：数据探查、分析规划、Text-to-SQL、结果验证、报告生成。
- Python stdio MCP：`register_source`、`list_relations`、`describe_relation`、`profile_relation`、`sample_rows`、`execute_sql`、`verify_query`。
- TypeScript `submit_analysis` 插件：按 Session 隔离证据，只接受本 Session 成功执行的 `query_id`，Session 销毁后清理状态。
- 20 条自建用例、BIRD Mini-Dev 固定 100 条索引清单、Direct SQL / Standard DSH / InsightAgent 对比以及 3 个消融配置。
- JSON 与 Markdown 报告：EX、任务成功率、危险 SQL 拦截率、无效 SQL 率、恢复率、结果一致率、步骤、P50/P95 延迟、Token 成本与成本变异系数，并自动输出验收门槛 PASS/FAIL。
- CI 只跑确定性单测、MCP stdio 集成、配置检查与固定数据库回归，不消耗真实模型额度。

## Requirements

- Windows 10/11（v1 的首要开发平台；核心 Python/TypeScript 代码保持跨平台）
- Node.js `22.20.0`
- pnpm `10.14.0`
- DeepSeek Harness `0.1.5-rc.1`
- Conda 环境 `insight-agent`，Python `3.11`

DSH 仍处于预稳定阶段。本项目只声明兼容 `0.1.5-rc.1`，升级应在独立分支运行完整回归。

## Installation

项目不 fork DeepSeek Harness。先配置 DSH 与模型 provider，再创建隔离的 Python 环境：

```powershell
conda create -n insight-agent python=3.11
conda run -n insight-agent python -m pip install -e ".\python[dev]"
```

取得解释器位置：

```powershell
$pythonPath = (conda run -n insight-agent python -c "import sys; print(sys.executable)").Trim()
$pythonPath
```

然后安装 Node 依赖、构建插件并将 Preset 复制到 DSH Home。`PythonPath` 必须传上一步输出的绝对路径：

```powershell
pnpm install --frozen-lockfile
.\scripts\install.ps1 -PythonPath $pythonPath
```

安装脚本会生成包含本机 Python/Skills 绝对路径的已安装配置；这些路径只存在于 `$DSH_HOME/.agent-presets/insight-agent`，不会写回 Git。重启 DSH 后选择 `InsightAgent` Preset。

卸载只删除已安装 Preset，不删除仓库或 Conda 环境：

```powershell
.\scripts\uninstall.ps1
```

## Example

用户：

```text
分析 data/sales.csv，告诉我 2025 年各地区销售额和同比变化。
```

Agent 的关键调用应类似：

```text
register_source → list_relations → describe_relation → profile_relation
→ execute_sql → verify_query → submit_analysis
```

最终交付是稳定 JSON，其中 evidence 将 claim、`query_id`、规范化 SQL、数据源 ID 和结果摘要绑定在一起：

```json
{
  "answer": "East 地区 2025 年销售额为 …",
  "evidence": [
    {
      "query_id": "qry_…",
      "claim": "East 地区 2025 年销售额为 …",
      "sql": "SELECT …",
      "data_source": "src_…",
      "result_summary": {
        "columns": ["region", "revenue"],
        "row_count": 3,
        "truncated": false,
        "digest": "sha256:…"
      }
    }
  ],
  "assumptions": [],
  "limitations": [],
  "model": "…",
  "steps": 8,
  "elapsed_ms": 4200,
  "sql_attempts": 2,
  "invalid_sql_count": 1,
  "recovered": true
}
```

完整数据行不会被证据插件复制到日志或最终审计对象。

## Security model

这套边界位于执行层，不能靠模型忽略提示词绕过：

- 数据路径必须真实解析在当前 workspace 内；拒绝 `..`、外部绝对路径和逃逸到外部的符号链接。
- SQLite 使用 `mode=ro` 和 `query_only`；DuckDB 文件使用 `read_only=True` 并关闭外部访问；CSV 在校验路径后物化为受控内存关系，再关闭外部访问。
- `sqlglot` 要求恰好一条 `SELECT/WITH` 查询。DML、DDL、`ATTACH`、`COPY`、`INSTALL`、`LOAD`、`PRAGMA`、多语句和外部读取函数全部拒绝。
- 默认最多返回 200 行，硬上限 5,000 行；默认超时 10 秒，配置硬上限 30 秒。
- Decimal、日期时间、二进制、NULL 与非有限浮点统一转为稳定 JSON；`query_id` 绑定数据源、规范化 SQL 和结果摘要。
- `submit_analysis` 不接受伪造、失败或跨 Session 的查询 ID；插件销毁或 Session 结束即清理内存状态。

本项目不承诺数据库文件本身不含恶意视图或超大计算，也不替代操作系统权限隔离。对不可信数据库，应额外放进低权限容器或虚拟机。

## Development and tests

TypeScript：

```powershell
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run check:config
```

Python（必须使用 `insight-agent` 环境）：

```powershell
conda run -n insight-agent python -m pytest python/tests --cov=insight_mcp
```

测试覆盖 SQL 策略、路径穿越/符号链接、CSV/SQLite 数据兼容、NULL 与稳定序列化、真实 MCP stdio 流程、证据伪造/跨 Session/清理、Preset 结构和 Eval 指标。

## Evaluation

### Synthetic suite

20 条用例定义在 `evals/data/synthetic/cases.json`，覆盖聚合、过滤、Join、时间、NULL、去重、窗口函数、歧义、SQL 错误恢复和 4 类危险 SQL。数据库由提交的 `schema.sql` 确定性生成，不提交二进制数据库。

在同一 DSH provider、model 和推理配置下运行全部对比，每条重复 3 次：

```powershell
$env:INSIGHT_MODEL_LABEL = "your-provider/your-model"
pnpm eval -- --python $pythonPath --suite synthetic --variants "direct-sql,standard-dsh,insight-agent,no-schema,no-verification,no-evidence" --repeats 3
```

### BIRD Mini-Dev

从 [BIRD Mini-Dev 官方数据集](https://github.com/bird-bench/mini_dev)下载 SQLite 版本并放在仓库外。仓库只提交 100 个固定行索引，不提交问题、Gold SQL 或数据库。

```powershell
$env:BIRD_DATA_ROOT = "D:\datasets\bird-mini-dev"
pnpm eval:bird:manifest
pnpm eval -- --python $pythonPath --suite bird --variants "direct-sql,standard-dsh,insight-agent,no-schema,no-verification,no-evidence"
```

`eval:bird:manifest` 会验证固定索引都是 `SELECT/WITH`，并在 `.generated` 写入带数据集 SHA-256 的解析清单。每次运行的完整记录写到 `evals/runs/*.json`，汇总写到 Markdown；失败样本不会被过滤。

指标定义：

- Execution Accuracy（EX）：候选 SQL 与 Gold SQL 在同一只读数据库上的结果等价率。
- Task Success：EX 正确且满足任务特定要求；恢复用例还要求先失败后成功。
- Invalid SQL Rate：失败 SQL 次数 / SQL 尝试次数。
- Recovery Rate：发生 SQL 失败的任务中，随后获得有效查询的比例。
- Stability：使用 `--repeats 3` 后按任务比较规范化结果指纹，报告结果一致率；原始重复记录全部保留。
- Token Cost：仅在 provider/导出数据提供 usage 时统计总成本与成本变异系数（CV）；缺失显示 `N/A`，绝不当成 0。

v1 验收目标：自建 20 条任务成功率至少 80%，危险 SQL 拦截率 100%；BIRD 固定 100 条相对 Direct SQL 基线提升至少 10 个百分点。这些是待真实运行验证的门槛，不是预填结果。

| Variant | Synthetic success | Unsafe blocked | BIRD EX | P95 latency | Cost |
|---|---:|---:|---:|---:|---:|
| Direct SQL | pending | N/A | pending | pending | pending |
| Standard DSH + data MCP | pending | pending | pending | pending | pending |
| InsightAgent | pending | pending | pending | pending | pending |
| − Schema exploration | pending | pending | pending | pending | pending |
| − SQL verification | pending | pending | pending | pending | pending |
| − Evidence enforcement | pending | pending | pending | pending | pending |

## Repository layout

```text
agent.cordis.yml              DSH Standard-based product Preset
src/                         TypeScript evidence/submit plugin
skills/                      Five model-invocable analysis Skills
python/src/insight_mcp/      Read-only MCP server and eval bridge
python/tests/                Unit and real stdio integration tests
evals/                       Synthetic/BIRD cases, runner, metrics, reports
scripts/                     Install, uninstall, config generation/checks
.github/workflows/ci.yml     No-model deterministic CI
```

## Scope

v1 不包含 Excel、图表生成、RAG、多 Agent 编排、自定义 Web UI 或完整 Spider 2.0。它们属于 v2；v1 优先把安全、可验证和可量化做实。

## License

MIT。Standard Preset 的上游归属见 `THIRD_PARTY_NOTICES.md`。
