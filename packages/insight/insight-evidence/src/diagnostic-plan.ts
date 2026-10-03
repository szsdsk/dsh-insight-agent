/** Session-scoped diagnostic plans, verified drilldowns, and reusable workspace tasks. */
import { randomUUID } from 'node:crypto'
import { link, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import { diagnosticHtml, parseDiagnosticNarrative } from '@deepseek-ai/dsh-api-insight-controller/report'
import type { DiagnosticNarrative, DiagnosticReport, SourceInfo, QualityResult, ComparisonResult, TableSelection } from '@deepseek-ai/dsh-api-insight-controller/types'
import type { ToolDefinition, ToolExecutionResult, ToolExecutionToken, ToolRunContext } from '@deepseek-ai/dsh-tools'

interface Ref { source_id: string; relation: string }
interface Mapping { name: string; baseline: string; current: string; reason: string }
interface Metric { name: string; aggregation: 'sum' | 'count' | 'count_distinct' | 'avg'; field?: string; definition: string }
interface Filter { field: string; operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'is_null' | 'not_null'; value?: string | number | boolean }
interface Plan {
  baseline: Ref
  current: Ref
  columns: Mapping[]
  metrics: Metric[]
  dimensions: string[]
  filters: Filter[]
  key_columns: string[]
  top_n: number
}
interface PlannedRun { id: string; plan: Plan; revisions: number; attempts: number }
interface CompletedRun {
  planned: PlannedRun
  baseline: Record<string, unknown>
  current: Record<string, unknown>
  comparison: Record<string, unknown>
  breakdowns: Record<string, unknown>[]
  drillFilters: Filter[]
  drillAttempts: number
  analysis?: DiagnosticNarrative
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('diagnostic plan requires an object')
  return value as Record<string, unknown>
}
function string(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} must be a non-empty string`)
  return value
}
function strings(value: unknown, name: string, max: number): string[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${name} exceeds its limit`)
  return value.map(item => string(item, name))
}
function ref(value: unknown, role: string): Ref {
  if (value === undefined) throw new Error(`${role} requires the registered source_id and relation`)
  const row = object(value)
  return { source_id: string(row.source_id, 'source_id'), relation: string(row.relation, 'relation') }
}

/** Validate model-authored field links and calculation choices before execution.
 * @param value - Tool JSON supplied by the model.
 * @returns Bounded plan that can be sent to the data service.
 */
