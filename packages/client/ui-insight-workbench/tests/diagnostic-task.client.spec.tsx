// @vitest-environment jsdom
import type { ComponentProps } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { DiagnosticTask } from '@deepseek-ai/dsh-api-insight-controller/types'
import { afterEach, expect, it, vi } from 'vitest'
import { Diagnostics } from '../src/client/Diagnostics.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const task: DiagnosticTask = { formatVersion: 1, id: '8d3a5c11-5224-43c3-a12b-abc7b5d7bccc', name: 'Monthly expense',
  baselineSelection: { header_row: 1 }, currentSelection: { header_row: 1 },
  columns: [{ name: 'amount', baseline: 'Amount', current: 'Cost', reason: 'Same confirmed unit' }],
  metrics: [{ name: 'expense', aggregation: 'sum', field: 'amount', definition: 'Sum selected physical rows' }],
  dimensions: [], filters: [], top_n: 10,
}

function mount(overrides: Partial<ComponentProps<typeof Diagnostics>> = {}) {
  const saveTask = vi.fn<ComponentProps<typeof Diagnostics>['saveTask']>().mockResolvedValue()
  const api: ComponentProps<typeof Diagnostics> = {
    agentRunning: false, t: key => en[key as keyof typeof en],
    listTasks: async () => [task], saveTask,
    upload: async file => file.name,
    preview: async () => ({ sheets: [], sheet: null, rows: [] }),
    registerSelected: async path => ({ source_id: path, kind: 'csv', path, fingerprint: path, warnings: [] }),
    relations: async () => ({ source_id: 'source', relations: ['data'], warnings: [] }),
    describe: async source_id => ({ source_id, relation: 'data', columns: [
      { name: source_id === 'before.csv' ? 'Amount' : 'Cost', type: 'DOUBLE', nullable: true },
    ], warnings: [] }),
    diagnose: async () => { throw new Error('not requested') },
    compare: async () => { throw new Error('not requested') },
    saveReport: async () => { throw new Error('not requested') },
    ...overrides,
  }
  render(<Diagnostics {...api} />)
  return saveTask
}

async function reloadTask(): Promise<void> {
  await screen.findByRole('option', { name: task.name })
  fireEvent.change(screen.getByLabelText(en['diagnostics.savedTask']), { target: { value: task.id } })
  expect(screen.queryByPlaceholderText(en['diagnostics.taskName'])).toBeNull()
  fireEvent.change(screen.getByLabelText(en['diagnostics.baseline']), { target: { files: [new File(['Amount\n10\n'], 'before.csv')] } })
  await screen.findByText('before.csv')
  fireEvent.change(screen.getByLabelText(en['diagnostics.current']), { target: { files: [new File(['Cost\n15\n'], 'after.csv')] } })
  await screen.findByText('after.csv')
  const register = screen.getByRole('button', { name: en['diagnostics.registerBoth'] })
  await waitFor(() => { expect(register).toHaveProperty('disabled', false) })
  fireEvent.click(register)
  await screen.findByPlaceholderText(en['diagnostics.taskName'])
  await waitFor(() => { expect(screen.getByRole('button', { name: en['diagnostics.run'] })).toHaveProperty('disabled', false) })
}

it('retains confirmed explanations when a saved task is renamed', async () => {
  const saveTask = mount()
  await reloadTask()
  fireEvent.change(screen.getByPlaceholderText('Task name'), { target: { value: 'Renamed expense' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save task' }))
  await waitFor(() => { expect(saveTask).toHaveBeenCalledOnce() })
  expect(saveTask.mock.calls[0]?.[0]).toMatchObject({ name: 'Renamed expense', columns: task.columns, metrics: task.metrics })
})

it('shows original quality locations and stops calculation when a value blocks a measure', async () => {
  const compare = vi.fn<ComponentProps<typeof Diagnostics>['compare']>()
  const saveReport = vi.fn<ComponentProps<typeof Diagnostics>['saveReport']>()
  mount({ compare, saveReport,
    upload: async file => file.name,
    registerSelected: async path => ({ source_id: path, kind: 'csv', path, fingerprint: path, warnings: [] }),
    describe: async source_id => ({ source_id, relation: 'data', columns: [
      { name: 'Amount', type: 'DOUBLE', nullable: true }, { name: 'Cost', type: 'VARCHAR', nullable: true },
    ], warnings: [] }),
    diagnose: async source_id => ({ query_id: `quality-${source_id}`, source_id, source_fingerprint: source_id,
      sql: 'SELECT quality', columns: ['row_count'], rows: [[2]], row_count: 1, truncated: false,
      elapsed_ms: 1, verified: true, warnings: [], row_total: 2, source_warnings: [],
      findings: source_id === 'after.csv' ? [{ kind: 'invalid_numeric', field: 'Cost', count: 1, rate: 0.5,
        classification: 'blocking', query_id: `quality-${source_id}`,
        samples: [{ table_row: 2, source_row: 5, values: { Cost: 'bad' } }] }] : [],
    }),
  })
  await reloadTask()
  fireEvent.click(screen.getByRole('button', { name: en['diagnostics.run'] }))
  await screen.findByRole('alert')
  expect(screen.getByRole('alert').textContent).toContain('Calculation blocked')
  expect(screen.getByText(/CSV record.*5/u).textContent).toContain('Cost: bad')
  expect(compare).not.toHaveBeenCalled()
  expect(saveReport).not.toHaveBeenCalled()
})

it('clears an old measure definition when its aggregation changes', async () => {
  const saveTask = mount()
  await reloadTask()
  const aggregation = screen.getByRole('option', { name: en['config.sum'] }).closest('select')
  if (aggregation === null) throw new Error('measure aggregation control is missing')
  fireEvent.change(aggregation, { target: { value: 'avg' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save task' }))
  await waitFor(() => { expect(saveTask).toHaveBeenCalledOnce() })
  const saved = saveTask.mock.calls[0]?.[0]
  expect(saved?.columns).toEqual(task.columns)
  expect(saved?.metrics[0]).toEqual({ name: 'expense', aggregation: 'avg', field: 'amount' })
})
