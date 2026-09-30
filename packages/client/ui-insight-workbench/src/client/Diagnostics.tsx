import { useEffect, useState, type ReactNode } from 'react'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  ColumnInfo,
  ComparisonColumn,
  ComparisonFilter,
  ComparisonMetric,
  ComparisonResult,
  ComparisonSpec,
  DiagnosticReport,
  DiagnosticTask,
  RelationSchema,
  SourceInfo,
  TablePreview,
  TableSelection,
} from '@deepseek-ai/dsh-api-insight-controller/types'
import type { InsightInjected } from './Workbench.tsx'
import { diagnosticHtml, displayCell } from './diagnostic-report.ts'
import css from './Workbench.module.css'

type Role = 'baseline' | 'current'
type T = PropsLocale<'insightWorkbench'>['t']
interface Period {
  path: string
  kind: 'csv' | 'xlsx'
  preview?: TablePreview
  selection: TableSelection
  source?: SourceInfo | undefined
  relation?: string
  schema?: RelationSchema | undefined
}
type DiagnosticApi = Pick<
  InsightInjected,
  | 'upload'
  | 'preview'
  | 'registerSelected'
  | 'relations'
  | 'describe'
  | 'diagnose'
  | 'compare'
  | 'saveTask'
  | 'listTasks'
  | 'saveReport'
>
type Props = DiagnosticApi & { agentRunning: boolean; t: T }
const emptyPeriod = (): Period => ({ path: '', kind: 'csv', selection: { header_row: 1 } })

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
function extension(file: File): 'csv' | 'xlsx' {
  return file.name.toLowerCase().endsWith('.xlsx') ? 'xlsx' : 'csv'
}
function typeFamily(type: string): string {
  const normalized = type.toUpperCase()
  if (/INT|DECIMAL|DOUBLE|FLOAT|NUMERIC|REAL/iu.test(normalized)) return 'number'
  if (/DATE|TIME/iu.test(normalized)) return 'date'
  if (/BOOL/iu.test(normalized)) return 'boolean'
  return 'text'
}

