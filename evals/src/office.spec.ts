import { expect, it } from 'vitest'
import { assessOfficeCase } from './office.ts'
import { parseTrace } from './trace.ts'
import type { OfficeCase } from './types.ts'

const caseData: OfficeCase = {
  id: 'office-test', domain: 'expense', category: 'drilldown', question: 'Compare',
  baseline: 'old.csv', current: 'new.csv', mapping: [], metric: { name: 'expense', aggregation: 'sum', field: 'measure' },
  dimensions: ['primary'], expected: { baseline: '10', current: '15', groups: { A: { baseline: '10', current: '15' } } },
  expected_quality: { baseline: { missing_entity: 0, duplicate_rows: 0, duplicate_keys: 0 },
    current: { missing_entity: 0, duplicate_rows: 0, duplicate_keys: 0 } },
}

it('scores recorded totals and group changes against the independent oracle', () => {
  const output = { comparison: { totals: [{ baseline: 10, current: 15 }], groups: [{ dimensions: ['A'], metrics: [{ baseline: 10, current: 15 }] }], result_digest: 'digest' },
    baseline_quality: { findings: [] }, current_quality: { findings: [] } }
  const stream = [
    { type: 'tool_call', callId: 'c1', tool: 'execute_diagnostic_plan', input: { plan_id: 'p' } },
    { type: 'tool_result', callId: 'c1', status: 'completed', result: JSON.stringify(output) },
    { type: 'tool_call', callId: 'c2', tool: 'submit_analysis', input: { answer: 'done', evidence: [{ query_id: 'q' }] } },
    { type: 'tool_result', callId: 'c2', status: 'completed', result: '{"answer":"done"}' },
    { type: 'final', text: 'done' },
  ].map(item => JSON.stringify(item)).join('\n')
  expect(assessOfficeCase(caseData, parseTrace(stream))).toMatchObject({ success: true, metricCorrect: true, focusCorrect: true })
})

it('scores the requested row count when the plan also computes a leading sum', () => {
  const task: OfficeCase = { ...caseData, category: 'quality', dimensions: [],
    mapping: [{ name: 'measure', baseline: 'Amount', current: 'Cost' }],
    metric: { name: 'measure', aggregation: 'count', field: null },
    expected: { baseline: '7', current: '7', groups: {} },
    expected_quality: { baseline: { missing_entity: 1, duplicate_rows: 1, duplicate_keys: 1 },
      current: { missing_entity: 1, duplicate_rows: 1, duplicate_keys: 1 } } }
  const output = { plan_id: 'p', comparison: { totals: [{ name: 'spend', baseline: 50, current: 63 },
    { name: 'row_count', baseline: 7, current: 7 }], groups: [{ dimensions: ['A'], metrics: [] }] },
    baseline_quality: { findings: [{ kind: 'missing' }, { kind: 'duplicate_rows' }, { kind: 'duplicate_keys' }] },
    current_quality: { findings: [{ kind: 'missing' }, { kind: 'duplicate_rows' }, { kind: 'duplicate_keys' }] } }
  const stream = [
    { type: 'tool_call', callId: 'p1', tool: 'submit_diagnostic_plan', input: {
      columns: [{ name: 'amount', baseline: 'Amount', current: 'Cost' }],
      metrics: [{ name: 'spend', aggregation: 'sum', field: 'amount' }, { name: 'row_count', aggregation: 'count' }],
    } },
    { type: 'tool_result', callId: 'p1', status: 'completed', result: '{"plan_id":"p"}' },
    { type: 'tool_call', callId: 'c1', tool: 'execute_diagnostic_plan', input: { plan_id: 'p' } },
    { type: 'tool_result', callId: 'c1', status: 'completed', result: JSON.stringify(output) },
    { type: 'tool_call', callId: 'c2', tool: 'submit_analysis', input: { answer: 'seven', evidence: [{ query_id: 'q' }] } },
    { type: 'tool_result', callId: 'c2', status: 'completed', result: '{"answer":"seven"}' },
    { type: 'final', text: 'seven' },
  ].map(item => JSON.stringify(item)).join('\n')
  expect(assessOfficeCase(task, parseTrace(stream))).toMatchObject({ success: true, metricCorrect: true })
})

it('rejects a trace with a claimed result but no completed comparison', () => {
  expect(assessOfficeCase(caseData, parseTrace('{"type":"final","text":"15"}'))).toMatchObject({ success: false, metricCorrect: false })
})
