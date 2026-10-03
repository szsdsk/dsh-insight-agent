import { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolExecutionInput, ToolExecutionToken, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { afterEach, expect, it, vi } from 'vitest'
import { registerDiagnosticPlan } from '../src/diagnostic-plan.ts'

const roots: Context[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.useRealTimers()
})

const plan = {
  baseline: { source_id: 'before', relation: 'data' }, current: { source_id: 'after', relation: 'data' },
  columns: [{ name: 'amount', baseline: 'Amount', current: 'Cost', reason: 'Same confirmed currency' }],
  metrics: [{ name: 'expense', aggregation: 'sum', field: 'amount', definition: 'Physical row sum' }],
  dimensions: [],
}

function fixture() {
  const ctx = new Context()
  roots.push(ctx)
  const tools = new Map<string, ToolDefinition>()
  const started = Promise.withResolvers<AbortSignal>()
  ctx.provide('tools', {
    register(tool: ToolDefinition) { tools.set(tool.name, tool); return () => tools.delete(tool.name) },
    async execute(exec: ToolExecutionInput) {
      started.resolve(exec.signal)
      return new Promise((_, reject) => {
        exec.signal.throwIfAborted()
        exec.signal.addEventListener('abort', () => {
          const reason: unknown = exec.signal.reason
          reject(reason instanceof Error ? reason : new Error('nested tool cancelled', { cause: reason }))
        }, { once: true })
      })
    },
  } as never)
  const close = registerDiagnosticPlan(ctx, 2, 1_000)
  ctx.effect(() => close, 'test diagnostic cleanup')
  const call = (name: string, args: unknown, signal = new AbortController().signal) => {
    const tool = tools.get(name)
    if (tool === undefined) throw new Error(`missing registered tool: ${name}`)
    const exec = { name, signal, agent: { id: 'test-agent' } as ToolRunContext['agent'],
      token: Symbol('test execution') as ToolExecutionToken,
    } as ToolRunContext
    return tool.execute(args, exec)
  }
  return { call, started, close }
}

it('cancels nested work and releases the session for a new plan', async () => {
  const { call, started } = fixture()
  const accepted = await call('submit_diagnostic_plan', plan) as { plan_id: string }
  const cancellation = new AbortController()
  const running = call('execute_diagnostic_plan', { plan_id: accepted.plan_id }, cancellation.signal)
  const rejected = expect(running).rejects.toThrow('cancelled by user')
  const nested = await started.promise
  await expect(call('submit_diagnostic_plan', { ...plan, reason: 'revised' })).rejects.toThrow('already running')
  cancellation.abort(new Error('cancelled by user'))
  await rejected
  expect(nested.aborted).toBe(true)
  await expect(call('save_diagnostic_report', { plan_id: accepted.plan_id })).rejects.toThrow('latest successfully verified')
  await expect(call('submit_diagnostic_plan', { ...plan, reason: 'retry after cancellation' })).resolves.toHaveProperty('plan_id')
})

it('applies one deadline to nested work without accepting an unfinished run', async () => {
  vi.useFakeTimers()
  const { call, started } = fixture()
  const accepted = await call('submit_diagnostic_plan', plan) as { plan_id: string }
  const running = call('execute_diagnostic_plan', { plan_id: accepted.plan_id })
  const rejected = expect(running).rejects.toThrow('timed out')
  const nested = await started.promise
  await vi.advanceTimersByTimeAsync(1_000)
  await rejected
  expect(nested.aborted).toBe(true)
  await expect(call('save_diagnostic_report', { plan_id: accepted.plan_id })).rejects.toThrow('latest successfully verified')
})

it('settles nested work before cleanup completes and refuses late calls', async () => {
  const { call, started, close } = fixture()
  const accepted = await call('submit_diagnostic_plan', plan) as { plan_id: string }
  const running = call('execute_diagnostic_plan', { plan_id: accepted.plan_id })
  const rejected = expect(running).rejects.toThrow('disposed')
  await started.promise
  await close()
  await rejected
  await expect(call('list_diagnostic_tasks', {})).rejects.toThrow('disposed')
})