export function parseDiagnosticPlan(value: unknown): Plan {
  const row = object(value)
  if (!Array.isArray(row.columns) || row.columns.length < 1 || row.columns.length > 32) throw new Error('plan requires 1–32 field mappings')
  const columns = row.columns.map((item) => {
    const column = object(item)
    return { name: string(column.name, 'mapping name'), baseline: string(column.baseline, 'baseline field'), current: string(column.current, 'current field'), reason: string(column.reason, 'mapping reason') }
  })
  const names = columns.map(item => item.name)
  if (new Set(names).size !== names.length) throw new Error('mapping names must be unique')
  if (!Array.isArray(row.metrics) || row.metrics.length < 1 || row.metrics.length > 3) throw new Error('plan requires 1–3 metrics')
  const metrics = row.metrics.map((item) => {
    const metric = object(item)
    const aggregation = string(metric.aggregation, 'aggregation')
    if (!['sum', 'count', 'count_distinct', 'avg'].includes(aggregation)) throw new Error(`unsupported aggregation: ${aggregation}`)
    const field = metric.field === undefined || metric.field === null ? undefined : string(metric.field, 'metric field')
    if (aggregation !== 'count' && (field === undefined || !names.includes(field))) throw new Error(`metric field must be mapped; use columns[].name: ${names.join(', ')}`)
    if (field !== undefined && !names.includes(field)) throw new Error(`metric field must be mapped; use columns[].name: ${names.join(', ')}`)
    const definition = string(metric.definition, 'metric definition')
    if (aggregation !== 'count_distinct' && /one row per|deduplicated sum|collapse (?:exact )?duplicate|distinct (?:document|row)|去重后|按.{0,12}去重/iu.test(definition)) {
      throw new Error('deduplicated measures are unsupported; sum, count, and average use every selected row')
    }
    return { name: string(metric.name, 'metric name'), aggregation: aggregation as Metric['aggregation'], ...(field === undefined ? {} : { field }), definition }
  })
  if (new Set(metrics.map(item => item.name)).size !== metrics.length) throw new Error('metric names must be unique')
  const dimensions = strings(row.dimensions ?? [], 'dimensions', 2)
  const rawFilters: unknown = row.filters ?? []
  if (!Array.isArray(rawFilters) || rawFilters.length > 8) throw new Error('filters exceeds its limit')
  const filters = rawFilters.map((item: unknown) => {
    const filter = object(item)
    const field = string(filter.field, 'filter field')
    if (!names.includes(field)) throw new Error('filter field must be mapped')
    const operator = string(filter.operator, 'filter operator')
    if (!['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'is_null', 'not_null'].includes(operator)) throw new Error(`unsupported filter operator: ${operator}`)
    if (operator === 'is_null' || operator === 'not_null') return { field, operator: operator as Filter['operator'] }
    const value = filter.value
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      throw new Error('filter value must be a string, finite number, or boolean')
    }
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('filter value must be finite')
    return { field, operator: operator as Filter['operator'], value }
  })
  const keyColumns = strings(row.key_columns ?? [], 'key columns', 4)
  if ([...dimensions, ...keyColumns].some(name => !names.includes(name))) throw new Error('dimension or key must be mapped')
  if (new Set(dimensions).size !== dimensions.length || new Set(keyColumns).size !== keyColumns.length) throw new Error('dimensions and keys must be unique')
  const topN = row.top_n ?? 10
  if (!Number.isSafeInteger(topN) || Number(topN) < 1 || Number(topN) > 50) throw new Error('top_n must be an integer from 1 to 50')
  const baseline = ref(row.baseline, 'baseline')
  const current = ref(row.current, 'current')
  if (baseline.source_id === current.source_id && baseline.relation === current.relation) throw new Error('plan requires two distinct tables')
  return { baseline, current, columns, metrics, dimensions, filters, key_columns: keyColumns, top_n: Number(topN) }
}

function structured(result: ToolExecutionResult, name: string): Record<string, unknown> {
  if (result.isError) {
    const details = result.content.filter(item => item.type === 'text').map(item => item.text).join('\n')
    throw new Error(`${name} failed: ${details}`)
  }
  const value = object(result.value)
  return object(value.structuredContent)
}

function qualitySummary(result: Record<string, unknown>): Record<string, unknown> {
  const findings: unknown[] = Array.isArray(result.findings) ? result.findings : []
  const ranked = [...findings].sort((left, right) => Number(object(right).classification === 'blocking') - Number(object(left).classification === 'blocking'))
  const warnings = Array.isArray(result.source_warnings) ? result.source_warnings : []
  return { query_id: result.query_id, row_total: result.row_total,
    findings: ranked.slice(0, 10).map((item) => {
      const finding = object(item)
      return { kind: finding.kind, count: finding.count, rate: finding.rate,
        classification: finding.classification,
        ...(finding.field === undefined ? {} : { field: finding.field }),
        ...(finding.fields === undefined ? {} : { fields: finding.fields }),
        ...(finding.query_id === undefined ? {} : { query_id: finding.query_id }),
        ...(finding.samples === undefined ? {} : { samples: finding.samples }) }
    }), finding_count: findings.length, findings_truncated: findings.length > 10,
    source_warnings: warnings.slice(0, 3), warnings_truncated: warnings.length > 3 }
}

function comparisonSummary(result: Record<string, unknown>): Record<string, unknown> {
  const groups = Array.isArray(result.groups) ? result.groups.map((item: unknown) => item) : []
  const other = groups.find(item => object(item).is_other === true)
  const visible = other === undefined ? groups.slice(0, 10)
    : [...groups.filter(item => item !== other).slice(0, 9), other]
  return { query_id: result.query_id, totals: result.totals,
    ...(result.result_digest === undefined ? {} : { result_digest: result.result_digest }),
    groups: visible.map((item) => {
      const group = object(item)
      return { dimensions: group.dimensions, metrics: Array.isArray(group.metrics) ? group.metrics : [],
        ...(group.is_other === true ? { is_other: true,
          ...(group.combined_groups === undefined ? {} : { combined_groups: group.combined_groups }) } : {}) }
    }), group_count: result.group_count ?? groups.length,
    groups_truncated: (typeof result.group_count === 'number' ? result.group_count : groups.length) > visible.length }
}

/** Register bounded diagnostic execution and workspace task/report tools for one Insight preset.
 * @param ctx - Plugin context with the shared tool registry.
 * @param maxCorrections - Maximum corrections after the first submission or execution per user message.
 * @param timeoutMs - Deadline shared by an operation and its nested tools.
 * @returns Cleanup function for retained live-session plans, sources, and successful runs.
 */
export function registerDiagnosticPlan(ctx: Context, maxCorrections: number, timeoutMs: number): () => Promise<void> {
  const plans = new Map<string, PlannedRun>()
  const submissions = new Map<string, number>()
  const executions = new Map<string, number>()
  const completed = new Map<string, CompletedRun>()
  const sources = new Map<string, Map<string, Record<string, unknown>>>()
  const active = new Map<string, { controller: AbortController; token: ToolExecutionToken; done: Promise<unknown> }>()
  let disposed = false
  const register = (tool: ToolDefinition): void => {
    ctx.effect(() => ctx.tools.register({ ...tool, async execute(args, exec) {
      if (disposed) throw new Error('diagnostic tools have been disposed')
      if (exec.agent === undefined) throw new Error('diagnostic operations require an agent session')
      const session = String(exec.agent.id)
      const running = active.get(session)
      if (running !== undefined) {
        if (exec.parent !== running.token) throw new Error('a diagnostic operation is already running in this session')
        return tool.execute(args, exec)
      }
      const controller = new AbortController()
      const signal = AbortSignal.any([exec.signal, controller.signal])
      const timer = setTimeout(() => { controller.abort(new Error('diagnostic operation timed out; no new result was accepted')) }, timeoutMs)
      const done = Promise.resolve().then(async () => {
        try {
          signal.throwIfAborted()
          return await tool.execute(args, { ...exec, signal })
        } catch (error) {
          if (signal.aborted) throw signal.reason
          throw error
        } finally {
          clearTimeout(timer)
          active.delete(session)
        }
      })
      active.set(session, { controller, token: exec.token, done })
      return done
    } }), `insight ${tool.name}`)
  }
  ctx.on('agent/inbox/claimed', ({ agent }) => {
    const session = String(agent.id)
    submissions.delete(session); executions.delete(session)
    const retained = completed.get(session)
    if (retained !== undefined) retained.drillAttempts = 0
  })
  ctx.on('agent/disposed', ({ agent }) => {
    const session = String(agent.id)
    active.get(session)?.controller.abort(new Error('diagnostic session was disposed'))
    plans.delete(session); submissions.delete(session); executions.delete(session); completed.delete(session); sources.delete(session)
  })
  ctx.on('tools/result', (exec, result) => {
    if (exec.agent !== undefined && exec.name === 'submit_analysis' && !result.isError && !exec.signal.aborted) {
      const retained = completed.get(String(exec.agent.id))
      if (retained === undefined) return
      delete retained.analysis
      const submission = parseDiagnosticNarrative(result.value)
      const ids = new Set([retained.baseline, retained.current, retained.comparison, ...retained.breakdowns]
        .map(query => query.query_id))
      if (submission.evidence.some(item => item.query_id === retained.comparison.query_id) &&
        submission.evidence.every(item => ids.has(item.query_id))) retained.analysis = structuredClone(submission)
      return
    }
    if (exec.agent === undefined || exec.name !== 'mcp__insight__register_source' || result.isError) return
    const source = structured(result, exec.name)
    const session = String(exec.agent.id)
    let entries = sources.get(session)
    if (entries === undefined) { entries = new Map(); sources.set(session, entries) }
    entries.set(string(source.source_id, 'source_id'), source)
    if (entries.size > 64) {
      const oldest = entries.keys().next().value
      if (oldest !== undefined) entries.delete(oldest)
    }
  })
  const submit: ToolDefinition = {
    name: 'submit_diagnostic_plan',
    description: 'Submit or revise a two-period diagnostic plan. Use columns[].name for metric fields, dimensions, keys and filters. Each metric computes both periods, delta and rate; do not create separate metrics for those outputs. Explain mappings and definitions.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      baseline: { type: 'object', properties: { source_id: { type: 'string' }, relation: { type: 'string' } }, required: ['source_id', 'relation'] },
      current: { type: 'object', properties: { source_id: { type: 'string' }, relation: { type: 'string' } }, required: ['source_id', 'relation'] },
      columns: { type: 'array', minItems: 1, maxItems: 32, items: { type: 'object', additionalProperties: false, properties: { name: { type: 'string', description: 'Shared name used by all metric fields, dimensions, keys and filters.' }, baseline: { type: 'string' }, current: { type: 'string' }, reason: { type: 'string' } }, required: ['name', 'baseline', 'current', 'reason'] } },
      metrics: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'object', additionalProperties: false, properties: { name: { type: 'string' }, aggregation: { type: 'string', enum: ['sum', 'count', 'count_distinct', 'avg'] }, field: { type: 'string', description: 'A columns[].name value, not an original file column. COUNT may omit it.' }, definition: { type: 'string' } }, required: ['name', 'aggregation', 'definition'] } },
      dimensions: { type: 'array', maxItems: 2, items: { type: 'string' } }, key_columns: { type: 'array', maxItems: 4, items: { type: 'string' } }, top_n: { type: 'integer', minimum: 1, maximum: 50 }, reason: { type: 'string' },
      filters: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, operator: { type: 'string', enum: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'is_null', 'not_null'] }, value: { type: ['string', 'number', 'boolean'] } }, required: ['field', 'operator'] } },
    }, required: ['baseline', 'current', 'columns', 'metrics', 'dimensions'] },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute(args, exec) {
      if (exec.agent === undefined) throw new Error('diagnostic plan requires an agent session')
      const session = String(exec.agent.id)
      const attempts = submissions.get(session) ?? 0
      if (attempts > maxCorrections) throw new Error('diagnostic plan correction budget exhausted; ask the user to resolve the input before another attempt')
      submissions.set(session, attempts + 1)
      const input = object(args)
      const plan = parseDiagnosticPlan(input)
      const previous = plans.get(session)
      if (previous !== undefined && attempts > 0) string(input.reason, 'revision reason')
      const current = { id: randomUUID(), plan, revisions: attempts, attempts: 0 }
      plans.set(session, current)
      completed.delete(session)
      return Promise.resolve({
        plan_id: current.id,
        revision: current.revisions,
        plan,
        stages: ['baseline_quality', 'current_quality', 'comparison', 'verification'],
        previous_plan_id: previous?.id ?? null,
      })
    },
  }
  const run: ToolDefinition = {
    name: 'execute_diagnostic_plan',
    description: 'Execute the submitted two-period diagnostic plan with deterministic MCP tools and verify all query IDs.',
    parameters: { type: 'object', additionalProperties: false, properties: { plan_id: { type: 'string' } }, required: ['plan_id'] },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('diagnostic execution requires an agent session')
      const agent = exec.agent
      const planned = plans.get(String(agent.id))
      const input = object(args)
      if (planned === undefined || input.plan_id !== planned.id) throw new Error('plan_id is absent or stale in this session')
      const attempts = executions.get(String(agent.id)) ?? 0
      if (attempts > maxCorrections) throw new Error('diagnostic execution correction budget exhausted')
      executions.set(String(agent.id), attempts + 1)
      completed.delete(String(agent.id))
      planned.attempts += 1
      const plan = planned.plan
      const call = async (name: string, parameters: unknown, stage: string): Promise<Record<string, unknown>> => {
        const result = await ctx.tools.execute({ name, arguments: parameters, agent, signal: exec.signal,
          parent: exec.token, callId: `${String(exec.callId)}:${stage}` as typeof exec.callId })
        exec.signal.throwIfAborted()
        return structured(result, name)
      }
      const quality = async (role: 'baseline' | 'current') => {
        const source = plan[role]
        const keys = plan.key_columns.map(name => plan.columns.find(item => item.name === name)?.[role])
        const metricColumns = plan.metrics.filter(item => item.field !== undefined && ['sum', 'avg'].includes(item.aggregation))
          .map(item => plan.columns.find(column => column.name === item.field)?.[role])
        return call('mcp__insight__diagnose_table', { source_id: source.source_id, relation: source.relation,
          key_columns: keys, metric_columns: [...new Set(metricColumns)] }, `${role}:quality`)
      }
      const baseline = await quality('baseline')
      const current = await quality('current')
      for (const [index, result] of [baseline, current].entries()) {
        const queryId = string(result.query_id, 'query_id')
        const check = await call('mcp__insight__verify_query', { query_id: queryId }, `quality:verify:${index}`)
        if (check.valid !== true || check.query_id !== queryId) throw new Error(`query ${queryId} failed source verification`)
      }
      const blocked = [baseline, current].some(result => Array.isArray(result.findings)
        && result.findings.some((item: unknown) => object(item).classification === 'blocking'))
      if (blocked) {
        exec.signal.throwIfAborted()
        return { plan_id: planned.id, status: 'blocked', baseline_quality: qualitySummary(baseline),
          current_quality: qualitySummary(current),
          correction: 'Ask the user to correct the highlighted source values or confirm revised fields and calculations, then submit a revised plan. No comparison or report was created.' }
      }
      const comparison = await call('mcp__insight__compare_tables', { spec: {
        baseline: plan.baseline, current: plan.current,
        columns: plan.columns.map(({ name, baseline, current }) => ({ name, baseline, current })),
        metrics: plan.metrics.map(({ name, aggregation, field }) => ({ name, aggregation, ...(field === undefined ? {} : { field }) })),
        dimensions: plan.dimensions, filters: plan.filters, top_n: plan.top_n,
      } }, 'comparison')
      const dimensionBreakdowns = []
      if (plan.dimensions.length > 1) {
        for (const dimension of plan.dimensions) {
          dimensionBreakdowns.push(await call('mcp__insight__compare_tables', { spec: {
            baseline: plan.baseline, current: plan.current,
            columns: plan.columns.map(({ name, baseline, current }) => ({ name, baseline, current })),
            metrics: plan.metrics.map(({ name, aggregation, field }) => ({ name, aggregation, ...(field === undefined ? {} : { field }) })),
            dimensions: [dimension], filters: plan.filters, top_n: plan.top_n,
          } }, `dimension:${dimension}`))
        }
      }
      for (const [index, result] of [comparison, ...dimensionBreakdowns].entries()) {
        const queryId = string(result.query_id, 'query_id')
        const check = await call('mcp__insight__verify_query', { query_id: queryId }, `verify:${index}`)
        if (check.valid !== true || check.query_id !== queryId) throw new Error(`query ${queryId} failed source verification`)
      }
      exec.signal.throwIfAborted()
      completed.set(String(agent.id), {
        planned, baseline, current, comparison, breakdowns: dimensionBreakdowns, drillFilters: [], drillAttempts: 0,
      })
      return { plan_id: planned.id, baseline_quality: qualitySummary(baseline), current_quality: qualitySummary(current),
        comparison: comparisonSummary(comparison), dimension_breakdowns: dimensionBreakdowns.map(comparisonSummary) }
    },
  }
  const drill: ToolDefinition = {
    name: 'drill_diagnostic_plan',
    description: 'Inspect one observed group in the latest verified diagnostic run, applying its value as the same filter to both periods. Choose a mapped dimension and a group_value from that dimension breakdown. Supports two levels; Other is an aggregate and cannot be selected. Save a new report after drilling.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      plan_id: { type: 'string' }, dimension: { type: 'string' },
      group_value: { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'null' }] },
    }, required: ['plan_id', 'dimension', 'group_value'] },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('diagnostic drilldown requires an agent session')
      const input = object(args)
      const retained = completed.get(String(exec.agent.id))
      if (retained === undefined || retained.planned.id !== input.plan_id || plans.get(String(exec.agent.id))?.id !== input.plan_id) {
        throw new Error('plan_id must identify the latest successfully verified diagnostic run')
      }
      if (retained.drillFilters.length >= 2) throw new Error('diagnostic drilldown is limited to two levels')
      if (retained.drillAttempts > maxCorrections) throw new Error('diagnostic drilldown correction budget exhausted')
      retained.drillAttempts += 1
      const plan = retained.planned.plan
      const dimension = string(input.dimension, 'drill dimension')
      if (!plan.dimensions.includes(dimension) || retained.drillFilters.some(item => item.field === dimension)) {
        throw new Error('select a remaining mapped diagnostic dimension')
      }
      const previous = retained.drillFilters.length === 0
        ? plan.dimensions.length === 1 ? retained.comparison
          : retained.breakdowns.find(item => Array.isArray(item.columns) && item.columns[1] === dimension)
        : retained.breakdowns.at(-1)
      const groups = previous === undefined || !Array.isArray(previous.groups) ? [] : previous.groups.map(object)
      const group = groups.find(item => item.is_other !== true && Array.isArray(item.dimensions)
        && item.dimensions.length === 1 && isDeepStrictEqual(item.dimensions[0], input.group_value))
      if (group === undefined) throw new Error('group_value must occur in the verified dimension breakdown; Other cannot be drilled')
      const value = input.group_value
      if (value !== null && typeof value !== 'string' && typeof value !== 'boolean' && (typeof value !== 'number' || !Number.isFinite(value))) {
        throw new Error('drill group must be a scalar value or null')
      }
      const filter: Filter = value === null ? { field: dimension, operator: 'is_null' } : { field: dimension, operator: 'eq', value }
      const focused = [...retained.drillFilters, filter]
      const filters = [...plan.filters, ...focused]
      if (filters.length > 8) throw new Error('drilldown requires space within the eight-filter limit')
      const dimensions = plan.dimensions.filter(name => !focused.some(item => item.field === name))
      const result = await ctx.tools.execute({ name: 'mcp__insight__compare_tables', arguments: { spec: {
        baseline: plan.baseline, current: plan.current,
        columns: plan.columns.map(({ name, baseline, current }) => ({ name, baseline, current })),
        metrics: plan.metrics.map(({ name, aggregation, field }) => ({ name, aggregation, ...(field === undefined ? {} : { field }) })),
        dimensions, filters, top_n: plan.top_n,
      } }, agent: exec.agent, signal: exec.signal, parent: exec.token, callId: `${String(exec.callId)}:drill` as typeof exec.callId })
      const comparison = structured(result, 'compare_tables')
      const queryId = string(comparison.query_id, 'query_id')
      const checked = await ctx.tools.execute({ name: 'mcp__insight__verify_query', arguments: { query_id: queryId },
        agent: exec.agent, signal: exec.signal, parent: exec.token, callId: `${String(exec.callId)}:verify` as typeof exec.callId })
      const verification = structured(checked, 'verify_query')
      if (verification.valid !== true || verification.query_id !== queryId) throw new Error('drilldown query failed source verification')
      exec.signal.throwIfAborted()
      retained.drillFilters = focused
      retained.drillAttempts = 0
      retained.breakdowns.push(comparison)
      delete retained.analysis
      return { plan_id: retained.planned.id, depth: focused.length, focus_filters: focused, comparison: comparisonSummary(comparison) }
    },
  }
  register(submit)
  register(run)
  register(drill)
  registerTaskTools(ctx, plans, completed, sources, register)
  return async () => {
    disposed = true
    const pending = [...active.values()]
    for (const operation of pending) operation.controller.abort(new Error('diagnostic tools were disposed'))
    await Promise.allSettled(pending.map(operation => operation.done))
    plans.clear(); submissions.clear(); executions.clear(); completed.clear(); sources.clear()
  }
}

