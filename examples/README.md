# Sales demo workbook

[`insight-sales-demo.xlsx`](insight-sales-demo.xlsx) is a deterministic synthetic dataset for the InsightAgent v0.2 acceptance flow. It contains two regular first-row-header worksheets:

- `订单`: 48 orders from January through June 2026.
- `客户`: 8 customers with a unique `客户ID` and one of four regions.

Use `订单.客户ID = 客户.客户ID` for an `INNER JOIN` or `LEFT JOIN`. The right key is unique, so the join does not duplicate order amounts.

## Expected results

Region sales totals:

| 地区 | 销售额 |
|---|---:|
| 华东 | 230,428 |
| 华北 | 261,128 |
| 华南 | 304,528 |
| 西部 | 392,228 |

Monthly sales totals:

| 月份 | 销售额 |
|---|---:|
| 2026-01 | 203,747 |
| 2026-02 | 223,149 |
| 2026-03 | 182,860 |
| 2026-04 | 220,844 |
| 2026-05 | 169,155 |
| 2026-06 | 188,557 |

The workbook is generated sample data. It contains no real customer or transaction records.
