import type { Context } from '@deepseek-ai/cordis'
import type {
  ToolDefinition,
  ToolExecution,
  ToolExecutionResult,
} from '@deepseek-ai/dsh-tools'
import { EvidenceError, EvidenceStore, parseQueryRecord, parseVerificationRecord } from './evidence-store.ts'
import { registerDiagnosticPlan } from './diagnostic-plan.ts'
import type { AnalysisSubmission, SubmissionInput } from './types.ts'

export const name = 'insight-evidence'
export const inject = ['tools']

/** Diagnostic planning options for model-authored plans. */
export interface Config {
  /** Maximum plan revisions and execution retries after the initial attempt. */
  readonly maxDiagnosticCorrections?: number
  /** Disable structured planning for a controlled evaluation variant. */
  readonly enableDiagnosticPlan?: boolean
}

const EXECUTE_SQL_TOOL = 'mcp__insight__execute_sql'
const EXECUTE_ANALYSIS_TOOL = 'mcp__insight__execute_analysis'
const COMPARE_TABLES_TOOL = 'mcp__insight__compare_tables'
const DIAGNOSE_TABLE_TOOL = 'mcp__insight__diagnose_table'
const VERIFY_QUERY_TOOL = 'mcp__insight__verify_query'

export function apply(ctx: Context, config: Config = {}): void {
  const maxCorrections = config.maxDiagnosticCorrections ?? 2
  if (!Number.isSafeInteger(maxCorrections) || maxCorrections < 0 || maxCorrections > 5) {
    throw new Error('maxDiagnosticCorrections must be an integer from 0 to 5')
  }
  const store = new EvidenceStore()
  const clearPlans = config.enableDiagnosticPlan === false ? () => {} : registerDiagnosticPlan(ctx, maxCorrections)

  ctx.on('agent/created', ({ agent }) => {
    store.start(String(agent.id))
  })

  ctx.on('agent/disposed', ({ agent }) => {
    store.clear(String(agent.id))
  })

  ctx.on(
    'tools/result',
    (exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>) => {
      const sessionId = exec.agent === undefined ? undefined : String(exec.agent.id)
      if (sessionId === undefined) return
      store.observeStep(sessionId)
      if (exec.name === VERIFY_QUERY_TOOL && !result.isError) {
        const verification = parseVerificationRecord(result.value)
        if (verification !== undefined) {
          store.verify(sessionId, verification.queryId, verification.warnings)
        }
        return
      }
      if (![EXECUTE_SQL_TOOL, EXECUTE_ANALYSIS_TOOL, COMPARE_TABLES_TOOL, DIAGNOSE_TABLE_TOOL].includes(exec.name)) return
      store.observeSql(sessionId, !result.isError)
      if (result.isError) return
      const record = parseQueryRecord(result.value)
      if (record !== undefined) store.record(sessionId, record)
    },
  )

  const submitAnalysis: ToolDefinition = {
    name: 'submit_analysis',
    description:
      'Submit the final analysis with claims tied to query_id values successfully returned by execute_sql in this session.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        answer: { type: 'string', description: 'Concise final answer for the user.' },
        evidence: {
          type: 'array',
          description: 'Claims and the successful query_id that proves each claim.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              query_id: { type: 'string' },
              claim: { type: 'string' },
            },
            required: ['query_id', 'claim'],
          },
        },
        assumptions: { type: 'array', items: { type: 'string' } },
        limitations: { type: 'array', items: { type: 'string' } },
        facts: {
          type: 'array',
          description: 'Numerical values that exactly match cells in submitted, verified query evidence.',
          items: {
            type: 'object', additionalProperties: false,
            properties: {
              name: { type: 'string' }, query_id: { type: 'string' }, row: { type: 'integer' },
              column: { type: 'string' }, value: { anyOf: [{ type: 'string' }, { type: 'number' }] },
            },
            required: ['name', 'query_id', 'row', 'column', 'value'],
          },
        },
      },
      required: ['answer', 'evidence'],
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
          throw new Error('submit_analysis returned no structured result')
        }
        const submission = value as Partial<AnalysisSubmission>
        if (typeof submission.answer !== 'string' || !Array.isArray(submission.evidence) ||
          !Array.isArray(submission.facts) || !Array.isArray(submission.assumptions) ||
          !Array.isArray(submission.limitations)) {
          throw new Error('submit_analysis returned an incomplete structured result')
        }
        return [{ type: 'text', text: JSON.stringify({
          answer: submission.answer,
          evidence: submission.evidence.map(({ query_id, claim }) => ({ query_id, claim })),
          facts: submission.facts,
          assumptions: submission.assumptions,
          limitations: submission.limitations,
          accepted: true,
        }) }]
      },
    },
    async execute(args, exec) {
      if (exec.agent === undefined) {
        throw new Error('submit_analysis requires an agent-scoped session')
      }
      const input = parseSubmissionInput(args)
      const queryIds = [...new Set(input.evidence.map(item => item.query_id))]
      for (const [index, queryId] of queryIds.entries()) {
        if (!store.has(String(exec.agent.id), queryId)) {
          throw new EvidenceError(`query_id ${queryId} was not executed in this session`)
        }
        const checked = await ctx.tools.execute({
          name: VERIFY_QUERY_TOOL, arguments: { query_id: queryId }, agent: exec.agent,
          signal: exec.signal, parent: exec.token,
          callId: `${String(exec.callId)}:verify:${index}` as typeof exec.callId,
        })
        const verification = checked.isError ? undefined : parseVerificationRecord(checked.value)
        if (verification?.queryId !== queryId) {
          throw new EvidenceError(`query_id ${queryId} is no longer verified against the current source`)
        }
        store.verify(String(exec.agent.id), queryId, verification.warnings)
      }
      const output = store.submit(
        String(exec.agent.id),
        exec.agent.options.model ?? 'unknown',
        input,
      )
      return output
    },
  }
  ctx.effect(() => ctx.tools.register(submitAnalysis), 'insight-evidence submit_analysis')

  ctx.effect(() => () => { store.clearAll(); clearPlans() }, 'insight-evidence cleanup')
}

