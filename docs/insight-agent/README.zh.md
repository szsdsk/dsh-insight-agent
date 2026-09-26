# InsightAgent

[English](README.md) | 中文

InsightAgent 是构建在本仓库 DeepSeek Harness 工作区中的可视化、证据驱动数据分析产品。Web 工作台配置工作区内 XLSX、CSV、SQLite 和 DuckDB 文件的分析；Agent 解释已校验结果并推荐后续分析。

## 仓库目录

| 路径 | 职责 |
|---|---|
| `packages/client/ui-insight-workbench/` | 文件选择、分析配置、结果表格和图表 |
| `packages/api/insight-controller/` | 会话级 Web 与 MCP 连接 |
| `packages/insight/insight-evidence/` | `submit_analysis` 和会话级查询证据 |
| `packages/bundle/web-app/presets/insight-agent.patch.yml` | 随 Web 发布的 InsightAgent Persona 和数据工具 |
| `packages/bundle/web-app/insight-skills/` | 分析流程 Skills |
| `python/insight-mcp/` | 只读数据服务与 SQL 策略 |
| `evals/` | Synthetic 与 BIRD 评测用例及运行器 |
| `examples/insight-agent/` | 可复现工作簿与预期结果 |

Web bundle 将 InsightAgent 声明为默认 Preset。Preset 配置由 DSH 声明式 bundle 管理，无需单独安装或复制配置。通过 `INSIGHT_AGENT_PYTHON` 选择 Python 解释器。

## 在 Windows 上构建和运行

需要 Node.js 22.20.0、pnpm 11.7.0 和 Python 3.11。运行 Agent 分析前，应先在 DSH 中配置 DeepSeek 模型 Provider。

```powershell
pnpm install --frozen-lockfile
pnpm run build:lib
pnpm run build:web

conda create -n insight-agent python=3.11
conda run -n insight-agent python -m pip install -e ".\python\insight-mcp[dev]"
$env:INSIGHT_AGENT_PYTHON = (conda run -n insight-agent python -c "import sys; print(sys.executable)").Trim()
$env:INSIGHT_WORKSPACE = (Get-Location).Path
$env:DSH_HOME = Join-Path (Get-Location) '.generated\dsh-home'
pnpm dsh web
```

打开显示的本地 URL，新建空白会话；默认应选中 InsightAgent。使用示例工作簿时，选择本仓库作为工作区，导入 `examples/insight-agent/insight-sales-demo.xlsx`。工作簿包含 `订单` 和 `客户` 两个工作表，预期结果见[示例说明](../../examples/insight-agent/README.zh.md)。

所选工作区必须与 `INSIGHT_WORKSPACE` 一致；Web Profile 启动时会固定此目录。分析其他文件夹时，先将 `INSIGHT_WORKSPACE` 设为该目录，再启动 DSH 并在 Web 界面选择同一目录。数据路径必须位于该目录内。MCP 所用解释器需要按上方命令安装可编辑的 `insight-mcp` 包。若旧 Profile 保存了其他 Preset 选择，验收时请使用新的 `DSH_HOME`。

## 验证

```powershell
node --experimental-strip-types scripts/insight/check-config.ts
node_modules/.bin/vitest.cmd run packages/insight/insight-evidence/tests
conda run -n insight-agent python -m pytest python/insight-mcp/tests
```

浏览器验收时，运行一次分析并确认表格和图表，再请求 Agent 解释。每条事实性结论都应引用同一会话中由 `execute_sql` 或 `execute_analysis` 产生、通过 `verify_query` 且被 `submit_analysis` 接受的 `query_id`。

评测 CLI 位于 `evals/`；`pnpm run insight:eval -- --python <python-path>` 运行 headless 变体。调用真实模型的评测需要 Provider 凭据，不属于确定性 CI。

## 来源与许可

本仓库整合的 DeepSeek Harness 遵循根目录的 [MIT 许可证](../../LICENSE)。InsightAgent 的第三方致谢见[项目说明](THIRD_PARTY_NOTICES.zh.md)；DSH 的致谢仍在仓库根目录。
