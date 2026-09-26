import type {
  AnalysisSubmission,
  QueryEvidenceRecord,
  SubmissionInput,
} from './types.ts'

interface SessionState {
  startedAt: number
  steps: number
  sqlAttempts: number
  sqlFailures: number
  recovered: boolean
  queries: Map<string, QueryEvidenceRecord>
  verifiedQueries: Map<string, string[]>
}

/** Invalid or missing evidence for an analysis submission. */
export class EvidenceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EvidenceError'
  }
}

/** Keep executed and verified query metadata separate for each live Agent session. */
export class EvidenceStore {
  readonly #sessions = new Map<string, SessionState>()
  readonly #now: () => number

  constructor(now: () => number = Date.now) {
    this.#now = now
  }

  /** Start a fresh evidence window for an Agent session.
   * @param sessionId - Agent session identifier.
   */
  start(sessionId: string): void {
    this.#sessions.set(sessionId, {
      startedAt: this.#now(),
      steps: 0,
      sqlAttempts: 0,
      sqlFailures: 0,
      recovered: false,
      queries: new Map(),
      verifiedQueries: new Map(),
    })
  }

  /** Count one tool result in the session.
   * @param sessionId - Agent session identifier.
   */
  observeStep(sessionId: string): void {
    this.#state(sessionId).steps += 1
  }

  /** Record a SQL attempt and whether it succeeded.
   * @param sessionId - Agent session identifier.
   * @param succeeded - Whether the tool call completed successfully.
   */
  observeSql(sessionId: string, succeeded: boolean): void {
    const state = this.#state(sessionId)
    state.sqlAttempts += 1
    if (succeeded) {
      if (state.sqlFailures > 0) state.recovered = true
    } else {
      state.sqlFailures += 1
    }
  }

  /** Retain metadata for a successful query.
   * @param sessionId - Agent session identifier.
   * @param query - Query metadata returned by the data service.
   */
  record(sessionId: string, query: QueryEvidenceRecord): void {
    this.#state(sessionId).queries.set(query.queryId, structuredClone(query))
  }

  /** Mark an executed query as verified.
   * @param sessionId - Agent session identifier.
   * @param queryId - Identifier of a query executed in this session.
   * @param warnings - Verification warnings to retain.
   */
  verify(sessionId: string, queryId: string, warnings: readonly string[] = []): void {
    const state = this.#state(sessionId)
    if (!state.queries.has(queryId)) {
      throw new EvidenceError(`query_id ${queryId} was not executed in this session`)
    }
    state.verifiedQueries.set(queryId, [...warnings])
  }

  /** Accept claims only for queries executed and verified in this session.
   * @param sessionId - Agent session identifier.
   * @param model - Model label recorded with the submission.
   * @param input - Proposed answer, claims, assumptions, and limitations.
   * @returns Accepted analysis with query evidence and execution metrics.
   */
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
      const warnings = state.verifiedQueries.get(candidate.query_id)
      if (warnings === undefined) {
        throw new EvidenceError(
          `query_id ${candidate.query_id} was not verified successfully in this session`,
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
          verified: true,
          warnings: [...warnings],
        },
      }
    })

    return {
      answer: input.answer,
      evidence,
      assumptions: cleanStrings(input.assumptions),
      limitations: cleanStrings(input.limitations),
      cited_sql: evidence.map(item => item.sql),
      data_sources: [...new Set(evidence.map(item => item.data_source))],
      model,
      steps: state.steps,
      elapsed_ms: Math.max(0, this.#now() - state.startedAt),
      sql_attempts: state.sqlAttempts,
      invalid_sql_count: state.sqlFailures,
      recovered: state.recovered,
    }
  }

  /** Discard one Agent's evidence on disposal.
   * @param sessionId - Agent session identifier.
   */
  clear(sessionId: string): void {
    this.#sessions.delete(sessionId)
  }

  /** Discard all retained evidence when the plugin unloads. */
  clearAll(): void {
    this.#sessions.clear()
  }

  /** Check whether a query was executed in this session.
   * @param sessionId - Agent session identifier.
   * @param queryId - Query identifier to find.
   * @returns Whether the query is retained.
   */
  has(sessionId: string, queryId: string): boolean {
    return this.#sessions.get(sessionId)?.queries.has(queryId) ?? false
  }

  #state(sessionId: string): SessionState {
    let state = this.#sessions.get(sessionId)
    if (state === undefined) {
      this.start(sessionId)
      state = this.#sessions.get(sessionId)
      if (state === undefined) throw new Error(`Evidence state missing for ${sessionId}`)
    }
    return state
  }
}

function cleanStrings(values: string[] | undefined): string[] {
  return (values ?? []).map(value => value.trim()).filter(Boolean)
}

/** Extract query metadata from an MCP result or direct test value.
 * @param value - Tool result value to parse.
 * @returns Query metadata when all required fields are present.
 */
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
    !columns.every(item => typeof item === 'string') ||
    typeof rowCount !== 'number' ||
    typeof truncated !== 'boolean' ||
    typeof elapsedMs !== 'number'
  ) {
    return undefined
  }
  const resultDigest = stringField(recordValue, 'result_digest')
  const sourceFingerprint = stringField(recordValue, 'source_fingerprint')
  return {
    queryId,
    sourceId,
    sql,
    columns: [...columns],
    rowCount,
    truncated,
    elapsedMs,
    ...(sourceFingerprint === undefined ? {} : { sourceFingerprint }),
    ...(resultDigest === undefined ? {} : { resultDigest }),
  }
}

/** Extract a successful verification from an MCP result or direct test value.
 * @param value - Tool result value to parse.
 * @returns Query identifier and warnings when verification succeeded.
 */
export function parseVerificationRecord(
  value: unknown,
): { queryId: string; warnings: string[] } | undefined {
  if (!isObject(value)) return undefined
  const recordValue = isObject(value.structuredContent)
    ? value.structuredContent
    : parseTextContent(value.content) ?? value
  const queryId = stringField(recordValue, 'query_id')
  if (queryId === undefined || recordValue.valid !== true) return undefined
  const rawWarnings = recordValue.warnings
  if (!Array.isArray(rawWarnings) || !rawWarnings.every(item => typeof item === 'string')) {
    return undefined
  }
  return { queryId, warnings: [...rawWarnings] }
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
