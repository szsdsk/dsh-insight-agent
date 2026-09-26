// @vitest-environment jsdom
import type { ComponentProps } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { AnalysisResult, InsightProject, SourceInfo } from '@deepseek-ai/dsh-api-insight-controller/types'
import { Workbench, type InsightInjected } from '../src/client/Workbench.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const source: SourceInfo = { source_id: 'old-source', path: 'sales.csv', kind: 'csv', fingerprint: 'old-fingerprint', warnings: [] }
const snapshot: AnalysisResult = {
  query_id: 'old-query', source_id: source.source_id, source_fingerprint: source.fingerprint,
  sql: 'SELECT region, SUM(amount) FROM data GROUP BY region', columns: ['region', 'revenue'],
  rows: [['East', 42]], row_count: 1, truncated: false, elapsed_ms: 1, verified: true, warnings: [],
}
const project: InsightProject = {
  formatVersion: 1, source, snapshot,
  analysis: {
    relation: 'data', dimensions: [{ field: { relation: 'data', column: 'region' } }],
    metrics: [{ aggregation: 'sum', field: { relation: 'data', column: 'amount' }, alias: 'revenue' }],
    filters: [{ field: { relation: 'data', column: 'region' }, operator: 'eq', value: 'East' }],
    sort: [{ column: 'revenue', direction: 'desc' }], limit: 25,
  },
}

function mount(overrides: Partial<InsightInjected> = {}) {
  const api = {
    load: vi.fn<InsightInjected['load']>().mockResolvedValue(project),
    upload: vi.fn<InsightInjected['upload']>().mockResolvedValue('.insight/imports/uploaded.xlsx'),
    register: vi.fn<InsightInjected['register']>().mockImplementation(async (path, kind) => ({ ...source, path, kind, source_id: 'fresh-source', fingerprint: 'fresh-fingerprint' })),
    relations: vi.fn<InsightInjected['relations']>().mockResolvedValue({ source_id: 'fresh-source', relations: ['data'], warnings: [] }),
    describe: vi.fn<InsightInjected['describe']>().mockResolvedValue({
      source_id: 'fresh-source', relation: 'data', warnings: [],
      columns: [{ name: 'region', type: 'VARCHAR', nullable: false }, { name: 'amount', type: 'DOUBLE', nullable: false }],
    }),
    execute: vi.fn<InsightInjected['execute']>().mockResolvedValue({ ...snapshot, query_id: 'fresh-query' }),
    save: vi.fn<InsightInjected['save']>().mockResolvedValue(),
    explain: vi.fn<InsightInjected['explain']>().mockResolvedValue(),
    ...overrides,
  }
  // The component only consumes these runtime props; other slot facilities are not used.
  const runtime = {
    sessionId: SessionId('insight-test'),
    useSessions: selector => selector({ byId: {}, ids: [], phase: 'ready', projectionsBySession: {} }),
    t: key => en[key as keyof typeof en],
  } as Pick<ComponentProps<typeof Workbench>, 'sessionId' | 'useSessions' | 't'>
  render(<Workbench {...runtime as ComponentProps<typeof Workbench>} {...api} />)
  return api
}

async function restore() {
  await screen.findByText('old-query')
  fireEvent.click(screen.getByRole('button', { name: 'Import data' }))
  await screen.findByRole('button', { name: /amount\s*DOUBLE/u })
}

it('opens a saved snapshot without touching the expired data source or running a query', async () => {
  const api = mount()
  await screen.findByText('old-query')
  expect(api.register).not.toHaveBeenCalled()
  expect(api.relations).not.toHaveBeenCalled()
  expect(api.execute).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Explain current result' }).hasAttribute('disabled')).toBe(true)
})

it('reimports the saved file and reruns with its filter, metrics, sort and limit intact', async () => {
  const api = mount()
  await restore()
  fireEvent.click(screen.getByRole('button', { name: 'Run analysis' }))
  await screen.findByText('fresh-query')
  expect(api.execute).toHaveBeenCalledWith('fresh-source', project.analysis, expect.any(AbortSignal))
  expect(api.register).toHaveBeenCalledTimes(2)
})

it('clears fields from the previous file when importing a different source', async () => {
  mount()
  await restore()
  fireEvent.change(screen.getByPlaceholderText<HTMLInputElement>('Data file path inside the workspace'), { target: { value: 'other.csv' } })
  fireEvent.click(screen.getByRole('button', { name: 'Import data' }))
  await waitFor(() => { expect(screen.queryByRole('button', { name: 'data.amount' })).toBeNull() })
  expect((await screen.findByRole('button', { name: 'Run analysis' })).hasAttribute('disabled')).toBe(true)
})

