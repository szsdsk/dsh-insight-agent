import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { afterEach, expect, it, vi } from 'vitest'
import { InsightController } from '../src/index.ts'
import type { AnalysisResult, AnalysisSpec } from '../src/types.ts'

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
