# InsightAgent v0.2 / DSH fork development

The visual workbench is maintained in the `szsdsk/deepseek-harness` fork on branch `codex/insight-workbench`. Its compatibility baseline is commit `ddefc45fbc7f8e46dd73185e68295696d1297887`, version `0.1.6-alpha.2`, Node.js `22.20.0`, and pnpm `11.7.0`. Do not update the upstream baseline during v0.2 development.

The two repositories keep separate histories:

- `dsh-insight-agent` owns the Python MCP, structured SQL, evidence enforcement, Skills, and evaluations.
- `deepseek-harness` owns the `insight` Remote controller, right-sidebar workbench, tool cards, and Web bundle composition.

Their stable boundary is Insight protocol v1 (`AnalysisSpec`, `AnalysisResult`, and the named `mcp__insight__*` tools). The browser never submits result rows as evidence. The Host calls the same registered MCP tools as the Agent and requires `verify_query` before a result is eligible for explanation.

## Reproduce the build

Build each repository with its own declared pnpm version. From `dsh-insight-agent`:

```powershell
corepack pnpm@10.14.0 install --frozen-lockfile
corepack pnpm@10.14.0 run typecheck
corepack pnpm@10.14.0 run test
corepack pnpm@10.14.0 run build
```

From the DSH fork:

```powershell
corepack pnpm@11.7.0 install --frozen-lockfile
corepack pnpm@11.7.0 run build
```

Use an isolated `DSH_HOME` when launching the fork. Configure the InsightAgent preset against the fork build and set `INSIGHT_AGENT_PYTHON` to the explicitly selected Python interpreter that contains the editable `python/` package.

## Minimal acceptance chain

1. Start the fork with a fresh `DSH_HOME` and create a new InsightAgent Session.
2. Open **Analysis**, register a workspace CSV, select a relation, dimension, and metric, then run.
3. Confirm the table is displayed and the evidence section contains a `query_id`, generated SQL, and verified status.
4. Restart the UI and confirm the saved snapshot is visible as historical without an automatic query.
5. Rerun, request an explanation, and confirm the Agent uses `get_query_result` and `submit_analysis` for the same `query_id`.

Project state is stored under workspace `.insight/` and is ignored by Git. Use a fresh Session for first acceptance; v0.2 does not migrate existing DSH Session data.
