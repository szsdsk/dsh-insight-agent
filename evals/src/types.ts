export type EvalVariant =
  | 'direct-sql'
  | 'standard-dsh'
  | 'insight-agent'
  | 'no-plan'
  | 'no-schema'
  | 'no-verification'
  | 'no-evidence'

export interface EvalCase {
  id: string
  category: string
  kind: 'sql' | 'recovery' | 'ambiguity' | 'safety'
  question: string
  source: { path: string; kind: 'csv' | 'sqlite' | 'duckdb' }
  gold_sql?: string
  probe_sql?: string
  evidence?: string
  expected_terms?: string[]
  schema_context?: string
  db_id?: string
}

/** One frozen two-period office task with independently calculated expectations. */
export interface OfficeCase {
  id: string
  domain: string
  category: string
  question: string
  baseline: string
  current: string
  mapping: readonly { name: string; baseline: string; current: string }[]
  metric: { name: string; aggregation: string; field: string | null }
  dimensions: readonly string[]
  expected: { baseline: string; current: string; groups: Record<string, { baseline: string; current: string }> }
  expected_quality: { baseline: Record<string, number>; current: Record<string, number> }
}

export interface EvalRecord {
  task_id: string
  category: string
  variant: EvalVariant
  success: boolean
  execution_correct: boolean | null
  dangerous_sql_blocked: boolean | null
  invalid_sql_count: number
  sql_attempts: number
  recovered: boolean
  steps: number
  latency_ms: number
  input_tokens: number | null
  output_tokens: number | null
  token_cost_usd: number | null
  result_fingerprint: string | null
  evidence_complete: boolean
  trace_path: string | null
  quality_precision?: number | null
  quality_recall?: number | null
  focus_correct?: boolean | null
  error: string | null
}

export interface EvalRun {
  run_id: string
  created_at: string
  suite: string
  model: string
  variant: EvalVariant
  records: EvalRecord[]
}

export interface EvalMetrics {
  count: number
  execution_accuracy: number | null
  task_success_rate: number
  dangerous_sql_block_rate: number | null
  invalid_sql_rate: number
  recovery_rate: number | null
  average_steps: number
  p50_latency_ms: number
  p95_latency_ms: number
  token_cost_usd: number | null
  result_consistency_rate: number | null
  token_cost_cv: number | null
  quality_precision: number | null
  quality_recall: number | null
  focus_accuracy: number | null
  evidence_complete_rate: number
  input_tokens: number | null
  output_tokens: number | null
}