it('selects a local spreadsheet, uploads it, and registers its workspace copy', async () => {
  const api = mount()
  await screen.findByText('old-query')
  const file = new File(['workbook bytes'], 'selected.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  fireEvent.change(screen.getByLabelText('Choose file'), { target: { files: [file] } })
  expect((screen.getByRole<HTMLSelectElement>('combobox', { name: 'Format' })).value).toBe('xlsx')
  expect((screen.getByPlaceholderText<HTMLInputElement>('Data file path inside the workspace')).value).toBe('selected.xlsx')
  fireEvent.click(screen.getByRole('button', { name: 'Import data' }))
  await waitFor(() => { expect(api.register).toHaveBeenCalledWith('.insight/imports/uploaded.xlsx', 'xlsx', expect.any(AbortSignal)) })
  expect(api.upload).toHaveBeenCalledWith(file, 'xlsx', expect.any(AbortSignal))
})

it('ignores a query response that arrives after cancellation', async () => {
  let finish!: (value: AnalysisResult) => void
  const execute = vi.fn<InsightInjected['execute']>(() => new Promise((resolve) => { finish = resolve }))
  mount({ execute })
  await restore()
  fireEvent.click(screen.getByRole('button', { name: 'Run analysis' }))
  await waitFor(() => { expect(execute).toHaveBeenCalledOnce() })
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await act(async () => { finish({ ...snapshot, query_id: 'cancelled-query' }) })
  expect(screen.queryByText('cancelled-query')).toBeNull()
  expect(screen.getByText('old-query')).toBeDefined()
})

it('saves restored filters before schema discovery without losing the saved predicate', async () => {
  const api = mount()
  await screen.findByText('old-query')
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => { expect(api.save).toHaveBeenCalledOnce() })
  expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ analysis: project.analysis }))
})

it('preserves the selected worksheet and both join keys when reconnecting a workbook', async () => {
  const analysis = {
    ...project.analysis!, relation: 'orders',
    dimensions: [{ field: { relation: 'customers', column: 'region' } }],
    metrics: [{ aggregation: 'sum' as const, field: { relation: 'orders', column: 'amount' }, alias: 'revenue' }],
    filters: [{ field: { relation: 'customers', column: 'region' }, operator: 'eq' as const, value: 'East' }],
    join: { relation: 'customers', kind: 'left' as const, left: { relation: 'orders', column: 'customer_id' }, right: { relation: 'customers', column: 'id' } },
  }
  const api = mount({
    load: async () => ({ ...project, analysis }),
    relations: async () => ({ source_id: 'fresh-source', relations: ['customers', 'orders'], warnings: [] }),
    describe: async (_id, relation) => ({
      source_id: 'fresh-source', relation, warnings: [],
      columns: (relation === 'orders' ? ['customer_id', 'amount'] : ['id', 'region']).map(name => ({ name, type: 'VARCHAR', nullable: false })),
    }),
  })
  await screen.findByText('old-query')
  fireEvent.click(screen.getByRole('button', { name: 'Import data' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Run analysis' }))
  await screen.findByText('fresh-query')
  expect(api.execute).toHaveBeenCalledWith('fresh-source', analysis, expect.any(AbortSignal))
})

it('explains an invalid scatter plot and defaults the Y axis to a numeric result column', async () => {
  const chartResult: AnalysisResult = {
    ...snapshot, columns: ['order_id', 'order_date', 'revenue'], rows: [['A1', '2026-09-01', 42]],
  }
  mount({ load: async () => ({ ...project, snapshot: chartResult,
    chart: { type: 'scatter', title: 'orders', x: 'order_id', y: 'order_date' } }) })
  await screen.findByText('Scatter plots need two numeric result columns. Adjust both axes.')
  expect((screen.getByLabelText<HTMLSelectElement>('Y-axis column')).value).toBe('revenue')
  expect(screen.getByRole('button', { name: 'Export PNG' }).hasAttribute('disabled')).toBe(true)
})

it('keeps the prior snapshot and shows explanation errors', async () => {
  mount({ explain: async () => { throw new Error('Session is unavailable') } })
  await restore()
  fireEvent.click(screen.getByRole('button', { name: 'Run analysis' }))
  await screen.findByText('fresh-query')
  fireEvent.click(screen.getByRole('button', { name: 'Explain current result' }))
  await screen.findByText(/Session is unavailable/u)
  expect(screen.getByText('fresh-query')).toBeDefined()
})
