import { expect, it } from 'vitest'
import { parseTrace } from './trace.ts'

it('collects committed tool evidence, final output, and available usage', () => {
  const stream = [
    { type: 'session', sessionId: 's' },
    { type: 'tool_call', callId: 'c1', tool: 'submit_analysis', input: { answer: 'ok' } },
    { type: 'tool_result', callId: 'c1', status: 'completed', result: '{"cited_sql":["SELECT 1"],"steps":1}' },
    { type: 'status', phase: 'step_end', usage: { inputTokens: 12, outputTokens: 8 } },
    { type: 'final', text: '{"sql":"SELECT 1"}' },
  ].map(item => JSON.stringify(item)).join('\n')
  const trace = parseTrace(stream)
  expect(trace.complete).toBe(true)
  expect(trace.inputTokens).toBe(12)
  expect(trace.submitted?.cited_sql).toEqual(['SELECT 1'])
})

it('marks truncated or missing final events as incomplete', () => {
  expect(parseTrace('{"type":"tool_result","truncated":true}\n{"type":"final","text":"done"}').complete).toBe(false)
  expect(parseTrace('{"type":"status","phase":"step_end"}').complete).toBe(false)
})

it('rejects a final answer when a called tool has no result event', () => {
  const stream = [
    { type: 'tool_call', callId: 'lost', tool: 'execute_diagnostic_plan', input: { plan_id: 'p' } },
    { type: 'final', text: 'done' },
  ].map(item => JSON.stringify(item)).join('\n')
  expect(parseTrace(stream).complete).toBe(false)
})
