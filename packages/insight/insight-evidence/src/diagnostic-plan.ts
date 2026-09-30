import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolExecutionResult } from '@deepseek-ai/dsh-tools'

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
function ref(value: unknown): Ref {
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
    if (aggregation !== 'count' && (field === undefined || !names.includes(field))) throw new Error('metric field must be mapped')
    if (field !== undefined && !names.includes(field)) throw new Error('metric field must be mapped')
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
  const baseline = ref(row.baseline)
  const current = ref(row.current)
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
  const findings = Array.isArray(result.findings) ? result.findings : []
  const warnings = Array.isArray(result.source_warnings) ? result.source_warnings : []
  return { query_id: result.query_id, row_total: result.row_total,
    findings: findings.slice(0, 10).map((item) => {
      const finding = object(item)
      return { kind: finding.kind, count: finding.count, rate: finding.rate,
        classification: finding.classification,
        ...(finding.field === undefined ? {} : { field: finding.field }),
        ...(finding.fields === undefined ? {} : { fields: finding.fields }) }
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

/** Register model-visible plan and bounded execution tools for one Insight preset.
 * @param ctx - Plugin context with the shared tool registry.
 * @param maxCorrections - Maximum revisions and retries after the first plan.
 * @returns Cleanup function for retained live-session plans.
 */
export function registerDiagnosticPlan(ctx: Context, maxCorrections: number): () => void {
  const plans = new Map<string, PlannedRun>()
  ctx.on('agent/disposed', ({ agent }) => { plans.delete(String(agent.id)) })
  const submit: ToolDefinition = {
    name: 'submit_diagnostic_plan',
    description: 'Submit or revise a structured, bounded two-period diagnostic plan before running it. Explain each field mapping and metric definition.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      baseline: { type: 'object', properties: { source_id: { type: 'string' }, relation: { type: 'string' } }, required: ['source_id', 'relation'] },
      current: { type: 'object', properties: { source_id: { type: 'string' }, relation: { type: 'string' } }, required: ['source_id', 'relation'] },
      columns: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, baseline: { type: 'string' }, current: { type: 'string' }, reason: { type: 'string' } }, required: ['name', 'baseline', 'current', 'reason'] } },
      metrics: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, aggregation: { type: 'string', enum: ['sum', 'count', 'count_distinct', 'avg'] }, field: { type: 'string' }, definition: { type: 'string' } }, required: ['name', 'aggregation', 'definition'] } },
      dimensions: { type: 'array', items: { type: 'string' } }, key_columns: { type: 'array', items: { type: 'string' } }, top_n: { type: 'integer' }, reason: { type: 'string' },
      filters: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, operator: { type: 'string', enum: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'is_null', 'not_null'] }, value: { type: ['string', 'number', 'boolean'] } }, required: ['field', 'operator'] } },
    }, required: ['baseline', 'current', 'columns', 'metrics', 'dimensions'] },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute(args, exec) {
      if (exec.agent === undefined) throw new Error('diagnostic plan requires an agent session')
      const input = object(args)
      const plan = parseDiagnosticPlan(input)
      const session = String(exec.agent.id)
      const previous = plans.get(session)
      if (previous !== undefined && previous.revisions >= maxCorrections) throw new Error('diagnostic plan revision budget exhausted')
      if (previous !== undefined) string(input.reason, 'revision reason')
      const current = { id: randomUUID(), plan, revisions: (previous?.revisions ?? -1) + 1, attempts: 0 }
      plans.set(session, current)
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
      if (planned.attempts > maxCorrections) throw new Error('diagnostic execution correction budget exhausted')
      planned.attempts += 1
      const plan = planned.plan
      const call = async (name: string, parameters: unknown, stage: string): Promise<Record<string, unknown>> => {
        const result = await ctx.tools.execute({ name, arguments: parameters, agent, signal: exec.signal,
          parent: exec.token, callId: `${String(exec.callId)}:${stage}` as typeof exec.callId })
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
      for (const [index, result] of [baseline, current, comparison, ...dimensionBreakdowns].entries()) {
        const queryId = string(result.query_id, 'query_id')
        const check = await call('mcp__insight__verify_query', { query_id: queryId }, `verify:${index}`)
        if (check.valid !== true || check.query_id !== queryId) throw new Error(`query ${queryId} failed source verification`)
      }
      return { plan_id: planned.id, baseline_quality: qualitySummary(baseline), current_quality: qualitySummary(current),
        comparison: comparisonSummary(comparison), dimension_breakdowns: dimensionBreakdowns.map(comparisonSummary) }
    },
  }
  ctx.effect(() => ctx.tools.register(submit), 'insight diagnostic plan')
  ctx.effect(() => ctx.tools.register(run), 'insight diagnostic execution')
  return () => { plans.clear() }
}
