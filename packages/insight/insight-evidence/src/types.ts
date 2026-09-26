/** Metadata retained from one successful read-only query. */
export interface QueryEvidenceRecord {
  queryId: string
  sourceId: string
  sourceFingerprint?: string
  sql: string
  columns: string[]
  rowCount: number
  truncated: boolean
  elapsedMs: number
  resultDigest?: string
}

/** User-facing claim linked to a verified query identifier. */
export interface EvidenceClaim {
  query_id: string
  claim: string
}

/** Model submission proposed for evidence validation. */
export interface SubmissionInput {
  answer: string
  evidence: EvidenceClaim[]
  assumptions?: string[]
  limitations?: string[]
}

/** Accepted claim together with its source and query summary. */
export interface EvidenceItem extends EvidenceClaim {
  sql: string
  data_source: string
  result_summary: {
    columns: string[]
    row_count: number
    truncated: boolean
    digest?: string
    verified: boolean
    warnings: string[]
  }
}

/** Accepted final answer and metrics for the current Agent session. */
export interface AnalysisSubmission {
  answer: string
  evidence: EvidenceItem[]
  assumptions: string[]
  limitations: string[]
  cited_sql: string[]
  data_sources: string[]
  model: string
  steps: number
  elapsed_ms: number
  sql_attempts: number
  invalid_sql_count: number
  recovered: boolean
}
