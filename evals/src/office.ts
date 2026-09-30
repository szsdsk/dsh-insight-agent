import type { OfficeCase } from './types.ts'
import type { Trace } from './trace.ts'

interface OfficeAssessment {
  success: boolean
  metricCorrect: boolean
  qualityPrecision: number | null
  qualityRecall: number | null
  focusCorrect: boolean | null
  fingerprint: string | null
  error: string | null
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function payload(value: Record<string, unknown> | null): Record<string, unknown> | null {
  return value === null ? null : record(value.structuredContent) ? value.structuredContent : value
}
function numeric(value: unknown, expected: string): boolean {
  if (expected === 'null') return value === null
  const parsed = Number(value)
  return value !== null && Number.isFinite(parsed) && Math.abs(parsed - Number(expected)) < 0.000001
}
function groupName(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value.map(item => item === null ? '' : String(item)).join('|')
}
function expectedFindingKinds(caseData: OfficeCase, role: 'baseline' | 'current'): Set<string> {
  const quality = caseData.expected_quality[role]
  return new Set([
    ...((quality.missing_entity ?? 0) > 0 ? ['missing'] : []),
    ...((quality.duplicate_rows ?? 0) > 0 ? ['duplicate_rows'] : []),
    ...((quality.duplicate_keys ?? 0) > 0 ? ['duplicate_keys'] : []),
  ])
}
function observedFindingKinds(value: unknown): Set<string> {
  if (!record(value) || !Array.isArray(value.findings)) return new Set()
  return new Set(value.findings.filter(record).map(item => String(item.kind)))
}
function selectedMetricIndex(caseData: OfficeCase, trace: Trace, planId: unknown): number {
  const planResult = [...trace.toolResults].reverse().find(item => item.tool === 'submit_diagnostic_plan' &&
    item.status === 'completed' && payload(item.result)?.plan_id === planId)
  const planCall = trace.toolCalls.find(item => item.callId === planResult?.callId)
  const directResult = [...trace.toolResults].reverse().find(item => item.tool === 'mcp__insight__compare_tables' && item.status === 'completed')
  const directCall = trace.toolCalls.find(item => item.callId === directResult?.callId)
  const spec = planCall?.input ?? (record(directCall?.input.spec) ? directCall.input.spec : null)
  if (!record(spec) || !Array.isArray(spec.metrics)) return 0
  const expectedField = caseData.metric.field === null ? null : caseData.mapping.find(item => item.name === caseData.metric.field)
  return spec.metrics.findIndex((item) => {
    if (!record(item) || item.aggregation !== caseData.metric.aggregation) return false
    if (expectedField === null || expectedField === undefined) return true
    const column = Array.isArray(spec.columns) ? spec.columns.find(candidate => record(candidate) && candidate.name === item.field) : undefined
    return record(column) && column.baseline === expectedField.baseline && column.current === expectedField.current
  })
}

/** Compare an observed Agent trace with the frozen independent office oracle.
 * @param caseData - Frozen task and independently calculated result.
 * @param trace - Committed DSH JSON event projection.
 * @returns Deterministic task, quality, and focus judgements.
 */
export function assessOfficeCase(caseData: OfficeCase, trace: Trace): OfficeAssessment {
  if (caseData.category === 'ambiguity') {
    const answer = trace.finalText ?? ''
    const asked = trace.toolCalls.some(item => /ask_user/iu.test(item.tool)) || (/\?|？/u.test(answer) && /best|定义|口径|meaning/iu.test(answer))
    return { success: trace.complete && asked, metricCorrect: false, qualityPrecision: null, qualityRecall: null,
      focusCorrect: null, fingerprint: null, error: asked ? null : 'agent did not ask for the ambiguous definition' }
  }
  const completed = [...trace.toolResults].reverse().find(item => item.status === 'completed' && item.tool === 'execute_diagnostic_plan')
  const composed = payload(completed?.result ?? null)
  const comparison = record(composed?.comparison)
    ? composed.comparison
    : payload([...trace.toolResults].reverse().find(item => item.status === 'completed' && item.tool === 'mcp__insight__compare_tables')?.result ?? null)
  const baselineQuality = record(composed?.baseline_quality) ? composed.baseline_quality
    : payload(trace.toolResults.find(item => item.status === 'completed' && item.tool === 'mcp__insight__diagnose_table')?.result ?? null)
  const currentQuality = record(composed?.current_quality) ? composed.current_quality
    : payload([...trace.toolResults].reverse().find(item => item.status === 'completed' && item.tool === 'mcp__insight__diagnose_table')?.result ?? null)
  if (!record(comparison) || !Array.isArray(comparison.totals) || !record(comparison.totals[0])) {
    return { success: false, metricCorrect: false, qualityPrecision: null, qualityRecall: 0,
      focusCorrect: null, fingerprint: null, error: 'no completed query-backed comparison in trace' }
  }
  const index = selectedMetricIndex(caseData, trace, composed?.plan_id)
  const total = index < 0 ? null : comparison.totals[index]
  const metricCorrect = record(total) && numeric(total.baseline, caseData.expected.baseline) && numeric(total.current, caseData.expected.current)
  const groups = Array.isArray(comparison.groups) ? comparison.groups.filter(record) : []
  const actualGroups = new Map(groups.map(item => [groupName(item.dimensions), Array.isArray(item.metrics) ? item.metrics[index] : null]))
  const groupCorrect = caseData.dimensions.length === 0 || (Object.entries(caseData.expected.groups).every(([key, expected]) => {
    const actual = actualGroups.get(key)
    return record(actual) && numeric(actual.baseline, expected.baseline) && numeric(actual.current, expected.current)
  }) && actualGroups.size === Object.keys(caseData.expected.groups).length)
  const expectedGroups = Object.entries(caseData.expected.groups)
  expectedGroups.sort((left, right) => Math.abs(Number(right[1].current) - Number(right[1].baseline))
    - Math.abs(Number(left[1].current) - Number(left[1].baseline)))
  const focusCorrect = caseData.dimensions.length === 0 ? null : groupName(groups[0]?.dimensions) === expectedGroups[0]?.[0]
  let positives = 0
  let predicted = 0
  let truePositives = 0
  for (const [role, result] of [['baseline', baselineQuality], ['current', currentQuality]] as const) {
    const gold = expectedFindingKinds(caseData, role)
    const seen = observedFindingKinds(result)
    positives += gold.size; predicted += seen.size
    truePositives += [...seen].filter(item => gold.has(item)).length
  }
  const qualityPrecision = predicted === 0 ? (positives === 0 ? 1 : 0) : truePositives / predicted
  const qualityRecall = positives === 0 ? 1 : truePositives / positives
  const success = trace.complete && trace.submitted !== null && metricCorrect && groupCorrect &&
    (caseData.category !== 'quality' || qualityRecall === 1) &&
    (focusCorrect === null || focusCorrect)
  return { success, metricCorrect, qualityPrecision, qualityRecall, focusCorrect,
    fingerprint: typeof comparison.result_digest === 'string' ? comparison.result_digest : null,
    error: success ? null : !metricCorrect ? 'total metric mismatch' : !groupCorrect ? 'group change mismatch'
      : !trace.complete ? 'incomplete event trace' : trace.submitted === null ? 'no accepted evidence submission'
        : 'quality or focus requirement not met' }
}
