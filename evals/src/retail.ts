/** Assess the pinned public Retail case from actual Agent tool results and accepted evidence. */
import { createHash } from 'node:crypto'
import type { Trace } from './trace.ts'

/** Two frozen public inputs and the requested revenue calculation. */
export interface RetailCase {
  readonly id: string
  readonly baseline: string
  readonly current: string
  readonly question: string
}
/** Independent workbook oracle for signed revenue, quality counts, and dimension changes. */
export interface RetailOracle {
  readonly periods: Record<'baseline' | 'current', {
    readonly rows: number; readonly signed_revenue: string; readonly cancellation_rows: number
    readonly missing_customer_rows: number; readonly csv_sha256: string
  }>
  readonly country_changes: RetailChanges
  readonly product_changes: RetailChanges
}
interface RetailChanges {
  readonly groups: readonly { readonly name: string; readonly baseline: string; readonly current: string; readonly delta: string }[]
  readonly other_delta: string
  readonly group_count: number
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function close(value: unknown, expected: string | number): boolean {
  return (typeof value === 'number' || typeof value === 'string') && Number.isFinite(Number(value)) &&
    Math.abs(Number(value) - Number(expected)) < 0.000001
}

/** Judge complete query-backed revenue, quality counts, and both independent dimension breakdowns.
 * @param expected - Frozen oracle calculated directly from the original workbook.
 * @param trace - Actual headless DSH JSON events, including nested MCP calls.
 * @returns Independent metric, focus, evidence and task outcomes with a failure explanation.
 */
export function assessRetail(expected: RetailOracle, trace: Trace) {
  const submittedIds = new Set(Array.isArray(trace.submitted?.evidence)
    ? trace.submitted.evidence.filter(record).map(item => item.query_id) : [])
  const observations = trace.toolResults.filter(item => item.status === 'completed' && item.result !== null)
    .map(item => {
      const result = item.result!
      const value = record(result.structuredContent) ? result.structuredContent : result
      const call = trace.toolCalls.find(call => call.callId === item.callId)
      return { tool: item.tool, value, input: call?.input ?? {} }
    })
  const comparisons = observations.filter(item => item.tool === 'mcp__insight__compare_tables')
  const revenueIndex = (input: Record<string, unknown>): number => {
    const spec = record(input.spec) ? input.spec : {}
    if (!Array.isArray(spec.metrics) || !Array.isArray(spec.columns)) return -1
    if (Array.isArray(spec.filters) && spec.filters.length > 0) return -1
    const columns = spec.columns.filter(record)
    return spec.metrics.findIndex(metric => record(metric) && metric.aggregation === 'sum' && columns.some(column =>
      column.name === metric.field && column.baseline === 'LineRevenue' && column.current === 'LineRevenue'))
  }
  const metricCorrect = comparisons.some(item => {
    const index = revenueIndex(item.input)
    const total = Array.isArray(item.value.totals) ? item.value.totals[index] : null
    return record(total) && submittedIds.has(item.value.query_id) &&
      close(total.baseline, expected.periods.baseline.signed_revenue) && close(total.current, expected.periods.current.signed_revenue)
  })
  const dimensionCorrect = (field: string, gold: RetailChanges): boolean => comparisons.some(item => {
    const spec = record(item.input.spec) ? item.input.spec : {}
    const columns = Array.isArray(spec.columns) ? spec.columns.filter(record) : []
    const dimensions = spec.dimensions
    if (!Array.isArray(dimensions) || dimensions.length !== 1 || !columns.some(column =>
      column.name === dimensions[0] && column.baseline === field && column.current === field)) return false
    const index = revenueIndex(item.input)
    const groups = Array.isArray(item.value.groups) ? item.value.groups.filter(record) : []
    const measure = (group: Record<string, unknown> | undefined) => Array.isArray(group?.metrics) ? group.metrics[index] : null
    return index >= 0 && submittedIds.has(item.value.query_id) && item.value.group_count === gold.group_count &&
      gold.groups.every(group => {
        const actual = measure(groups.find(row => Array.isArray(row.dimensions) && row.dimensions[0] === group.name && row.is_other !== true))
        return record(actual) && close(actual.baseline, group.baseline) && close(actual.current, group.current) && close(actual.delta, group.delta)
      }) && (() => {
        const other = measure(groups.find(group => group.is_other === true))
        return gold.group_count <= gold.groups.length || (record(other) && close(other.delta, gold.other_delta))
      })()
  })
  const focusCorrect = dimensionCorrect('Country', expected.country_changes) && dimensionCorrect('StockCode', expected.product_changes)
  const qualityCorrect = (['baseline', 'current'] as const).every(role => {
    const quality = observations.find(item => item.tool === 'mcp__insight__diagnose_table' &&
      comparisons.some(comparison => {
        const spec = record(comparison.input.spec) ? comparison.input.spec : {}
        return record(spec[role]) && spec[role].source_id === item.value.source_id
      }))
    const missing = Array.isArray(quality?.value.findings) ? quality.value.findings.filter(record)
      .find(item => item.kind === 'missing' && item.field === 'CustomerID') : null
    return quality !== undefined && submittedIds.has(quality.value.query_id) && quality.value.row_total === expected.periods[role].rows &&
      record(missing) && close(missing.count, expected.periods[role].missing_customer_rows)
  })
  const cancellationsCorrect = (['baseline', 'current'] as const).every(role => observations.some(item => {
    if (item.tool !== 'mcp__insight__execute_sql' || !submittedIds.has(item.value.query_id)) return false
    if (!comparisons.some(comparison => {
      const spec = record(comparison.input.spec) ? comparison.input.spec : {}
      return record(spec[role]) && spec[role].source_id === item.value.source_id
    })) return false
    if (!Array.isArray(item.value.columns) || !Array.isArray(item.value.rows)) return false
    const column = item.value.columns.indexOf('cancellation_rows')
    return column >= 0 && Array.isArray(item.value.rows[0]) && close(item.value.rows[0][column], expected.periods[role].cancellation_rows) &&
      /InvoiceNo/iu.test(String(item.value.sql))
  }))
  const success = trace.complete && trace.submitted !== null && metricCorrect && focusCorrect && qualityCorrect && cancellationsCorrect
  return { success, metricCorrect, focusCorrect, qualityCorrect, cancellationsCorrect,
    fingerprint: createHash('sha256').update(JSON.stringify(comparisons.map(item => item.value.result_digest ?? item.value.totals))).digest('hex'),
    error: success ? null : !trace.complete ? 'incomplete event trace' : trace.submitted === null ? 'no accepted evidence submission'
      : !metricCorrect ? 'signed revenue mismatch or missing citation' : !focusCorrect ? 'country/product breakdown mismatch or missing citation'
        : !qualityCorrect ? 'missing-customer counts mismatch or missing citation' : 'cancellation counts mismatch or missing citation' }
}
