import { expect, it } from 'vitest'
import { assessRetail, type RetailOracle } from './retail.ts'
import type { Trace } from './trace.ts'

const expected: RetailOracle = {
  periods: {
    baseline: { rows: 10, signed_revenue: '100', cancellation_rows: 2, missing_customer_rows: 4, csv_sha256: 'before' },
    current: { rows: 12, signed_revenue: '150', cancellation_rows: 3, missing_customer_rows: 6, csv_sha256: 'after' },
  },
  country_changes: { groups: [{ name: 'UK', baseline: '100', current: '150', delta: '50' }], other_delta: '0', group_count: 1 },
  product_changes: { groups: [{ name: 'SKU1', baseline: '100', current: '150', delta: '50' }], other_delta: '0', group_count: 1 },
}

function trace(): Trace {
  const calls: Trace['toolCalls'][number][] = []
  const results: Trace['toolResults'][number][] = []
  function add(tool: string, input: Record<string, unknown>, result: Record<string, unknown>) {
    const callId = `call-${calls.length}`
    calls.push({ callId, tool, input })
    results.push({ callId, tool, status: 'completed', result: { structuredContent: result } })
  }
  for (const [dimension, value] of [['Country', 'UK'], ['StockCode', 'SKU1']]) {
    add('mcp__insight__compare_tables', { spec: {
      baseline: { source_id: 'before' }, current: { source_id: 'after' }, dimensions: [dimension],
      columns: [{ name: 'revenue', baseline: 'LineRevenue', current: 'LineRevenue' }, { name: dimension, baseline: dimension, current: dimension }],
      metrics: [{ name: 'Revenue', field: 'revenue', aggregation: 'sum' }],
    } }, { query_id: `compare-${dimension}`, group_count: 1,
      totals: [{ baseline: 100, current: 150 }],
      groups: [{ dimensions: [value], metrics: [{ baseline: 100, current: 150, delta: 50 }] }],
    })
  }
  for (const [role, source] of [['baseline', 'before'], ['current', 'after']] as const) {
    add('mcp__insight__diagnose_table', { source_id: source }, { source_id: source, query_id: `quality-${source}`,
      row_total: expected.periods[role].rows,
      findings: [{ kind: 'missing', field: 'CustomerID', count: expected.periods[role].missing_customer_rows }],
    })
    add('mcp__insight__execute_sql', { source_id: source }, { source_id: source, query_id: `cancel-${source}`,
      sql: "SELECT COUNT(*) AS cancellation_rows FROM data WHERE InvoiceNo LIKE 'C%'",
      columns: ['cancellation_rows'], rows: [[expected.periods[role].cancellation_rows]],
    })
  }
  const ids = ['compare-Country', 'compare-StockCode', 'quality-before', 'quality-after', 'cancel-before', 'cancel-after']
  return { complete: true, toolCalls: calls, toolResults: results, submitted: { evidence: ids.map(query_id => ({ query_id, claim: 'Observed' })) },
    finalText: 'Accepted result', steps: 1, inputTokens: 1, outputTokens: 1 }
}

it('requires accepted query evidence for totals, both dimensions and quality counts', () => {
  const run = trace()
  expect(assessRetail(expected, run)).toMatchObject({ success: true, metricCorrect: true, focusCorrect: true })
  expect(assessRetail(expected, { ...run, complete: false }).success).toBe(false)
  expect(assessRetail(expected, { ...run, submitted: { evidence: [{ query_id: 'compare-Country' }] } }).success).toBe(false)
  const wrong = { ...expected, periods: { ...expected.periods, current: { ...expected.periods.current, cancellation_rows: 99 } } }
  expect(assessRetail(wrong, run)).toMatchObject({ success: false, metricCorrect: true, cancellationsCorrect: false })
})
