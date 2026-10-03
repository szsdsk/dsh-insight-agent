# InsightAgent 评测

[English](README.md) | 中文

本目录保存可复现的评测数据与基于执行事件的运行器。模型评测分数取决于 DSH 配置的供应商；确定性检查无需 API 密钥。

## 办公诊断任务集

冻结清单包含费用、采购、库存三类表格的 30 个任务，覆盖质量发现、总体指标、一维和二维变化、歧义询问及替换文件分析。CSV 的字段名称与顺序有所变化。独立 Python 预期结果使用 `Decimal` 计算，不调用 Agent 工具。

使用独立的 [`office-development.json`](manifests/office-development.json) 输入开发和诊断提示词。运行 `python evals/office/development.py --check`、`python evals/office/verify.py --development`，再运行 `pnpm insight:eval --python $python --suite office-dev --limit 1 --variants insight-agent`。该任务集使用不同的明细和总额，不设冻结集验收门槛。冻结 CSV 通过 `.gitattributes` 保留清单声明的 CRLF 字节；改变换行会使校验和失效。

```powershell
$env:PYTHONPATH = (Resolve-Path 'python/insight-mcp/src').Path
$python = (Get-Command python).Source # Use the Python where insight-mcp is installed.
& $python evals/office/prepare.py --check
& $python evals/office/verify.py
pnpm insight:eval --python $python --suite office --limit 1 --variants insight-agent
```

首次模型运行用于估算费用并检查轨迹。扩大 `--limit` 或增加 `standard-dsh,no-plan,no-schema` 前，先检查 `evals/runs/` 中的 JSON 和 Markdown 结果。基线使用同一 DSH 模型及 MCP 数据工具；规划与 Schema 消融保持相同只读和证据限制。运行器保存每个任务的 `--json` 原始事件；事件缺失或截断按证据不完整计分。替换文件案例检验兼容性与重新计算；[`web-agent-presets.e2e.ts`](../apps/cli/tests/web-agent-presets.e2e.ts) 中的任务保存集成测试重新启动 Host 组合与 MCP，恢复任务、换文件重算、拒绝旧证据，并检查首份报告保持不变。浏览器任务选择和上传仍需独立验收。

运行器在调用模型前检查所选 Python 能否导入 MCP 服务。如果检查失败，请在该解释器中安装 `python/insight-mcp`。

[离线费用报告](examples/expense-diagnostic.html)基于同一组 CSV 样例，通过真实的 `diagnose_table`、`compare_tables` 和 `verify_query` 调用生成。数据服务或报告渲染器变化后，将 `INSIGHT_AGENT_PYTHON` 设为已安装依赖的 Python 解释器，并在仓库根目录运行 `pnpm exec tsx evals/office/render_example.ts` 重新生成。固定样例的两期总额为 50 和 63。

### 本地 Web 验收，2026-09-29

在 InsightAgent 双期诊断工作台上传费用上期和本期 CSV 样例，表头选第 1 行、数据选第 2–8 行。将 `Amount` 对应到 `Cost`，`total` 指标对该字段求和，维度选 `Department` 与 `Project`，唯一键选 `Document`。浏览器显示已保存的报告：两期各 7 行，总额分别为 50 和 63，变化为 +13，组合维度有 7 个分组，另有两个单维度拆解。下载的 HTML 包含这些总额、7 个分组行、查询证据及内嵌 SVG 和 CSS，未包含外部脚本或样式表引用。本次浏览器运行仅验证这条本地流程，不计入冻结办公任务集的得分。

办公任务变体将 headless JSON 的单字符串上限提高至 24 KiB；单事件 32 KiB 上限仍然适用。截断事件仍视为证据不完整。

如果 DSH 进程沙箱无法为当前检出授予写权限，可用 `--workspace PATH` 指定可写的临时目录。运行器只将冻结的办公 CSV 输入复制到该目录，并在其中运行 Agent。对比各变体时使用同一临时目录。

报告包含任务成功率、质量问题精确率与召回率、指标准确率、重点分组定位、修正次数、步骤、延迟，以及供应商提供时的 Token。费用缺失显示 `N/A`。办公任务成功率 80% 的目标只适用于完整冻结集，不适用于冒烟子集。若针对冻结集失败调整提示词，应记录新的评测版本。

## 公开 Online Retail 案例

[UCI Online Retail](https://archive.ics.uci.edu/dataset/352/online%2Bretail) 提供独立双期演示所需的公开工作簿（Chen，2015，DOI 10.24432/C5BW33；CC BY 4.0）。下载官方 ZIP，并使用已安装 `insight-mcp` 的 Python 3.11 或 3.12：

```powershell
$source = Join-Path $env:TEMP 'uci-online-retail.zip'
Invoke-WebRequest 'https://archive.ics.uci.edu/static/public/352/online%2Bretail.zip' -OutFile $source
$python = (Get-Command python).Source
& $python evals/retail/prepare.py --source $source
& $python evals/retail/oracle.py --source $source
& $python evals/retail/smoke.py
```

固定取数范围为 2011 年 9 月或 10 月的每条明细。`LineRevenue = Quantity × UnitPrice` 将取消交易保留为带符号行；不去重，也不填补客户编号。脚本检查源文件 SHA-256、生成的 CSV 校验和、行数，以及独立计算的总体和分组变化是否与 [`expected.json`](retail/expected.json) 一致。数据服务冒烟还核对两期诊断与有界的 Country、StockCode 比较，包括“其他”分组。生成的 CSV 保存在被忽略的 `evals/runs/retail/`；[`case.json`](retail/case.json) 记录可复用的 Agent 请求。公开演示不计入冻结 30 题的成功率分母。模型运行器支持 `--suite retail` 及 `insight-agent,standard-dsh,no-plan,no-schema`；模型调用前校验两份 CSV，记录其校验和及独立预期文件校验和。评分要求带已接受查询证据的有符号收入、客户缺失、取消记录数量及包含“其他”的两组独立 Top 10 维度分解。取消数量查询使用 `cancellation_rows` 列名；轨迹缺失或截断会失败。这些模型检查独立于确定性冒烟脚本。

## BIRD 辅助评测

将 `BIRD_DATA_ROOT` 指向本地 BIRD mini-dev SQLite 数据副本，并使用 `pnpm insight:bird-manifest` 生成固定 100 题清单。完整批次前先运行 `pnpm insight:eval --python $python --suite bird --limit 1`。使用 `node --experimental-strip-types evals/src/cli.ts bird-evaluator --python $python` 准备官方比较函数。[评测器清单](manifests/bird-ex-evaluator.json)锁定上游版本和脚本 SHA-256。桥接程序仅提取其中的 `calculate_ex` 函数，通过只读 SQLite 连接在 30 秒时限内执行候选与标准 SQL，比较完整结果集，不受 5000 行上限影响。运行器拒绝被修改的脚本或清单生成后变更的数据 JSON，每次公开评测记录数据、选择清单和评测器校验和。BIRD 是辅助 SQL 指标；办公任务完成度是本项目的主要结果。

## 结果解释

`evals/runs/` 保存运行记录、JSONL 轨迹和 Markdown 报告。每次运行使用独立轨迹目录，每份 JSONL 旁保存 `.stderr.log`，因此重复任务会保留失败尝试和启动器诊断。即使存在最终回答，缺失工具结果的轨迹仍标为不完整。展示结果时说明实际模型、供应商设置、案例数量、数据校验和及观测分数；独立预期结果的通过率不能代替 Agent 成功率。