function taskPlan(task: Record<string, unknown>, baseline: Ref, current: Ref): Plan {
  if (task.formatVersion !== 1) throw new Error('unsupported diagnostic task format')
  const columns = Array.isArray(task.columns) ? task.columns.map((item) => {
    const column = object(item)
    return { ...column, reason: column.reason ?? `Saved field link: ${String(column.baseline)} → ${String(column.current)}` }
  }) : task.columns
  const metrics = Array.isArray(task.metrics) ? task.metrics.map((item) => {
    const metric = object(item)
    return { ...metric, definition: metric.definition ?? `Saved ${String(metric.aggregation)} measure over selected physical rows` }
  }) : task.metrics
  return parseDiagnosticPlan({ baseline, current, columns, metrics,
    dimensions: task.dimensions, filters: task.filters, top_n: task.top_n,
    key_columns: task.key === undefined ? [] : [task.key] })
}

function selection(value: unknown): TableSelection {
  const row = object(value)
  const header = row.header_row
  if (!Number.isSafeInteger(header) || Number(header) < 1 || Number(header) > 200) throw new Error('saved header_row must be from 1 to 200')
  for (const name of ['data_start_row', 'data_end_row']) {
    const line = row[name]
    if (line !== undefined && line !== null && (!Number.isSafeInteger(line) || Number(line) <= Number(header))) {
      throw new Error(`saved ${name} must follow header_row`)
    }
  }
  if (row.data_start_row != null && row.data_end_row != null && Number(row.data_end_row) < Number(row.data_start_row)) {
    throw new Error('saved data_end_row must include the first data row')
  }
  if (row.sheet !== undefined && row.sheet !== null) string(row.sheet, 'saved worksheet')
  return { header_row: Number(header),
    ...(row.sheet === undefined ? {} : { sheet: row.sheet === null ? null : string(row.sheet, 'worksheet') }),
    ...(row.data_start_row === undefined ? {} : { data_start_row: row.data_start_row === null ? null : Number(row.data_start_row) }),
    ...(row.data_end_row === undefined ? {} : { data_end_row: row.data_end_row === null ? null : Number(row.data_end_row) }) }
}

