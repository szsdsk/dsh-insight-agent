import type { EvalMetrics, EvalRecord } from './types.ts'

export function calculateMetrics(records: readonly EvalRecord[]): EvalMetrics {
  const execution = records.filter((record) => record.execution_correct !== null)
  const safety = records.filter((record) => record.dangerous_sql_blocked !== null)
  const recovery = records.filter((record) => record.invalid_sql_count > 0)
  const totalAttempts = records.reduce((sum, record) => sum + record.sql_attempts, 0)
  const costs = records
    .map((record) => record.token_cost_usd)
    .filter((value): value is number => value !== null)
  const repeatedTasks = [...groupByTask(records).values()].filter((group) => group.length > 1)
  const qualityPrecision = records.map(record => record.quality_precision).filter((value): value is number => value !== null && value !== undefined)
  const qualityRecall = records.map(record => record.quality_recall).filter((value): value is number => value !== null && value !== undefined)
  const focus = records.filter(record => record.focus_correct !== undefined && record.focus_correct !== null)
  const inputTokens = records.map(record => record.input_tokens)
  const outputTokens = records.map(record => record.output_tokens)
  return {
    count: records.length,
    execution_accuracy: ratio(
      execution.filter((record) => record.execution_correct).length,
      execution.length,
    ),
    task_success_rate: ratio(records.filter((record) => record.success).length, records.length) ?? 0,
    dangerous_sql_block_rate: ratio(
      safety.filter((record) => record.dangerous_sql_blocked).length,
      safety.length,
    ),
    invalid_sql_rate: ratio(
      records.reduce((sum, record) => sum + record.invalid_sql_count, 0),
      totalAttempts,
    ) ?? 0,
    recovery_rate: ratio(
      recovery.filter((record) => record.recovered).length,
      recovery.length,
    ),
    average_steps: average(records.map((record) => record.steps)),
    p50_latency_ms: percentile(records.map((record) => record.latency_ms), 0.5),
    p95_latency_ms: percentile(records.map((record) => record.latency_ms), 0.95),
    token_cost_usd: costs.length === records.length ? sum(costs) : null,
    result_consistency_rate: ratio(
      repeatedTasks.filter(hasConsistentResult).length,
      repeatedTasks.length,
    ),
    token_cost_cv: costs.length === records.length ? coefficientOfVariation(costs) : null,
    quality_precision: qualityPrecision.length ? average(qualityPrecision) : null,
    quality_recall: qualityRecall.length ? average(qualityRecall) : null,
    focus_accuracy: ratio(focus.filter(record => record.focus_correct).length, focus.length),
    evidence_complete_rate: ratio(records.filter(record => record.evidence_complete).length, records.length) ?? 0,
    input_tokens: inputTokens.every((value): value is number => value !== null) ? sum(inputTokens as number[]) : null,
    output_tokens: outputTokens.every((value): value is number => value !== null) ? sum(outputTokens as number[]) : null,
  }
}

function groupByTask(records: readonly EvalRecord[]): Map<string, EvalRecord[]> {
  const groups = new Map<string, EvalRecord[]>()
  for (const record of records) {
    const group = groups.get(record.task_id) ?? []
    group.push(record)
    groups.set(record.task_id, group)
  }
  return groups
}

function hasConsistentResult(records: readonly EvalRecord[]): boolean {
  const fingerprints = records.map((record) => record.result_fingerprint)
  return fingerprints.every((fingerprint) => fingerprint !== null && fingerprint === fingerprints[0])
}

function coefficientOfVariation(values: readonly number[]): number {
  if (values.length === 0) return 0
  const mean = average(values)
  if (mean === 0) return values.every((value) => value === 0) ? 0 : Number.POSITIVE_INFINITY
  const variance = average(values.map((value) => (value - mean) ** 2))
  return Math.sqrt(variance) / Math.abs(mean)
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator
}

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

export function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0
  const ordered = [...values].sort((left, right) => left - right)
  const index = Math.max(0, Math.ceil(fraction * ordered.length) - 1)
  return ordered[index] ?? 0
}
