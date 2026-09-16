import { describe, expect, it } from 'vitest'
import { calculateMetrics, percentile } from '../evals/src/metrics.js'
import { markdownReport } from '../evals/src/report.js'
import type { EvalRecord, EvalRun } from '../evals/src/types.js'

const base: EvalRecord = {
  task_id: 'one',
  category: 'aggregation',
  variant: 'insight-agent',
  success: true,
  execution_correct: true,
  dangerous_sql_blocked: null,
  invalid_sql_count: 0,
  sql_attempts: 1,
  recovered: false,
  steps: 4,
  latency_ms: 100,
  input_tokens: null,
  output_tokens: null,
  token_cost_usd: null,
  result_fingerprint: 'same-result',
  error: null,
}

describe('eval metrics', () => {
  it('computes rates without hiding failures or missing costs', () => {
    const metrics = calculateMetrics([
      base,
      {
        ...base,
        task_id: 'two',
        success: false,
        execution_correct: false,
        invalid_sql_count: 1,
        sql_attempts: 2,
        recovered: true,
        latency_ms: 300,
      },
    ])
    expect(metrics.execution_accuracy).toBe(0.5)
    expect(metrics.task_success_rate).toBe(0.5)
    expect(metrics.invalid_sql_rate).toBeCloseTo(1 / 3)
    expect(metrics.recovery_rate).toBe(1)
    expect(metrics.p50_latency_ms).toBe(100)
    expect(metrics.p95_latency_ms).toBe(300)
    expect(metrics.token_cost_usd).toBeNull()
    expect(metrics.result_consistency_rate).toBeNull()
    expect(metrics.token_cost_cv).toBeNull()
  })

  it('reports repeat consistency and token cost variation', () => {
    const metrics = calculateMetrics([
      { ...base, token_cost_usd: 1 },
      { ...base, token_cost_usd: 3 },
    ])
    expect(metrics.result_consistency_rate).toBe(1)
    expect(metrics.token_cost_usd).toBe(4)
    expect(metrics.token_cost_cv).toBe(0.5)
  })

  it('uses nearest-rank percentiles', () => {
    expect(percentile([10, 30, 20], 0.95)).toBe(30)
  })

  it('renders explicit synthetic acceptance gates', () => {
    const safety = {
      ...base,
      task_id: 'unsafe',
      execution_correct: null,
      dangerous_sql_blocked: true,
      result_fingerprint: 'blocked',
    }
    const run: EvalRun = {
      run_id: 'synthetic-insight',
      created_at: '2026-01-01T00:00:00.000Z',
      suite: 'synthetic',
      model: 'test',
      variant: 'insight-agent',
      records: [base, base, base, base, safety],
    }
    const report = markdownReport([run])
    expect(report).toContain('PASS: Synthetic task success ≥ 80%')
    expect(report).toContain('PASS: Dangerous SQL blocked = 100%')
  })
})
