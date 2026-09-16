import type {
  AnalysisSubmission,
  QueryEvidenceRecord,
  SubmissionInput,
} from './types.js'

interface SessionState {
  startedAt: number
  steps: number
  sqlAttempts: number
  sqlFailures: number
  recovered: boolean
  queries: Map<string, QueryEvidenceRecord>
}

export class EvidenceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EvidenceError'
  }
}

export class EvidenceStore {
  readonly #sessions = new Map<string, SessionState>()
  readonly #now: () => number

  constructor(now: () => number = Date.now) {
    this.#now = now
  }

  start(sessionId: string): void {
    this.#sessions.set(sessionId, {
      startedAt: this.#now(),
      steps: 0,
      sqlAttempts: 0,
      sqlFailures: 0,
      recovered: false,
      queries: new Map(),
    })
  }

  observeStep(sessionId: string): void {
    this.#state(sessionId).steps += 1
  }

  observeSql(sessionId: string, succeeded: boolean): void {
    const state = this.#state(sessionId)
    state.sqlAttempts += 1
    if (succeeded) {
      if (state.sqlFailures > 0) state.recovered = true
    } else {
      state.sqlFailures += 1
    }
  }

  record(sessionId: string, query: QueryEvidenceRecord): void {
    this.#state(sessionId).queries.set(query.queryId, structuredClone(query))
  }

  submit(sessionId: string, model: string, input: SubmissionInput): AnalysisSubmission {
    const state = this.#state(sessionId)
    if (input.answer.trim() === '') {
      throw new EvidenceError('answer must not be blank')
    }
    if (input.evidence.length === 0) {
      throw new EvidenceError('at least one executed query must support the answer')
    }

    const seen = new Set<string>()
    const evidence = input.evidence.map((candidate) => {
      if (candidate.claim.trim() === '') {
        throw new EvidenceError(`claim for query_id ${candidate.query_id} must not be blank`)
      }
      if (seen.has(candidate.query_id)) {
        throw new EvidenceError(`duplicate query_id in evidence: ${candidate.query_id}`)
      }
      seen.add(candidate.query_id)
      const query = state.queries.get(candidate.query_id)
      if (query === undefined) {
        throw new EvidenceError(
          `query_id ${candidate.query_id} was not successfully executed in this session`,
        )
      }
      return {
        query_id: candidate.query_id,
        claim: candidate.claim,
        sql: query.sql,
        data_source: query.sourceId,
        result_summary: {
          columns: [...query.columns],
          row_count: query.rowCount,
          truncated: query.truncated,
          ...(query.resultDigest === undefined ? {} : { digest: query.resultDigest }),
        },
      }
    })

    return {
      answer: input.answer,
      evidence,
      assumptions: cleanStrings(input.assumptions),
      limitations: cleanStrings(input.limitations),
      cited_sql: evidence.map((item) => item.sql),
      data_sources: [...new Set(evidence.map((item) => item.data_source))],
      model,
      steps: state.steps,
      elapsed_ms: Math.max(0, this.#now() - state.startedAt),
      sql_attempts: state.sqlAttempts,
      invalid_sql_count: state.sqlFailures,
      recovered: state.recovered,
    }
  }

  clear(sessionId: string): void {
    this.#sessions.delete(sessionId)
  }

  clearAll(): void {
    this.#sessions.clear()
  }

  has(sessionId: string, queryId: string): boolean {
    return this.#sessions.get(sessionId)?.queries.has(queryId) ?? false
  }

  #state(sessionId: string): SessionState {
    let state = this.#sessions.get(sessionId)
    if (state === undefined) {
      this.start(sessionId)
      state = this.#sessions.get(sessionId)!
    }
    return state
  }
}

function cleanStrings(values: string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim()).filter(Boolean)
}

export function parseQueryRecord(value: unknown): QueryEvidenceRecord | undefined {
  if (!isObject(value)) return undefined
  // dsh-mcp-client preserves protocol-complete MCP output as
  // { content, structuredContent }. FastMCP places returned dictionaries in
  // structuredContent, while direct unit fixtures may pass the dictionary itself.
  const recordValue = isObject(value.structuredContent)
    ? value.structuredContent
    : parseTextContent(value.content) ?? value
  const queryId = stringField(recordValue, 'query_id')
  const sourceId = stringField(recordValue, 'source_id')
  const sql = stringField(recordValue, 'sql')
  const columns = recordValue.columns
  const rowCount = recordValue.row_count
  const truncated = recordValue.truncated
  const elapsedMs = recordValue.elapsed_ms
  if (
    queryId === undefined ||
    sourceId === undefined ||
    sql === undefined ||
    !Array.isArray(columns) ||
    !columns.every((item) => typeof item === 'string') ||
    typeof rowCount !== 'number' ||
    typeof truncated !== 'boolean' ||
    typeof elapsedMs !== 'number'
  ) {
    return undefined
  }
  const resultDigest = stringField(recordValue, 'result_digest')
  return {
    queryId,
    sourceId,
    sql,
    columns: [...columns],
    rowCount,
    truncated,
    elapsedMs,
    ...(resultDigest === undefined ? {} : { resultDigest }),
  }
}

function parseTextContent(value: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(value)) return undefined
  for (const item of value) {
    if (!isObject(item) || item.type !== 'text' || typeof item.text !== 'string') continue
    try {
      const parsed: unknown = JSON.parse(item.text)
      if (isObject(parsed)) return parsed
    } catch {
      // Ignore non-JSON text blocks; malformed values are rejected below.
    }
  }
  return undefined
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  return typeof value[key] === 'string' ? value[key] : undefined
}
