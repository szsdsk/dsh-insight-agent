export interface QueryEvidenceRecord {
  queryId: string
  sourceId: string
  sql: string
  columns: string[]
  rowCount: number
  truncated: boolean
  elapsedMs: number
  resultDigest?: string
}

export interface EvidenceClaim {
  query_id: string
  claim: string
}

export interface SubmissionInput {
  answer: string
  evidence: EvidenceClaim[]
  assumptions?: string[]
  limitations?: string[]
}

export interface EvidenceItem extends EvidenceClaim {
  sql: string
  data_source: string
  result_summary: {
    columns: string[]
    row_count: number
    truncated: boolean
    digest?: string
  }
}

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