function parseSubmissionInput(value: unknown): SubmissionInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('submit_analysis arguments must be an object')
  }
  const record = value as Record<string, unknown>
  if (typeof record.answer !== 'string' || !Array.isArray(record.evidence)) {
    throw new Error('submit_analysis requires answer and evidence')
  }
  const evidence = record.evidence.map((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error('each evidence item must be an object')
    }
    const candidate = item as Record<string, unknown>
    if (typeof candidate.query_id !== 'string' || typeof candidate.claim !== 'string') {
      throw new Error('each evidence item requires query_id and claim strings')
    }
    return { query_id: candidate.query_id, claim: candidate.claim }
  })
  return {
    answer: record.answer,
    evidence,
    ...(Array.isArray(record.assumptions)
      ? { assumptions: stringArray(record.assumptions, 'assumptions') }
      : {}),
    ...(Array.isArray(record.limitations)
      ? { limitations: stringArray(record.limitations, 'limitations') }
      : {}),
    ...(Array.isArray(record.facts) ? { facts: record.facts.map((value) => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error('each numeric fact must be an object')
      }
      const fact = value as Record<string, unknown>
      if (typeof fact.name !== 'string' || typeof fact.query_id !== 'string' ||
        typeof fact.row !== 'number' || typeof fact.column !== 'string' ||
        (typeof fact.value !== 'string' && typeof fact.value !== 'number')) {
        throw new Error('numeric fact requires name, query_id, row, column, and value')
      }
      return { name: fact.name, query_id: fact.query_id, row: fact.row, column: fact.column, value: fact.value }
    }) } : {}),
  }
}

function stringArray(value: unknown[], name: string): string[] {
  if (!value.every(item => typeof item === 'string')) {
    throw new Error(`${name} must contain only strings`)
  }
  return value
}
