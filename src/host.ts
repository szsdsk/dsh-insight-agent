import type { Context } from '@deepseek-ai/cordis'
import type {
  ToolDefinition,
  ToolExecution,
  ToolExecutionResult,
} from '@deepseek-ai/dsh-tools'
import { EvidenceStore, parseQueryRecord } from './evidence-store.js'
import type { SubmissionInput } from './types.js'

export const name = 'insight-evidence'
export const inject = ['tools']

const EXECUTE_SQL_TOOL = 'mcp__insight__execute_sql'

export function apply(ctx: Context): void {
  const store = new EvidenceStore()

  ctx.on('agent/session-start', ({ agent }) => {
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
      if (exec.name !== EXECUTE_SQL_TOOL) return
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
      },
      required: ['answer', 'evidence'],
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [
        { type: 'text', text: JSON.stringify(value, null, 2) },
      ],
    },
    async execute(args, exec) {
      if (exec.agent === undefined) {
        throw new Error('submit_analysis requires an agent-scoped session')
      }
      const output = store.submit(
        String(exec.agent.id),
        exec.agent.options.model ?? 'unknown',
        parseSubmissionInput(args),
      )
      return JSON.parse(JSON.stringify(output))
    },
  }
  ctx.tools.register(submitAnalysis)

  ctx.effect(() => () => store.clearAll(), 'insight-evidence cleanup')
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
  }
}

function stringArray(value: unknown[], name: string): string[] {
  if (!value.every((item) => typeof item === 'string')) {
    throw new Error(`${name} must contain only strings`)
  }
  return value
}