function registerTaskTools(
  ctx: Context,
  plans: Map<string, PlannedRun>,
  completed: Map<string, CompletedRun>,
  sources: Map<string, Map<string, Record<string, unknown>>>,
  register: (tool: ToolDefinition) => void,
): void {
  const output: ToolDefinition['output'] = {
    schema: { type: 'object', additionalProperties: true },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
  }
  const session = (exec: ToolRunContext): string => {
    if (exec.agent === undefined) throw new Error('diagnostic tasks require an agent session')
    return String(exec.agent.id)
  }
  const directory = (exec: ToolRunContext, kind: 'tasks' | 'reports'): string => {
    const cwd = exec.agent?.session.header.cwd
    if (cwd === undefined) throw new Error('diagnostic tasks require a workspace')
    return join(cwd, '.insight', 'diagnostics', kind)
  }
  const tasks = async (exec: ToolRunContext): Promise<Record<string, unknown>[]> => {
    const folder = directory(exec, 'tasks')
    let files: string[]
    let resolved: string
    try { resolved = await realpath(folder); files = await readdir(resolved) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const cwd = exec.agent?.session.header.cwd
    if (cwd === undefined) throw new Error('diagnostic tasks require a workspace')
    const offset = relative(await realpath(cwd), resolved)
    if (isAbsolute(offset) || offset === '..' || offset.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
      throw new Error('diagnostic storage must remain inside the workspace')
    }
    const result = []
    for (const file of files.filter(name => /^[a-f0-9-]{36}\.json$/iu.test(name)).sort()) {
      exec.signal.throwIfAborted()
      const path = await realpath(join(resolved, file))
      if (relative(resolved, path) !== file) throw new Error(`diagnostic task cannot be a symbolic link: ${file}`)
      const task = object(JSON.parse(await readFile(path, { encoding: 'utf8', signal: exec.signal })))
      if (`${string(task.id, 'task id')}.json` !== file) throw new Error(`saved task id differs from its filename: ${file}`)
      string(task.name, 'task name')
      selection(task.baselineSelection); selection(task.currentSelection)
      taskPlan(task, { source_id: 'baseline', relation: 'data' }, { source_id: 'current', relation: 'data' })
      result.push(task)
    }
    return result
  }
  const resolveTask = async (exec: ToolRunContext, requested: unknown): Promise<Record<string, unknown>> => {
    const name = string(requested, 'task')
    const matches = (await tasks(exec)).filter(task => task.id === name || task.name === name)
    if (matches.length === 0) throw new Error(`saved diagnostic task not found: ${name}; call list_diagnostic_tasks`)
    if (matches.length > 1) throw new Error(`task name is ambiguous: ${name}; select its task_id from list_diagnostic_tasks`)
    const task = matches[0]
    if (task === undefined) throw new Error('saved diagnostic task is unavailable')
    return task
  }
  const writeDocuments = async (exec: ToolRunContext, documents: { kind: 'tasks' | 'reports'; id: string; document: unknown; html?: boolean }[]): Promise<string[]> => {
    const cwd = exec.agent?.session.header.cwd
    if (cwd === undefined) throw new Error('diagnostic tasks require a workspace')
    const staged: { temporary: string; target: string }[] = []
    const published: string[] = []
    try {
      for (const item of documents) {
        exec.signal.throwIfAborted()
        const folder = directory(exec, item.kind)
        await mkdir(folder, { recursive: true })
        const resolved = await realpath(folder)
        const offset = relative(await realpath(cwd), resolved)
        if (isAbsolute(offset) || offset === '..' || offset.startsWith(`..${sep}`)) {
          throw new Error('diagnostic storage must remain inside the workspace')
        }
        const target = join(resolved, `${item.id}.${item.html ? 'html' : 'json'}`)
        const temporary = `${target}.${randomUUID()}.tmp`
        staged.push({ temporary, target })
        await writeFile(temporary, `${item.html ? string(item.document, 'HTML report') : JSON.stringify(item.document, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', signal: exec.signal })
      }
      // Exclusive links publish complete files; rollback owns only links created by this operation.
      for (const item of staged) {
        exec.signal.throwIfAborted()
        await link(item.temporary, item.target)
        published.push(item.target)
        exec.signal.throwIfAborted()
      }
      return published.map(target => relative(cwd, target).replaceAll('\\', '/'))
    } catch (error) {
      await Promise.all(published.map(target => rm(target, { force: true })))
      throw error
    } finally {
      await Promise.all(staged.map(item => rm(item.temporary, { force: true })))
    }
  }
  const nested = async (exec: ToolRunContext, name: string, args: unknown, stage: string): Promise<Record<string, unknown>> => {
    if (exec.agent === undefined) throw new Error('diagnostic tasks require an agent session')
    const result = await ctx.tools.execute({ name, arguments: args, agent: exec.agent,
      signal: exec.signal, parent: exec.token, callId: `${String(exec.callId)}:${stage}` as typeof exec.callId })
    if (result.isError) throw new Error(`${name} failed: ${result.content.filter(item => item.type === 'text').map(item => item.text).join('\n')}`)
    return name.startsWith('mcp__') ? structured(result, name) : object(result.value)
  }
  const successful = (exec: ToolRunContext, id: unknown): CompletedRun => {
    const retained = completed.get(session(exec))
    if (retained === undefined || retained.planned.id !== id || plans.get(session(exec))?.id !== id) {
      throw new Error('plan_id must identify the latest successfully verified diagnostic run in this session')
    }
    return retained
  }
  const source = (exec: ToolRunContext, ref: Ref): SourceInfo => {
    const info = sources.get(session(exec))?.get(ref.source_id)
    if (info === undefined) throw new Error('source was not registered in this session; register both files again')
    const kind = info.kind
    if (kind !== 'csv' && kind !== 'xlsx' && kind !== 'sqlite' && kind !== 'duckdb') throw new Error('unsupported registered source kind')
    if (!Array.isArray(info.warnings) || !info.warnings.every(item => typeof item === 'string')) throw new Error('source warnings must contain strings')
    return { source_id: string(info.source_id, 'source_id'), kind,
      path: string(info.path, 'source path'), fingerprint: string(info.fingerprint, 'source fingerprint'), warnings: info.warnings,
      ...(info.selection === undefined ? {} : { selection: info.selection === null ? null : selection(info.selection) }) }
  }
  const saveReport = async (
    exec: ToolRunContext, retained: CompletedRun, taskId: string, task?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    for (const [index, result] of [retained.baseline, retained.current, retained.comparison, ...retained.breakdowns].entries()) {
      const queryId = string(result.query_id, 'query_id')
      const check = await nested(exec, 'mcp__insight__verify_query', { query_id: queryId }, `report:verify:${index}`)
      if (check.valid !== true || check.query_id !== queryId) throw new Error(`query ${queryId} failed source verification`)
    }
    const query = (result: Record<string, unknown>, quality: boolean) => ({ ...result, verified: true,
      warnings: quality ? result.source_warnings : [] })
    const reportId = randomUUID()
    const report: DiagnosticReport = { formatVersion: 1, id: reportId, taskId, ranAt: new Date().toISOString(),
      baseline: source(exec, retained.planned.plan.baseline), current: source(exec, retained.planned.plan.current),
      baselineQuality: query(retained.baseline, true) as QualityResult, currentQuality: query(retained.current, true) as QualityResult,
      comparison: query(retained.comparison, false) as ComparisonResult,
      dimensionBreakdowns: retained.breakdowns.map(value => query(value, false) as ComparisonResult),
      ...(retained.analysis === undefined ? {} : { narrative: structuredClone(retained.analysis) }) }
    const paths = await writeDocuments(exec, [
      { kind: 'reports', id: reportId, document: diagnosticHtml(report), html: true },
      { kind: 'reports', id: reportId, document: report },
      ...(task === undefined ? [] : [{ kind: 'tasks' as const, id: taskId, document: task }]),
    ])
    return { report_id: reportId, task_id: taskId, report_path: paths[1], html_path: paths[0], ran_at: report.ranAt,
      ...(task === undefined ? {} : { task_path: paths[2] }) }
  }
  const taskDocument = (exec: ToolRunContext, retained: CompletedRun, id: string, name: string) => {
    const plan = retained.planned.plan
    if (plan.key_columns.length > 1) throw new Error('saved workbench tasks support one uniqueness key; choose one key before saving')
    const selected = (role: 'baseline' | 'current') => {
      const info = source(exec, plan[role])
      if (info.kind !== 'csv' && info.kind !== 'xlsx') throw new Error('saved diagnostic tasks require CSV or XLSX inputs')
      return { ...selection(info.selection ?? { header_row: 1 }), ...(info.kind === 'xlsx' ? { sheet: plan[role].relation } : {}) }
    }
    return { formatVersion: 1, id, name, baselineSelection: selected('baseline'), currentSelection: selected('current'),
      columns: plan.columns, metrics: plan.metrics, dimensions: plan.dimensions, filters: plan.filters, top_n: plan.top_n,
      ...(plan.key_columns[0] === undefined ? {} : { key: plan.key_columns[0] }) }
  }
  const definitions: ToolDefinition[] = [
    {
      name: 'list_diagnostic_tasks', description: 'List reusable diagnostic tasks saved in this workspace. Select an exact name or task_id; historical tasks contain configuration, not current evidence.',
      parameters: { type: 'object', additionalProperties: false, properties: {} }, output,
      async execute(_args, exec) { session(exec); return { tasks: await tasks(exec) } },
    },
    {
      name: 'save_diagnostic_task', description: 'Save the latest successfully executed diagnostic plan under a user-requested name, preserving field links, metric definitions, filters, selected regions and one optional uniqueness key. Also save a new verified run report. Does not overwrite existing tasks.',
      parameters: { type: 'object', additionalProperties: false, properties: { plan_id: { type: 'string' }, name: { type: 'string' } }, required: ['plan_id', 'name'] }, output,
      async execute(args, exec) {
        const input = object(args)
        const retained = successful(exec, input.plan_id)
        const name = string(input.name, 'task name').trim()
        if ((await tasks(exec)).some(task => task.name === name)) throw new Error(`task name already exists: ${name}; choose another name`)
        const id = randomUUID()
        const task = taskDocument(exec, retained, id, name)
        return { name, ...await saveReport(exec, retained, id, task) }
      },
    },
    {
      name: 'update_diagnostic_task',
      description: 'After the user confirms a revised mapping or calculation and the revised plan executes successfully, update the existing named task from that plan. Preserve task identity and all historical reports. Supply the user-confirmed reason; do not infer permission to change a saved definition from a compatibility failure.',
      parameters: { type: 'object', additionalProperties: false, properties: {
        task: { type: 'string' }, plan_id: { type: 'string' }, reason: { type: 'string' },
      }, required: ['task', 'plan_id', 'reason'] }, output,
      async execute(args, exec) {
        const input = object(args)
        const reason = string(input.reason, 'user-confirmed revision reason')
        const cwd = exec.agent?.session.header.cwd
        if (cwd === undefined) throw new Error('diagnostic task revision requires a workspace')
        const retained = successful(exec, input.plan_id)
        const previous = await resolveTask(exec, input.task)
        const id = string(previous.id, 'task id')
        const name = string(previous.name, 'task name')
        const task = taskDocument(exec, retained, id, name)
        for (const [index, result] of [retained.baseline, retained.current, retained.comparison].entries()) {
          const queryId = string(result.query_id, 'query_id')
          const check = await nested(exec, 'mcp__insight__verify_query', { query_id: queryId }, `revision:verify:${index}`)
          if (check.valid !== true || check.query_id !== queryId) throw new Error(`query ${queryId} failed source verification`)
        }
        const folder = await realpath(directory(exec, 'tasks'))
        const offset = relative(await realpath(cwd), folder)
        if (isAbsolute(offset) || offset === '..' || offset.startsWith(`..${sep}`)) throw new Error('diagnostic storage must remain inside the workspace')
        const target = await realpath(join(folder, `${id}.json`))
        if (relative(folder, target) !== `${id}.json`) throw new Error('diagnostic task cannot be a symbolic link')
        const temporary = `${target}.${randomUUID()}.tmp`
        try {
          await writeFile(temporary, `${JSON.stringify(task, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', signal: exec.signal })
          if (!isDeepStrictEqual(previous, object(JSON.parse(await readFile(target, 'utf8'))))) {
            throw new Error('saved task changed during revision; list tasks and confirm its current definition')
          }
          exec.signal.throwIfAborted()
          await rename(temporary, target)
        } finally { await rm(temporary, { force: true }) }
        return { task_id: id, name, reason, task, task_path: relative(cwd, target).replaceAll('\\', '/') }
      },
    },
    {
      name: 'save_diagnostic_report', description: 'Save a fresh report from the latest successfully verified plan. Call submit_analysis first to include its accepted interpretation, cell-verified facts, assumptions, limitations and business hypotheses. Supply a saved task name/id to associate it; source changes or stale plan IDs reject saving. Returns workspace-relative JSON and HTML paths.',
      parameters: { type: 'object', additionalProperties: false, properties: { plan_id: { type: 'string' }, task: { type: 'string' } }, required: ['plan_id'] }, output,
      async execute(args, exec) {
        const input = object(args)
        const retained = successful(exec, input.plan_id)
        const taskId = input.task === undefined ? retained.planned.id : string((await resolveTask(exec, input.task)).id, 'task id')
        return saveReport(exec, retained, taskId)
      },
    },
    {
      name: 'run_diagnostic_task', description: 'Rerun a saved task using two replacement CSV/XLSX paths. Restore selected regions and confirmed calculations, register fresh sources, inspect field compatibility, execute and verify a new plan, then save an independent report. Ask the user about incompatible fields instead of changing the saved definition.',
      parameters: { type: 'object', additionalProperties: false, properties: {
        task: { type: 'string', description: 'Exact saved task name or task_id.' },
        baseline_path: { type: 'string' }, current_path: { type: 'string' },
      }, required: ['task', 'baseline_path', 'current_path'] }, output,
      async execute(args, exec) {
        const input = object(args)
        const task = await resolveTask(exec, input.task)
        const refs: Ref[] = []
        const compatibility: { role: 'baseline' | 'current'; columns: Record<string, unknown>[]; missing: string[]; numeric_type_conflicts: string[] }[] = []
        for (const role of ['baseline', 'current'] as const) {
          const requested = string(input[`${role}_path`], `${role}_path`)
          const cwd = exec.agent?.session.header.cwd
          if (cwd === undefined) throw new Error('diagnostic tasks require a workspace')
          const path = resolve(cwd, requested)
          const offset = relative(cwd, path)
          if (isAbsolute(offset) || offset === '..' || offset.startsWith(`..${sep}`)) {
            throw new Error('replacement files must remain inside the current session workspace')
          }
          const kind = extname(path).slice(1).toLowerCase()
          if (kind !== 'csv' && kind !== 'xlsx') throw new Error('replacement files must be CSV or XLSX')
          const chosen = selection(task[`${role}Selection`])
          const info = await nested(exec, 'mcp__insight__register_source', { path, kind, selection: chosen }, `task:${role}:register`)
          const sourceId = string(info.source_id, 'source_id')
          const relations = await nested(exec, 'mcp__insight__list_relations', { source_id: sourceId }, `task:${role}:relations`)
          if (!Array.isArray(relations.relations) || relations.relations.length !== 1) throw new Error('saved task must select one worksheet; ask the user to confirm the sheet')
          const relation = string(relations.relations[0], 'relation')
          const schema = await nested(exec, 'mcp__insight__describe_relation', { source_id: sourceId, relation }, `task:${role}:schema`)
          const columns = Array.isArray(schema.columns) ? schema.columns.map(object) : []
          const fields = columns.map(item => string(item.name, 'field name'))
          const preview = taskPlan(task, { source_id: 'baseline', relation: 'data' }, { source_id: 'current', relation: 'data' })
          const missing = preview.columns.map(column => column[role]).filter(field => !fields.includes(field))
          const numericTypeConflicts = preview.metrics.filter(metric => ['sum', 'avg'].includes(metric.aggregation))
            .map(metric => preview.columns.find(column => column.name === metric.field)?.[role])
            .filter((field): field is string => field !== undefined && fields.includes(field) &&
              !/INT|DECIMAL|DOUBLE|FLOAT|NUMERIC|REAL|HUGEINT/iu.test(String(columns.find(column => column.name === field)?.type)))
          compatibility.push({ role, columns, missing, numeric_type_conflicts: [...new Set(numericTypeConflicts)] })
          refs.push({ source_id: sourceId, relation })
        }
        const baseline = refs[0]; const current = refs[1]
        if (baseline === undefined || current === undefined) throw new Error('task requires both selected inputs')
        if (compatibility.some(item => item.missing.length > 0 || item.numeric_type_conflicts.length > 0)) {
          return { status: 'needs_confirmation', task_id: task.id, name: task.name, saved_task: task,
            baseline, current, compatibility,
            correction: 'Explain the missing fields or numeric type conflicts and ask the user to confirm a revised mapping or calculation. Submit and execute that revised plan using these fresh source references, then call update_diagnostic_task only if the user wants the saved definition revised. Historical reports remain unchanged.' }
        }
        const plan = taskPlan(task, baseline, current)
        const submitted = await nested(exec, 'submit_diagnostic_plan', { ...plan, reason: `Reuse saved task: ${String(task.name)}` }, 'task:plan')
        const planId = string(submitted.plan_id, 'plan_id')
        const result = await nested(exec, 'execute_diagnostic_plan', { plan_id: planId }, 'task:execute')
        if (result.status === 'blocked') return { name: task.name, task_id: task.id, ...result }
        const report = await saveReport(exec, successful(exec, planId), string(task.id, 'task id'))
        return { name: task.name, ...result, ...report }
      },
    },
  ]
  for (const definition of definitions) register(definition)
}