/** Two-period diagnostic workbench backed by read-only, verified MCP queries. */
export function Diagnostics(api: Props): ReactNode {
  const { t } = api
  const [periods, setPeriods] = useState<Record<Role, Period>>({ baseline: emptyPeriod(), current: emptyPeriod() })
  const [mapping, setMapping] = useState<ComparisonColumn[]>([])
  const [metrics, setMetrics] = useState<ComparisonMetric[]>([{ name: 'total', aggregation: 'sum' }])
  const [dimensions, setDimensions] = useState<string[]>([])
  const [filters, setFilters] = useState<ComparisonFilter[]>([])
  const [topN, setTopN] = useState(10)
  const [key, setKey] = useState('')
  const [taskName, setTaskName] = useState('')
  const [tasks, setTasks] = useState<DiagnosticTask[]>([])
  const [taskId, setTaskId] = useState<string>()
  const [stage, setStage] = useState('')
  const [error, setError] = useState('')
  const [report, setReport] = useState<DiagnosticReport>()
  const [controller, setController] = useState<AbortController>()
  const busy = controller !== undefined
  const baseline = periods.baseline
  const current = periods.current
  const mappedNames = mapping.map(item => item.name)

  useEffect(() => {
    void api
      .listTasks()
      .then(setTasks)
      .catch((error: unknown) => {
        setError(errorText(error))
      })
  }, [api.listTasks])

  function update(role: Role, change: Partial<Period>): void {
    setPeriods(previous => ({ ...previous, [role]: { ...previous[role], ...change } }))
  }
  async function previewFile(role: Role, file: File): Promise<void> {
    const next = new AbortController()
    setController(next)
    setError('')
    setStage(t('diagnostics.previewing'))
    try {
      const kind = extension(file)
      const path = await api.upload(file, kind, next.signal)
      const preview = await api.preview(path, kind, null, next.signal)
      const retained = taskId === undefined ? { header_row: 1 } : periods[role].selection
      const sheet =
        retained.sheet !== undefined && retained.sheet !== null && preview.sheets.includes(retained.sheet)
          ? retained.sheet
          : preview.sheet
      setPeriods(previous => ({ ...previous, [role]: { path, kind, preview, selection: { ...retained, sheet } } }))
      if (taskId === undefined) setMapping([])
      setStage('')
    } catch (error) {
      if (!next.signal.aborted) setError(errorText(error))
    } finally {
      setController(undefined)
    }
  }
  async function selectSheet(role: Role, sheet: string): Promise<void> {
    const period = periods[role]
    const next = new AbortController()
    setController(next)
    setError('')
    try {
      const preview = await api.preview(period.path, period.kind, sheet, next.signal)
      update(role, { preview, selection: { ...period.selection, sheet }, source: undefined, schema: undefined })
    } catch (error) {
      if (!next.signal.aborted) setError(errorText(error))
    } finally {
      setController(undefined)
    }
  }
  async function registerBoth(): Promise<void> {
    const next = new AbortController()
    setController(next)
    setError('')
    setStage(t('diagnostics.registering'))
    try {
      const loaded: Record<Role, Period> = { baseline: { ...baseline }, current: { ...current } }
      for (const role of ['baseline', 'current'] as const) {
        const period = loaded[role]
        const source = await api.registerSelected(period.path, period.kind, period.selection, next.signal)
        const list = await api.relations(source.source_id, next.signal)
        const relation = period.kind === 'csv' ? 'data' : (period.selection.sheet ?? list.relations[0])
        if (relation === undefined) throw new Error(t('diagnostics.emptySheet'))
        const schema = await api.describe(source.source_id, relation, next.signal)
        loaded[role] = { ...period, source, relation, schema }
      }
      setPeriods(loaded)
      const beforeColumns = new Map(loaded.baseline.schema?.columns.map(column => [column.name, column]))
      const linked =
        loaded.current.schema?.columns
          .filter((column) => {
            const before = beforeColumns.get(column.name)
            return before !== undefined && typeFamily(before.type) === typeFamily(column.type)
          })
          .map(column => ({ name: column.name, baseline: column.name, current: column.name })) ?? []
      if (mapping.length === 0) setMapping(linked)
      setStage('')
    } catch (error) {
      if (!next.signal.aborted) setError(errorText(error))
    } finally {
      setController(undefined)
    }
  }
  function changeMapping(index: number, role: Role, field: string): void {
    setMapping(previous => previous.map((item, position) => (position === index ? { ...item, [role]: field } : item)))
  }
  function changeMetric(index: number, change: Partial<ComparisonMetric>): void {
    setMetrics(previous => previous.map((item, position) => (position === index ? { ...item, ...change } : item)))
  }
  function useTask(id: string): void {
    const task = tasks.find(item => item.id === id)
    if (task === undefined) return
    setTaskId(id)
    setTaskName(task.name)
    setMapping([...task.columns])
    setMetrics([...task.metrics])
    setDimensions([...task.dimensions])
    setFilters([...task.filters])
    setTopN(task.top_n)
    setKey(task.key ?? '')
    setPeriods(previous => ({
      baseline: { ...previous.baseline, selection: task.baselineSelection, source: undefined, schema: undefined },
      current: { ...previous.current, selection: task.currentSelection, source: undefined, schema: undefined },
    }))
    setError('')
    setStage(t('diagnostics.reimport'))
  }
  function makeTask(id: string): DiagnosticTask {
    return {
      formatVersion: 1,
      id,
      name: taskName.trim(),
      baselineSelection: baseline.selection,
      currentSelection: current.selection,
      columns: mapping,
      metrics,
      dimensions,
      filters,
      top_n: topN,
      ...(key ? { key } : {}),
    }
  }
  function configurationValid(): boolean {
    const names = new Set(mappedNames)
    return (
      names.size === mapping.length &&
      mapping.length > 0 &&
      mapping.every(item => item.name.trim() !== '') &&
      metrics.length > 0 &&
      metrics.length <= 3 &&
      metrics.every(
        item =>
          item.name.trim() !== '' &&
          (item.aggregation === 'count'
            ? item.field === undefined || item.field === null || names.has(item.field)
            : item.field !== undefined && item.field !== null && names.has(item.field)),
      ) &&
      dimensions.length <= 2 &&
      dimensions.every(item => names.has(item)) &&
      filters.length <= 8 &&
      filters.every(item => names.has(item.field)) &&
      (!key || names.has(key)) &&
      Number.isSafeInteger(topN) &&
      topN >= 1 &&
      topN <= 50
    )
  }
  async function saveTask(): Promise<void> {
    try {
      if (!configurationValid()) throw new Error(t('diagnostics.configure'))
      const id = taskId ?? randomUUID()
      const task = makeTask(id)
      await api.saveTask(task)
      setTaskId(id)
      setTasks(await api.listTasks())
      setStage(t('diagnostics.taskSaved'))
    } catch (error) {
      setError(errorText(error))
    }
  }
  async function run(): Promise<void> {
    const next = new AbortController()
    setController(next)
    setError('')
    try {
      if (
        baseline.source === undefined ||
        current.source === undefined ||
        baseline.schema === undefined ||
        current.schema === undefined ||
        baseline.relation === undefined ||
        current.relation === undefined
      ) {
        throw new Error(t('diagnostics.registerFirst'))
      }
      if (!configurationValid()) {
        throw new Error(t('diagnostics.configure'))
      }
      for (const item of mapping) {
        if (
          !baseline.schema.columns.some(column => column.name === item.baseline) ||
          !current.schema.columns.some(column => column.name === item.current)
        ) {
          throw new Error(`${t('diagnostics.mappingMismatch')}: ${item.name}`)
        }
      }
      const metricFields = metrics
        .filter(item => item.field !== undefined && ['sum', 'avg'].includes(item.aggregation))
        .map(item => item.field as string)
      const metricColumns = (role: Role) =>
        metricFields
          .map(field => mapping.find(item => item.name === field)?.[role])
          .filter((field): field is string => field !== undefined)
      setStage(t('diagnostics.checking'))
      const baselineQuality = await api.diagnose(
        baseline.source.source_id,
        baseline.relation,
        key ? [mapping.find(item => item.name === key)?.baseline ?? key] : [],
        metricColumns('baseline'),
        next.signal,
      )
      const currentQuality = await api.diagnose(
        current.source.source_id,
        current.relation,
        key ? [mapping.find(item => item.name === key)?.current ?? key] : [],
        metricColumns('current'),
        next.signal,
      )
      const specification: ComparisonSpec = {
        baseline: { source_id: baseline.source.source_id, relation: baseline.relation },
        current: { source_id: current.source.source_id, relation: current.relation },
        columns: mapping,
        metrics,
        dimensions,
        filters,
        top_n: topN,
      }
      setStage(t('diagnostics.comparing'))
      const comparison = await api.compare(specification, next.signal)
      const dimensionBreakdowns: ComparisonResult[] = []
      if (dimensions.length > 1) {
        for (const dimension of dimensions) {
          dimensionBreakdowns.push(await api.compare({ ...specification, dimensions: [dimension] }, next.signal))
        }
      }
      const nextReport: DiagnosticReport = {
        formatVersion: 1,
        id: randomUUID(),
        taskId: taskId ?? randomUUID(),
        ranAt: new Date().toISOString(),
        baseline: baseline.source,
        current: current.source,
        baselineQuality,
        currentQuality,
        comparison,
        dimensionBreakdowns,
      }
      setStage(t('diagnostics.saving'))
      await api.saveReport(nextReport, next.signal)
      next.signal.throwIfAborted()
      setReport(nextReport)
      setStage(t('diagnostics.complete'))
    } catch (error) {
      if (!next.signal.aborted) setError(errorText(error))
    } finally {
      setController(undefined)
    }
  }
  function downloadReport(): void {
    if (report === undefined) return
    const url = URL.createObjectURL(new Blob([diagnosticHtml(report)], { type: 'text/html;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `insight-diagnostic-${report.id}.html`
    anchor.click()
    queueMicrotask(() => {
      URL.revokeObjectURL(url)
    })
  }
  function periodEditor(role: Role, title: string): ReactNode {
    const period = periods[role]
    return (
      <section className={css.section}>
        <h2>{title}</h2>
        <input
          type="file"
          accept=".csv,.xlsx"
          disabled={busy || api.agentRunning}
          aria-label={title}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file !== undefined) void previewFile(role, file)
          }}
        />
        {period.path && <p className={css.meta}>{period.path}</p>}
        {period.preview !== undefined && (
          <>
            {period.preview.sheets.length > 0 && (
              <label>
                {t('diagnostics.sheet')}
                <select
                  value={period.selection.sheet ?? period.preview.sheet ?? ''}
                  onChange={(event) => {
                    void selectSheet(role, event.target.value)
                  }}
                >
                  {period.preview.sheets.map(sheet => (
                    <option key={sheet} value={sheet}>
                      {sheet}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className={css.formGrid}>
              <label>
                {t('diagnostics.headerRow')}
                <input
                  type="number"
                  min="1"
                  max="200"
                  value={period.selection.header_row}
                  onChange={(event) => {
                    update(role, {
                      selection: { ...period.selection, header_row: Number(event.target.value) },
                      source: undefined,
                      schema: undefined,
                    })
                  }}
                />
              </label>
              <label>
                {t('diagnostics.startRow')}
                <input
                  type="number"
                  min="2"
                  value={period.selection.data_start_row ?? ''}
                  onChange={(event) => {
                    update(role, {
                      selection: {
                        ...period.selection,
                        data_start_row: event.target.value ? Number(event.target.value) : null,
                      },
                      source: undefined,
                      schema: undefined,
                    })
                  }}
                />
              </label>
              <label>
                {t('diagnostics.endRow')}
                <input
                  type="number"
                  min="2"
                  value={period.selection.data_end_row ?? ''}
                  onChange={(event) => {
                    update(role, {
                      selection: {
                        ...period.selection,
                        data_end_row: event.target.value ? Number(event.target.value) : null,
                      },
                      source: undefined,
                      schema: undefined,
                    })
                  }}
                />
              </label>
            </div>
            <div className={css.tableWrap}>
              <table>
                <tbody>
                  {period.preview.rows.map((row, index) => (
                    <tr key={index}>
                      <th>{index + 1}</th>
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex}>{displayCell(cell)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {period.schema !== undefined && (
          <p className={css.meta}>
            {period.schema.columns.length} {t('diagnostics.fields')} · {period.source?.fingerprint.slice(0, 12)}
          </p>
        )}
      </section>
    )
  }
  const fieldOptions = (columns: readonly ColumnInfo[] | undefined) =>
    columns?.map(column => (
      <option key={column.name} value={column.name}>
        {column.name} ({column.type})
      </option>
    ))
  const beforeColumns = new Map(baseline.schema?.columns.map(column => [column.name, column]))
  const afterColumns = new Map(current.schema?.columns.map(column => [column.name, column]))
  const added =
    current.schema?.columns.filter(column => !beforeColumns.has(column.name)).map(column => column.name) ?? []
  const removed =
    baseline.schema?.columns.filter(column => !afterColumns.has(column.name)).map(column => column.name) ?? []
  const changed =
    current.schema?.columns
      .filter((column) => {
        const before = beforeColumns.get(column.name)
        return before !== undefined && typeFamily(before.type) !== typeFamily(column.type)
      })
      .map(column => `${column.name}: ${beforeColumns.get(column.name)?.type} → ${column.type}`) ?? []
  const qualitySection = (role: Role, result: DiagnosticReport['baselineQuality']): ReactNode => (
    <section>
      <h2>
        {t(`diagnostics.${role}`)} · {t('diagnostics.quality')}
      </h2>
      <p className={css.meta}>
        {result.row_total} {t('result.rows')} · {result.findings.length} {t('diagnostics.findings')}
      </p>
      <div className={css.tableWrap}>
        <table>
          <thead>
            <tr>
              <th>{t('diagnostics.finding')}</th>
              <th>{t('diagnostics.field')}</th>
              <th>{t('diagnostics.classification')}</th>
              <th>{t('diagnostics.count')}</th>
              <th>{t('diagnostics.share')}</th>
              <th>{t('diagnostics.queryEvidence')}</th>
            </tr>
          </thead>
          <tbody>
            {result.findings.map((item, index) => (
              <tr key={`${item.kind}-${index}`}>
                <td>{item.kind}</td>
                <td>{item.field ?? item.fields?.join(', ') ?? '—'}</td>
                <td>{t(`diagnostics.classification.${item.classification ?? 'observation'}`)}</td>
                <td>{item.count}</td>
                <td>{(item.rate * 100).toFixed(2)}%</td>
                <td>
                  {item.query_id ? (
                    <a href={`#query-${result.query_id}`}>{item.query_id}</a>
                  ) : (
                    t('diagnostics.sourceWarning')
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {result.source_warnings.map((warning, index) => (
        <p key={index} className={css.warning}>
          {warning}
        </p>
      ))}
      <details id={`query-${result.query_id}`}>
        <summary>
          {t('diagnostics.queryEvidence')} · {result.query_id}
        </summary>
        <pre>{result.sql}</pre>
      </details>
    </section>
  )
  const groupRows =
    report?.comparison.groups.map(group => ({
      label: group.dimensions.map(value => displayCell(value, 'NULL')).join(' / '),
      delta: group.metrics[0]?.delta ?? 0,
    })) ?? []
  const groupMax = Math.max(1, ...groupRows.map(row => Math.abs(row.delta)))
  return (
    <>
      <section className={css.section}>
        <h2>{t('diagnostics.title')}</h2>
        <p className={css.meta}>{t('diagnostics.description')}</p>
        <label>
          {t('diagnostics.savedTask')}
          <select
            value={taskId ?? ''}
            onChange={(event) => {
              useTask(event.target.value)
            }}
          >
            <option value="" />
            {tasks.map(task => (
              <option key={task.id} value={task.id}>
                {task.name}
              </option>
            ))}
          </select>
        </label>
      </section>
      <div className={css.workspace}>
        {periodEditor('baseline', t('diagnostics.baseline'))}
        {periodEditor('current', t('diagnostics.current'))}
      </div>
      <button
        type="button"
        disabled={busy || api.agentRunning || !baseline.path || !current.path}
        onClick={() => {
          void registerBoth()
        }}
      >
        {t('diagnostics.registerBoth')}
      </button>
      {baseline.schema !== undefined && current.schema !== undefined && (
        <section className={css.section}>
          <h2>{t('diagnostics.mapping')}</h2>
          <p className={css.meta}>{t('diagnostics.mappingHint')}</p>
          {(added.length > 0 || removed.length > 0 || changed.length > 0) && (
            <div className={css.meta}>
              {added.length > 0 && (
                <p>
                  {t('diagnostics.addedFields')}: {added.join(', ')}
                </p>
              )}
              {removed.length > 0 && (
                <p>
                  {t('diagnostics.missingFields')}: {removed.join(', ')}
                </p>
              )}
              {changed.length > 0 && (
                <p>
                  {t('diagnostics.changedTypes')}: {changed.join(', ')}
                </p>
              )}
            </div>
          )}
          <div className={css.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>{t('diagnostics.name')}</th>
                  <th>{t('diagnostics.baseline')}</th>
                  <th>{t('diagnostics.current')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {mapping.map((item, index) => (
                  <tr key={`${item.name}-${index}`}>
                    <td>
                      <input
                        value={item.name}
                        onChange={(event) => {
                          setMapping(previous =>
                            previous.map((entry, position) =>
                              position === index ? { ...entry, name: event.target.value } : entry,
                            ),
                          )
                        }}
                      />
                    </td>
                    <td>
                      <select
                        value={item.baseline}
                        onChange={(event) => {
                          changeMapping(index, 'baseline', event.target.value)
                        }}
                      >
                        {fieldOptions(baseline.schema?.columns)}
                      </select>
                    </td>
                    <td>
                      <select
                        value={item.current}
                        onChange={(event) => {
                          changeMapping(index, 'current', event.target.value)
                        }}
                      >
                        {fieldOptions(current.schema?.columns)}
                      </select>
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => {
                          setMapping(previous => previous.filter((_, position) => position !== index))
                        }}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            onClick={() => {
              const before = baseline.schema?.columns[0]?.name
              const after = current.schema?.columns[0]?.name
              if (before && after)
                setMapping(previous => [
                  ...previous,
                  { name: `field_${previous.length + 1}`, baseline: before, current: after },
                ])
            }}
          >
            {t('diagnostics.addMapping')}
          </button>
          <h2>{t('diagnostics.metrics')}</h2>
          {metrics.map((item, index) => (
            <div key={index} className={css.row}>
              <input
                aria-label={t('diagnostics.name')}
                value={item.name}
                onChange={(event) => {
                  changeMetric(index, { name: event.target.value })
                }}
              />
              <select
                value={item.aggregation}
                onChange={(event) => {
                  changeMetric(index, { aggregation: event.target.value as ComparisonMetric['aggregation'] })
                }}
              >
                <option value="sum">{t('config.sum')}</option>
                <option value="count">{t('config.count')}</option>
                <option value="count_distinct">{t('config.countDistinct')}</option>
                <option value="avg">{t('config.avg')}</option>
              </select>
              <select
                value={item.field ?? ''}
                onChange={(event) => {
                  changeMetric(index, { field: event.target.value || null })
                }}
              >
                <option value="" />
                {mappedNames.map(name => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  setMetrics(previous => previous.filter((_, position) => position !== index))
                }}
              >
                ×
              </button>
            </div>
          ))}
          {metrics.length < 3 && (
            <button
              type="button"
              onClick={() => {
                setMetrics(previous => [...previous, { name: `metric_${previous.length + 1}`, aggregation: 'count' }])
              }}
            >
              {t('diagnostics.addMetric')}
            </button>
          )}
          <h2>{t('diagnostics.dimensions')}</h2>
          {[0, 1].map(index => (
            <select
              key={index}
              aria-label={`${t('diagnostics.dimensions')} ${index + 1}`}
              value={dimensions[index] ?? ''}
              onChange={(event) => {
                setDimensions((previous) => {
                  const next = [...previous]
                  next[index] = event.target.value
                  return next.filter(Boolean)
                })
              }}
            >
              <option value="" />
              {mappedNames.map(name => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          ))}
          <h2>{t('diagnostics.filters')}</h2>
          {filters.map((item, index) => (
            <div key={index} className={css.row}>
              <select
                aria-label={t('diagnostics.filterField')}
                value={item.field}
                onChange={(event) => {
                  setFilters(previous =>
                    previous.map((entry, position) =>
                      position === index ? { ...entry, field: event.target.value } : entry,
                    ),
                  )
                }}
              >
                {mappedNames.map(name => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <select
                aria-label={t('diagnostics.filterOperator')}
                value={item.operator}
                onChange={(event) => {
                  const operator = event.target.value as ComparisonFilter['operator']
                  setFilters(previous =>
                    previous.map((entry, position) =>
                      position === index
                        ? {
                          field: entry.field,
                          operator,
                          ...(['is_null', 'not_null'].includes(operator) ? {} : { value: entry.value ?? '' }),
                        }
                        : entry,
                    ),
                  )
                }}
              >
                {(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'is_null', 'not_null'] as const).map(operator => (
                  <option key={operator} value={operator}>
                    {t(`diagnostics.operator.${operator}`)}
                  </option>
                ))}
              </select>
              {item.operator !== 'is_null' && item.operator !== 'not_null' && (
                <input
                  aria-label={t('diagnostics.filterValue')}
                  value={displayCell(item.value)}
                  onChange={(event) => {
                    setFilters(previous =>
                      previous.map((entry, position) =>
                        position === index ? { ...entry, value: event.target.value } : entry,
                      ),
                    )
                  }}
                />
              )}
              <button
                type="button"
                aria-label={t('diagnostics.removeFilter')}
                onClick={() => {
                  setFilters(previous => previous.filter((_, position) => position !== index))
                }}
              >
                ×
              </button>
            </div>
          ))}
          {filters.length < 8 && (
            <button
              type="button"
              disabled={mappedNames.length === 0}
              onClick={() => {
                setFilters(previous => [...previous, { field: mappedNames[0] ?? '', operator: 'eq', value: '' }])
              }}
            >
              {t('diagnostics.addFilter')}
            </button>
          )}
          <label>
            {t('diagnostics.topN')}
            <input
              type="number"
              min="1"
              max="50"
              value={topN}
              onChange={(event) => {
                setTopN(Number(event.target.value))
              }}
            />
          </label>
          <label>
            {t('diagnostics.key')}
            <select
              value={key}
              onChange={(event) => {
                setKey(event.target.value)
              }}
            >
              <option value="" />
              {mappedNames.map(name => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <div className={css.row}>
            <input
              placeholder={t('diagnostics.taskName')}
              value={taskName}
              onChange={(event) => {
                setTaskName(event.target.value)
              }}
            />
            <button
              type="button"
              disabled={busy || !taskName.trim() || !configurationValid()}
              onClick={() => {
                void saveTask()
              }}
            >
              {t('diagnostics.saveTask')}
            </button>
            <button
              type="button"
              disabled={busy || api.agentRunning || !configurationValid()}
              onClick={() => {
                void run()
              }}
            >
              {t('diagnostics.run')}
            </button>
          </div>
        </section>
      )}
      {busy && (
        <button
          type="button"
          onClick={() => {
            controller.abort()
            setController(undefined)
            setStage(t('action.cancel'))
          }}
        >
          {t('action.cancel')}
        </button>
      )}
      {stage && <p className={css.meta}>{stage}</p>}
      {error && (
        <p className={css.error} role="alert">
          {error}
        </p>
      )}
      {report !== undefined && (
        <section className={css.section}>
          <h2>{t('diagnostics.report')}</h2>
          <p className={css.meta}>
            {report.ranAt} · {report.baseline.fingerprint.slice(0, 12)} → {report.current.fingerprint.slice(0, 12)}
          </p>
          <button type="button" onClick={downloadReport}>
            {t('diagnostics.download')}
          </button>
          {qualitySection('baseline', report.baselineQuality)}
          {qualitySection('current', report.currentQuality)}
          <h2>{t('diagnostics.metrics')}</h2>
          <div className={css.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>{t('diagnostics.name')}</th>
                  <th>{t('diagnostics.baseline')}</th>
                  <th>{t('diagnostics.current')}</th>
                  <th>{t('diagnostics.delta')}</th>
                  <th>{t('diagnostics.changeRate')}</th>
                </tr>
              </thead>
              <tbody>
                {report.comparison.totals.map(item => (
                  <tr key={item.name}>
                    <td>{item.name}</td>
                    <td>{displayCell(item.baseline, '—')}</td>
                    <td>{displayCell(item.current, '—')}</td>
                    <td>{displayCell(item.delta, '—')}</td>
                    <td>{item.change_rate === null ? '—' : `${(item.change_rate * 100).toFixed(2)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h2>{t('diagnostics.groups')}</h2>
          {groupRows.length > 0 && (
            <svg
              role="img"
              aria-label={t('diagnostics.contributionChart')}
              viewBox={`0 0 720 ${Math.max(70, groupRows.length * 34 + 16)}`}
              width="100%"
              height={Math.max(70, groupRows.length * 34 + 16)}
            >
              {groupRows.map((row, index) => (
                <g key={index}>
                  <title>
                    {row.label}: {row.delta}
                  </title>
                  <text x="8" y={index * 34 + 23} fontSize="12">
                    {row.label.slice(0, 28)}
                  </text>
                  <rect
                    x="240"
                    y={index * 34 + 8}
                    width={Math.round((Math.abs(row.delta) / groupMax) * 330)}
                    height="22"
                    fill={row.delta < 0 ? '#c75550' : '#287e68'}
                  />
                  <text x={250 + Math.round((Math.abs(row.delta) / groupMax) * 330)} y={index * 34 + 23} fontSize="12">
                    {row.delta}
                  </text>
                </g>
              ))}
            </svg>
          )}
          <div className={css.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>{t('diagnostics.group')}</th>
                  {report.comparison.metrics.flatMap(item => [
                    <th key={`${item.name}-delta`}>{item.name} {t('diagnostics.delta')}</th>,
                    <th key={`${item.name}-contribution`}>
                      {item.name} {t('diagnostics.contribution')}
                    </th>,
                  ])}
                </tr>
              </thead>
              <tbody>
                {report.comparison.groups.map((group, index) => (
                  <tr key={index}>
                    <td>{group.dimensions.map(value => displayCell(value, 'NULL')).join(' / ')}</td>
                    {group.metrics.flatMap((item, metricIndex) => [
                      <td key={`${metricIndex}-delta`}>{displayCell(item.delta, '—')}</td>,
                      <td key={`${metricIndex}-contribution`}>
                        {item.contribution_rate === undefined || item.contribution_rate === null
                          ? '—'
                          : `${(item.contribution_rate * 100).toFixed(2)}%`}
                      </td>,
                    ])}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details id={`query-${report.comparison.query_id}`}>
            <summary>
              {t('diagnostics.queryEvidence')} · {report.comparison.query_id}
            </summary>
            <pre>{report.comparison.sql}</pre>
          </details>
        </section>
      )}
    </>
  )
}
