import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { afterEach, expect, it, vi } from 'vitest'
import { InsightController } from '../src/index.ts'
import type { AnalysisResult, AnalysisSpec, ComparisonResult, DiagnosticReport, DiagnosticTask, QualityResult, SourceInfo } from '../src/types.ts'

const roots: Context[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose())) })

const spec: AnalysisSpec = { relation: 'orders', dimensions: [], metrics: [{ aggregation: 'count', alias: 'orders' }], filters: [], sort: [], limit: 10 }
const result: AnalysisResult = {
  query_id: 'query-1', source_id: 'source-1', source_fingerprint: 'file-1', sql: 'SELECT COUNT(*) FROM orders',
  columns: ['orders'], rows: [[2]], row_count: 1, truncated: false, elapsed_ms: 1, verified: false, warnings: [],
}

function mcp(value: unknown) { return { isError: false, content: [], value: { content: [], structuredContent: value } } }

function fixture(execute: (request: { name: string; arguments: unknown }) => Promise<unknown>) {
  const ctx = new Context()
  roots.push(ctx)
  ctx.provide('tools', { execute } as never)
  const controller = new InsightController(ctx)
  const agent = { id: 'session-1', status: 'idle' } as Agent
  return { controller, agent }
}

it('copies a selected upload into the same Session workspace', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'insight-upload-'))
  try {
    const ctx = new Context()
    roots.push(ctx)
    const file = { attachmentId: 'file-1', name: 'sales.xlsx', bytes: 4 }
    ctx.provide('tools', { execute: async () => mcp({}) } as never)
    ctx.provide('fileUploads', { resolve: (_agent: Agent, receiptId: string) => receiptId === 'valid-receipt' ? file : undefined } as never)
    ctx.provide('attachments', { readFileStream: async function* () { yield Uint8Array.of(1, 2, 3, 4) } } as never)
    const controller = new InsightController(ctx)
    const agent = { id: 'session-1', session: { header: { cwd } } } as Agent
    await expect(controller.storeUpload(agent, 'missing', 'xlsx', new AbortController().signal)).rejects.toThrow('unavailable')
    const path = await controller.storeUpload(agent, 'valid-receipt', 'xlsx', new AbortController().signal)
    expect(path).toMatch(/^\.insight\/imports\/[a-f0-9-]+\.xlsx$/u)
    expect(await readFile(join(cwd, path))).toEqual(Buffer.from([1, 2, 3, 4]))
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

it('returns the structured source payload from Insight MCP', async () => {
  const source = { source_id: 'source-1', kind: 'xlsx', path: 'sales.xlsx', fingerprint: 'sha256:abc', warnings: [] }
  const { controller, agent } = fixture(async () => mcp(source))
  await expect(controller.register(agent, source.path, 'xlsx', new AbortController().signal)).resolves.toEqual(source)
})

it('reports missing structured MCP output instead of passing a malformed source to the UI', async () => {
  const { controller, agent } = fixture(async () => ({ isError: false, content: [], value: { content: [] } }))
  await expect(controller.register(agent, 'sales.xlsx', 'xlsx', new AbortController().signal))
    .rejects.toThrow('returned no structured content')
})

it('returns rows only after the same query ID is verified by Insight MCP', async () => {
  const execute = vi.fn(async ({ name }: { name: string; arguments: unknown }) =>
    mcp(name === 'mcp__insight__verify_query' ? { query_id: 'query-1', valid: true, warnings: ['checked'] } : result))
  const { controller, agent } = fixture(execute)
  await expect(controller.execute(agent, 'source-1', spec, new AbortController().signal)).resolves.toEqual({
    ...result, verified: true, warnings: ['checked'],
  })
  expect(execute.mock.calls.map(([call]) => [call.name, call.arguments])).toEqual([
    ['mcp__insight__execute_analysis', { source_id: 'source-1', spec }],
    ['mcp__insight__verify_query', { query_id: 'query-1' }],
  ])
})

it('rejects unverified rows and releases the session for another analysis', async () => {
  const execute = vi.fn(async ({ name }: { name: string }) =>
    mcp(name === 'mcp__insight__verify_query' ? { query_id: 'query-1', valid: false } : result))
  const { controller, agent } = fixture(execute)
  const run = () => controller.execute(agent, 'source-1', spec, new AbortController().signal)
  await expect(run()).rejects.toThrow('Insight query verification failed')
  await expect(run()).rejects.toThrow('Insight query verification failed')
  expect(execute).toHaveBeenCalledTimes(4)
})

it('refuses a concurrent analysis before it can call the MCP again', async () => {
  const pending = Promise.withResolvers<unknown>()
  const execute = vi.fn(async () => pending.promise)
  const { controller, agent } = fixture(execute)
  const first = controller.execute(agent, 'source-1', spec, new AbortController().signal)
  await expect(controller.execute(agent, 'source-1', spec, new AbortController().signal))
    .rejects.toThrow('already running')
  expect(execute).toHaveBeenCalledOnce()
  pending.resolve(mcp(result))
  await expect(first).rejects.toThrow()
})

it('checks a two-source comparison query before returning it', async () => {
  const comparison = { ...result, query_id: 'pair-query', totals: [{ name: 'cost', baseline: 2, current: 3, delta: 1, change_rate: 0.5 }], groups: [], metrics: [], mapping: [] }
  const execute = vi.fn(async ({ name }: { name: string }) => mcp(name === 'mcp__insight__verify_query'
    ? { query_id: 'pair-query', valid: true, warnings: [] } : comparison))
  const { controller, agent } = fixture(execute)
  const spec = { baseline: { source_id: 'a', relation: 'data' }, current: { source_id: 'b', relation: 'data' },
    columns: [{ name: 'amount', baseline: 'Amount', current: 'Cost', reason: 'Same currency' }],
    metrics: [{ name: 'expense', aggregation: 'sum' as const, field: 'amount', definition: 'Physical row sum' }],
    dimensions: [], filters: [], top_n: 10 }
  await expect(controller.compare(agent, spec, new AbortController().signal)).resolves.toMatchObject({ verified: true, query_id: 'pair-query' })
  expect(execute.mock.calls.map(([call]) => call.name)).toEqual(['mcp__insight__compare_tables', 'mcp__insight__verify_query'])
  expect(execute.mock.calls[0]?.[0]).toMatchObject({ arguments: { spec: {
    columns: [{ name: 'amount', baseline: 'Amount', current: 'Cost' }],
    metrics: [{ name: 'expense', aggregation: 'sum', field: 'amount' }],
  } } })
  expect(JSON.stringify(execute.mock.calls[0]?.[0])).not.toMatch(/Same currency|Physical row sum/u)
})

it('persists a reusable task outside session-specific workbench state', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'insight-task-'))
  try {
    const { controller } = fixture(async () => mcp({}))
    const agent = { id: 'session-1', session: { header: { cwd } } } as Agent
    const task: DiagnosticTask = { formatVersion: 1, id: '8d3a5c11-5224-43c3-a12b-abc7b5d7bccc', name: 'Monthly expense',
      baselineSelection: { header_row: 2 }, currentSelection: { header_row: 2 },
      columns: [{ name: 'amount', baseline: 'Amount', current: 'Cost', reason: 'Same confirmed unit' }],
      metrics: [{ name: 'cost', aggregation: 'sum', field: 'amount', definition: 'Spending across selected rows' }], dimensions: [],
      filters: [{ field: 'amount', operator: 'gt', value: 0 }], top_n: 7 }
    await controller.saveTask(agent, task)
    expect(await controller.listTasks(agent)).toEqual([task])
    expect(await readFile(join(cwd, '.insight', 'diagnostics', 'tasks', `${task.id}.json`), 'utf8')).toContain('Monthly expense')
    await expect(controller.saveTask(agent, { ...task, top_n: 51 })).rejects.toThrow('Invalid diagnostic task')
    await expect(controller.saveTask(agent, { ...task, filters: [{ field: 'unmapped', operator: 'eq', value: 'x' }] })).rejects.toThrow('Invalid diagnostic task')
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

it('saves only the exact diagnostic values issued and verified for this session', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'insight-report-'))
  try {
    const sources: SourceInfo[] = [
      { source_id: 'before', kind: 'csv', path: 'before.csv', fingerprint: 'hash-before', warnings: [] },
      { source_id: 'after', kind: 'csv', path: 'after.csv', fingerprint: 'hash-after', warnings: [] },
    ]
    const quality = (source: SourceInfo): QualityResult => ({ ...result, query_id: `quality-${source.source_id}`,
      source_id: source.source_id, source_fingerprint: source.fingerprint, row_total: 2,
      findings: [{ kind: 'missing', count: 1, rate: 0.5 }], source_warnings: [] })
    const comparison: ComparisonResult = { ...result, query_id: 'pair-query', source_id: 'pair',
      totals: [{ name: 'cost', baseline: 2, current: 3, delta: 1, change_rate: 0.5 }],
      groups: [], metrics: [{ name: 'cost', aggregation: 'sum', field: 'cost' }],
      mapping: [{ name: 'cost', baseline: 'cost', current: 'cost' }] }
    const execute = vi.fn(async ({ name, arguments: args }: { name: string; arguments: unknown }) => {
      if (name === 'mcp__insight__register_source') return mcp({
        ...sources.find(source => source.path === (args as { path: string }).path), internal_label: 'not in SourceInfo',
      })
      if (name === 'mcp__insight__diagnose_table') return mcp({
        ...quality(sources.find(source => source.source_id === (args as { source_id: string }).source_id)!),
        result_digest: 'internal digest', sources: [{ internal: true }],
      })
      if (name === 'mcp__insight__compare_tables') return mcp({
        ...comparison, result_digest: 'internal digest', group_count: 1, sources: [{ internal: true }],
      })
      if (name === 'mcp__insight__verify_query') return mcp({ query_id: (args as { query_id: string }).query_id, valid: true })
      throw new Error(`unexpected tool ${name}`)
    })
    const { controller } = fixture(execute)
    const agent = { id: 'session-1', session: { header: { cwd } } } as Agent
    const signal = new AbortController().signal
    const before = await controller.registerSelected(agent, 'before.csv', 'csv', { header_row: 1 }, signal)
    const after = await controller.registerSelected(agent, 'after.csv', 'csv', { header_row: 1 }, signal)
    const baselineQuality = await controller.diagnose(agent, before.source_id, 'data', [], ['cost'], signal)
    const currentQuality = await controller.diagnose(agent, after.source_id, 'data', [], ['cost'], signal)
    const compared = await controller.compare(agent, { baseline: { source_id: before.source_id, relation: 'data' },
      current: { source_id: after.source_id, relation: 'data' }, columns: comparison.mapping,
      metrics: comparison.metrics, dimensions: [], filters: [], top_n: 10 }, signal)
    expect(before).not.toHaveProperty('internal_label')
    expect(baselineQuality).not.toHaveProperty('result_digest')
    expect(compared).not.toHaveProperty('group_count')
    const report: DiagnosticReport = { formatVersion: 1, id: 'ad30d59c-383a-45c0-aa91-1e06f9218b5e',
      taskId: '40906dd7-dcfd-4419-8878-e634d16e6465', ranAt: '2026-09-29T00:00:00.000Z',
      baseline: before, current: after, baselineQuality, currentQuality, comparison: compared }
    await expect(controller.saveReport(agent, { ...report, comparison: { ...compared,
      totals: [{ ...compared.totals[0]!, current: 300 }] } }, signal)).rejects.toThrow('differs from verified')
    await expect(controller.saveReport({ ...agent, id: 'another-session' } as Agent, report, signal)).rejects.toThrow('differs from verified')
    await expect(controller.saveReport(agent, { ...report, baseline: after, current: before }, signal)).rejects.toThrow('differs from verified')
    await expect(controller.saveReport(agent, { ...report, narrative: {
      answer: 'Unaccepted interpretation', evidence: [{ query_id: compared.query_id, claim: 'Claim' }],
      facts: [], assumptions: [], limitations: [],
    } }, signal)).rejects.toThrow('requires submit_analysis accepted')
    await controller.saveReport(agent, JSON.parse(JSON.stringify(report)) as DiagnosticReport, signal)
    expect(JSON.parse(await readFile(join(cwd, '.insight', 'diagnostics', 'reports', `${report.id}.json`), 'utf8'))).toEqual(report)
    const savedBytes = await readFile(join(cwd, '.insight', 'diagnostics', 'reports', `${report.id}.json`))
    await expect(controller.saveReport(agent, { ...report, ranAt: '2026-10-02T00:00:00.000Z' }, signal)).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await readFile(join(cwd, '.insight', 'diagnostics', 'reports', `${report.id}.json`))).toEqual(savedBytes)
    const cancelled = new AbortController()
    cancelled.abort()
    const cancelledId = '83b936f6-d927-4edc-93cb-2dbcc02f7e33'
    await expect(controller.saveReport(agent, { ...report, id: cancelledId }, cancelled.signal)).rejects.toThrow()
    await expect(readFile(join(cwd, '.insight', 'diagnostics', 'reports', `${cancelledId}.json`))).rejects.toThrow()
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

it('discards a late MCP response after cancellation without verifying it', async () => {
  const pending = Promise.withResolvers<unknown>()
  const started = Promise.withResolvers<undefined>()
  const execute = vi.fn(async () => { started.resolve(undefined); return pending.promise })
  const { controller, agent } = fixture(execute)
  const cancellation = new AbortController()
  const running = controller.execute(agent, 'source-1', spec, cancellation.signal)
  const rejected = expect(running).rejects.toThrow('cancelled by user')
  await started.promise
  cancellation.abort(new Error('cancelled by user'))
  pending.resolve(mcp(result))
  await rejected
  expect(execute).toHaveBeenCalledOnce()
})
