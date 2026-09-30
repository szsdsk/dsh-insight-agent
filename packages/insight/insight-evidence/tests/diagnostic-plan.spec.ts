import { expect, it } from 'vitest'
import { parseDiagnosticPlan } from '../src/diagnostic-plan.ts'

const plan = {
  baseline: { source_id: 'old', relation: 'data' }, current: { source_id: 'new', relation: 'data' },
  columns: [{ name: 'amount', baseline: 'Amount', current: 'Cost', reason: 'Both columns measure spending in CNY' }],
  metrics: [{ name: 'expense', aggregation: 'sum', field: 'amount', definition: 'Sum spending for all rows' }],
  dimensions: [], key_columns: [], top_n: 10,
}

it('accepts an explicit mapped two-period calculation', () => {
  expect(parseDiagnosticPlan(plan).metrics[0]?.name).toBe('expense')
})

it('rejects an unmapped measure and unsupported drilldown breadth', () => {
  expect(() => parseDiagnosticPlan({ ...plan, metrics: [{ ...plan.metrics[0], field: 'missing' }] })).toThrow('mapped')
  expect(() => parseDiagnosticPlan({ ...plan, dimensions: ['amount', 'amount', 'amount'] })).toThrow('limit')
})

it('requires a recorded reason for a model-suggested field mapping', () => {
  expect(() => parseDiagnosticPlan({ ...plan, columns: [{ ...plan.columns[0], reason: '' }] })).toThrow('reason')
})

it('rejects a deduplicated definition that the calculation cannot execute', () => {
  expect(() => parseDiagnosticPlan({ ...plan, metrics: [{ ...plan.metrics[0], definition: 'Sum one row per Document' }] })).toThrow('unsupported')
})

it('keeps a shared cohort filter and rejects an unmapped or missing filter value', () => {
  expect(parseDiagnosticPlan({ ...plan, filters: [{ field: 'amount', operator: 'gt', value: 0 }] }).filters)
    .toEqual([{ field: 'amount', operator: 'gt', value: 0 }])
  expect(() => parseDiagnosticPlan({ ...plan, filters: [{ field: 'missing', operator: 'eq', value: 'a' }] })).toThrow('mapped')
  expect(() => parseDiagnosticPlan({ ...plan, filters: [{ field: 'amount', operator: 'gt' }] })).toThrow('filter value')
})
