# InsightAgent evaluation

English | [中文](README.zh.md)

This directory owns reproducible evaluation fixtures and the event-based runner. Model-backed scores depend on the configured DSH provider; deterministic checks run without an API key.

## Office diagnostic suite

The frozen manifest contains 30 cases across expense, purchase, and inventory tables. Cases exercise quality findings, total measures, one- and two-field changes, ambiguity, and replacement-file analysis. CSV files vary field names and order. The independent Python oracle uses `Decimal` and does not call the Agent tools.

```powershell
$env:PYTHONPATH = (Resolve-Path 'python/insight-mcp/src').Path
$python = (Get-Command python).Source # Use the Python where insight-mcp is installed.
& $python evals/office/prepare.py --check
& $python evals/office/verify.py
pnpm insight:eval --python $python --suite office --limit 1 --variants insight-agent
```

The first model run is a cost and trace smoke test. Inspect its JSON and Markdown output in `evals/runs/` before increasing `--limit` or adding `standard-dsh,no-plan,no-schema`. The baseline uses the same DSH model and MCP data service. The planning and schema ablations retain the same read-only and evidence controls. The runner writes the raw `--json` event stream for each case; a missing or truncated stream is scored as incomplete evidence. A replacement-file case currently measures compatibility and recomputation with a new file, while saved-task restoration is covered by the workbench acceptance path.

The runner checks that the selected Python can import the MCP service before any model call. Install `python/insight-mcp` into that interpreter if the check fails.

The [offline expense report](examples/expense-diagnostic.html) is generated from the same CSV fixtures with real `diagnose_table`, `compare_tables`, and `verify_query` calls. To regenerate it after changing the data service or report renderer, set `INSIGHT_AGENT_PYTHON` to the installed Python interpreter and run `pnpm exec tsx evals/office/render_example.ts` from the repository root. The fixed fixture totals are 50 and 63.

### Local Web acceptance, 2026-09-29

In the InsightAgent two-period workbench, the baseline and current expense CSV fixtures were uploaded with header row 1 and data rows 2–8. `Amount` was linked to `Cost`; the `total` sum used that linked field, with `Department` and `Project` as dimensions and `Document` as the uniqueness key. The browser displayed a saved report with 7 rows per period, totals 50 and 63, change +13, seven combined dimension groups, and two single-dimension breakdowns. The downloaded HTML contained those totals, seven group rows, query evidence, embedded SVG and CSS, and no external script or stylesheet references. The browser run confirms this local path; it is not a score for the frozen office suite.

Office variants raise the headless JSON per-string cap to 24 KiB; the 32 KiB event cap still applies. Truncated events remain incomplete evidence.

If the DSH process sandbox cannot grant write access to this checkout, pass `--workspace PATH` pointing to a writable scratch directory. The runner copies only the frozen office CSV inputs there and runs the Agent in that directory. Keep the same scratch path for all compared variants.

The report includes task success, quality precision and recall, measure accuracy, focus selection, correction counts, steps, latency, and tokens when supplied by the provider. Missing cost is shown as `N/A`. The 80% office success target applies to the complete frozen set, not a smoke subset. Do not tune prompts against frozen-case failures without recording a new evaluation version.

## Public Online Retail case

[UCI Online Retail](https://archive.ics.uci.edu/dataset/352/online%2Bretail) supplies the public workbook for a separate two-period demonstration (Chen, 2015, DOI 10.24432/C5BW33; CC BY 4.0). Download the official ZIP, then use Python 3.11 or 3.12 with `insight-mcp` installed:

```powershell
$source = Join-Path $env:TEMP 'uci-online-retail.zip'
Invoke-WebRequest 'https://archive.ics.uci.edu/static/public/352/online%2Bretail.zip' -OutFile $source
$python = (Get-Command python).Source
& $python evals/retail/prepare.py --source $source
& $python evals/retail/oracle.py --source $source
& $python evals/retail/smoke.py
```

The fixed selection uses every line dated September or October 2011. `LineRevenue = Quantity × UnitPrice` keeps cancellations as signed rows; no deduplication or customer imputation occurs. The scripts check the source SHA-256, generated CSV hashes, row counts, and independent totals and group changes against [`expected.json`](retail/expected.json). The data-service smoke check also verifies both period diagnoses and bounded Country and StockCode comparisons, including the Other group. Generated CSVs stay under ignored `evals/runs/retail/`; [`case.json`](retail/case.json) holds the repeatable Agent request. This public demonstration is outside the frozen 30-case success denominator.

## BIRD auxiliary suite

Set `BIRD_DATA_ROOT` to a local BIRD mini-dev SQLite copy and generate the fixed 100-case manifest with `pnpm insight:bird-manifest`. Run `pnpm insight:eval --python $python --suite bird --limit 1` before a full batch. The bridge executes candidate and gold SQL against the same database and compares distinct result rows for EX. Record the dataset checksum from the resolved manifest with every report. BIRD is an auxiliary SQL measure; office task completion is the primary project result.

## Interpretation

`evals/runs/` holds run records, JSONL traces, and Markdown reports. Keep failed traces when changing development cases. Report actual model, provider settings, case count, data checksums, and observed scores when presenting a result; do not substitute deterministic oracle pass rates for Agent success.
