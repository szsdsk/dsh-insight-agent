import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-tools'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  AnalysisResult,
  AnalysisSpec,
  ComparisonResult,
  ComparisonSpec,
  DiagnosticReport,
  DiagnosticTask,
  InsightProject,
  QualityResult,
  RelationList,
  RelationSchema,
  SourceInfo,
  SourceKind,
  TablePreview,
  TableSelection,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    insightController: InsightController
  }
}

const NAMES = {
  register: 'mcp__insight__register_source',
  relations: 'mcp__insight__list_relations',
  describe: 'mcp__insight__describe_relation',
  execute: 'mcp__insight__execute_analysis',
  verify: 'mcp__insight__verify_query',
  result: 'mcp__insight__get_query_result',
  preview: 'mcp__insight__preview_table',
  diagnose: 'mcp__insight__diagnose_table',
  compare: 'mcp__insight__compare_tables',
} as const
interface Verification {
  readonly query_id: string
  readonly valid: boolean
  readonly warnings?: readonly string[]
}

/** Keep the fields transmitted by the Remote codec for report verification. */
function reportSource(source: SourceInfo): SourceInfo {
  return {
    source_id: source.source_id,
    kind: source.kind,
    path: source.path,
    fingerprint: source.fingerprint,
    warnings: source.warnings,
    ...(source.selection === undefined ? {} : { selection: source.selection }),
  }
}

/** Discard MCP-only metadata before returning and retaining a query result. */
function reportQueryFields(result: AnalysisResult): AnalysisResult {
  return {
    query_id: result.query_id,
    source_id: result.source_id,
    source_fingerprint: result.source_fingerprint,
    sql: result.sql,
    columns: result.columns,
    rows: result.rows,
    row_count: result.row_count,
    truncated: result.truncated,
    elapsed_ms: result.elapsed_ms,
    verified: result.verified,
    warnings: result.warnings,
  }
}

/** Session-scoped bridge from the browser workbench to the registered Insight MCP tools. */
export class InsightController extends TypertRemoteService {
  static inject = ['tools', 'attachments', 'fileUploads']
  private readonly active = new Set<string>()
  private readonly diagnosticOutputs = new Map<
    string,
    {
      sources: Map<string, SourceInfo>
      queries: Map<string, { result: QualityResult | ComparisonResult; sourceIds: readonly string[] }>
    }
  >()

  constructor(ctx: Context) {
    super(ctx, 'insightController', { namespace: 'insight' })
    ctx.on('agent/disposed', ({ agent }) => {
      this.diagnosticOutputs.delete(String(agent.id))
    })
  }

  /**
   * Register a data file through the Session's Insight MCP.
   * @param agent - Agent whose workspace and MCP own the source.
   * @param path - Data file path inside that workspace.
   * @param kind - File format to import.
   * @param signal - Cancellation signal for the tool call.
   * @returns Current source identifier, fingerprint, and import warnings.
   */
  @Remote register(agent: Agent, path: string, kind: SourceKind, signal: AbortSignal): Promise<SourceInfo> {
    return this.run(agent, NAMES.register, { path, kind }, signal)
  }
  /** Preview bounded physical rows before selecting a header.
   * @param agent - Agent whose workspace contains the file.
   * @param path - Workspace-relative CSV or workbook path.
   * @param kind - CSV or XLSX format.
   * @param sheet - Optional worksheet name.
   * @param signal - Cancellation signal.
   * @returns Workbook sheet names and the first twelve rows.
   */
  @Remote preview(
    agent: Agent,
    path: string,
    kind: SourceKind,
    sheet: string | null,
    signal: AbortSignal,
  ): Promise<TablePreview> {
    return this.run(agent, NAMES.preview, { path, kind, sheet }, signal)
  }
  /** Register a selected region as one period of a diagnostic task.
   * @param agent - Agent whose MCP owns the source.
   * @param path - Workspace-relative table path.
   * @param kind - CSV or XLSX format.
   * @param selection - Worksheet and physical row selection.
   * @param signal - Cancellation signal.
   * @returns Current source identifier and fingerprint.
   */
  @Remote async registerSelected(
    agent: Agent,
    path: string,
    kind: SourceKind,
    selection: TableSelection,
    signal: AbortSignal,
  ): Promise<SourceInfo> {
    const source = reportSource(await this.run<SourceInfo>(agent, NAMES.register, { path, kind, selection }, signal))
    const sources = this.diagnosticState(agent).sources
    sources.delete(source.source_id)
    sources.set(source.source_id, structuredClone(source))
    if (sources.size > 64) {
      const oldest = sources.keys().next().value
      if (oldest !== undefined) sources.delete(oldest)
    }
    return source
  }
  /** Run one query-backed quality diagnosis and verify its source.
   * @param agent - Idle Agent whose MCP owns the source.
   * @param sourceId - Registered source identifier.
   * @param relation - Selected CSV table or worksheet.
   * @param keys - Optional uniqueness key columns.
   * @param metrics - Numeric columns to inspect.
   * @param signal - Cancellation signal.
   * @returns Quality counts and verified query evidence.
   */
  @Remote async diagnose(
    agent: Agent,
    sourceId: string,
    relation: string,
    keys: string[],
    metrics: string[],
    signal: AbortSignal,
  ): Promise<QualityResult> {
    const value = await this.run<QualityResult>(
      agent,
      NAMES.diagnose,
      { source_id: sourceId, relation, key_columns: keys, metric_columns: metrics },
      signal,
    )
    await this.requireVerified(agent, value.query_id, signal)
    const verified: QualityResult = {
      ...reportQueryFields({ ...value, verified: true, warnings: value.source_warnings }),
      row_total: value.row_total,
      findings: value.findings,
      source_warnings: value.source_warnings,
    }
    this.rememberDiagnosticQuery(agent, verified, [sourceId])
    return verified
  }
  /** Compare two selected periods and verify both source files.
   * @param agent - Idle Agent whose MCP owns the source files.
   * @param spec - Linked fields, metrics, dimensions, and filters.
   * @param signal - Cancellation signal.
   * @returns Query-backed totals and bounded group changes.
   */
  @Remote async compare(agent: Agent, spec: ComparisonSpec, signal: AbortSignal): Promise<ComparisonResult> {
    const value = await this.run<ComparisonResult>(agent, NAMES.compare, { spec }, signal)
    await this.requireVerified(agent, value.query_id, signal)
    const verified: ComparisonResult = {
      ...reportQueryFields({ ...value, verified: true, warnings: [] }),
      totals: value.totals,
      groups: value.groups,
      mapping: value.mapping,
      metrics: value.metrics,
    }
    this.rememberDiagnosticQuery(agent, verified, [spec.baseline.source_id, spec.current.source_id])
    return verified
  }
  /**
   * Copy a browser-uploaded file into this Session's workspace for Insight MCP.
   * @param agent - Agent whose workspace receives the file.
   * @param receiptId - Browser upload receipt for this Agent.
   * @param kind - File format used for the stored extension.
   * @param signal - Cancellation signal for the copy.
   * @returns Workspace-relative path to the stored data file.
   */
  @Remote async storeUpload(agent: Agent, receiptId: string, kind: SourceKind, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted()
    if (!(['csv', 'xlsx', 'sqlite', 'duckdb'] as readonly string[]).includes(kind)) {
      throw new RemoteError('gateway/bad-request', 'Unsupported Insight source format', {})
    }
    const uploads = this.ctx.get('fileUploads') as
      | { resolve(agent: Agent, receiptId: string): FileAttachmentRef | undefined }
      | undefined
    const file = uploads?.resolve(agent, receiptId)
    if (file === undefined) throw new RemoteError('gateway/bad-request', 'The selected file upload is unavailable', {})
    const cwd = agent.session.header.cwd
    if (cwd === undefined) throw new RemoteError('gateway/bad-request', 'This session has no workspace', {})
    const relativePath = `.insight/imports/${randomUUID()}.${kind}`
    const target = join(cwd, relativePath)
    await mkdir(join(cwd, '.insight', 'imports'), { recursive: true })
    try {
      await writeFile(target, this.ctx.attachments.readFileStream(file, signal), { flag: 'wx', signal })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') await rm(target, { force: true }).catch(() => {})
      throw error
    }
    return relativePath
  }
  /**
   * Discover relations in a registered source.
   * @param agent - Agent whose MCP owns the source.
   * @param sourceId - Identifier returned by register in the current MCP runtime.
   * @param signal - Cancellation signal for the tool call.
   * @returns Available relation names and discovery warnings.
   */
  @Remote relations(agent: Agent, sourceId: string, signal: AbortSignal): Promise<RelationList> {
    return this.run(agent, NAMES.relations, { source_id: sourceId }, signal)
  }
  /**
   * Read the schema used to configure a structured analysis.
   * @param agent - Agent whose MCP owns the source.
   * @param sourceId - Current registered source identifier.
   * @param relation - Relation name returned by discovery.
   * @param signal - Cancellation signal for the tool call.
   * @returns Column names, types, nullability, and warnings.
   */
  @Remote describe(agent: Agent, sourceId: string, relation: string, signal: AbortSignal): Promise<RelationSchema> {
    return this.run(agent, NAMES.describe, { source_id: sourceId, relation }, signal)
  }
  /**
   * Execute and verify one analysis; reject overlapping analysis or a busy Agent.
   * @param agent - Idle Agent whose MCP executes and verifies the query.
   * @param sourceId - Current registered source identifier.
   * @param spec - Structured query configuration validated by Insight MCP.
   * @param signal - Cancellation signal shared by execution and verification.
   * @returns Executed rows and query evidence after successful verification.
   */
  @Remote async execute(
    agent: Agent,
    sourceId: string,
    spec: AnalysisSpec,
    signal: AbortSignal,
  ): Promise<AnalysisResult> {
    if (this.active.has(agent.id))
      throw new RemoteError('gateway/bad-request', 'An analysis is already running for this session', {})
    if (agent.status !== 'idle')
      throw new RemoteError(
        'gateway/bad-request',
        'Wait for the current Agent turn to finish before running analysis',
        {},
      )
    this.active.add(agent.id)
    try {
      const result = await this.run<AnalysisResult>(agent, NAMES.execute, { source_id: sourceId, spec }, signal)
      const checked = await this.run<Verification>(agent, NAMES.verify, { query_id: result.query_id }, signal)
      if (!checked.valid) throw new RemoteError('gateway/bad-request', 'Insight query verification failed', {})
      return { ...result, verified: true, warnings: checked.warnings ?? [] }
    } finally {
      this.active.delete(agent.id)
    }
  }
  /**
   * Read a result retained by the current MCP runtime without rerunning SQL.
   * @param agent - Agent whose MCP owns the result.
   * @param queryId - Successful query identifier; historical identifiers may expire.
   * @param signal - Cancellation signal for the tool call.
   * @returns Retained query rows and metadata supplied by Insight MCP.
   */
  @Remote result(agent: Agent, queryId: string, signal: AbortSignal): Promise<AnalysisResult> {
    return this.run(agent, NAMES.result, { query_id: queryId }, signal)
  }
  /**
   * Atomically replace the Session's workspace analysis document.
   * @param agent - Agent whose workspace and id determine the storage path.
   * @param project - Configuration and historical snapshot to persist, not new query evidence.
   */
  @Remote async save(agent: Agent, project: InsightProject): Promise<void> {
    const directory = this.projectDirectory(agent)
    await mkdir(directory, { recursive: true })
    const target = join(directory, 'workbench.json')
    const temporary = `${target}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(project, null, 2)}\n`, 'utf8')
    await rename(temporary, target)
  }
  /**
   * Read saved analysis state without registering data or executing a query.
   * @param agent - Agent whose workspace and id determine the storage path.
   * @returns Saved project, or null when absent; malformed or unsupported files reject.
   */
  @Remote async load(agent: Agent): Promise<InsightProject | null> {
    try {
      const raw = await readFile(join(this.projectDirectory(agent), 'workbench.json'), 'utf8')
      const value: unknown = JSON.parse(raw)
      if (typeof value !== 'object' || value === null || !('formatVersion' in value) || value.formatVersion !== 1) {
        throw new Error('unsupported Insight project format')
      }
      return value as InsightProject
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }
  /** Persist a named diagnostic task without transient source identifiers.
   * @param agent - Agent whose workspace stores the task.
   * @param task - Reusable field and metric configuration.
   */
  @Remote async saveTask(agent: Agent, task: DiagnosticTask): Promise<void> {
    const { columns, metrics, dimensions, filters } = task
    const names = new Set(columns.map(item => item.name))
    const operators = new Set(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'is_null', 'not_null'])
    if (
      typeof task.id !== 'string' ||
      !/^[a-f0-9-]{36}$/iu.test(task.id) ||
      typeof task.name !== 'string' ||
      task.name.trim() === '' ||
      columns.length < 1 ||
      columns.length > 32 ||
      names.size !== columns.length ||
      columns.some(item => typeof item.name !== 'string' || !item.name.trim()) ||
      metrics.length < 1 ||
      metrics.length > 3 ||
      metrics.some(
        item =>
          typeof item.name !== 'string' ||
          !item.name.trim() ||
          (item.aggregation !== 'count' && (item.field === undefined || item.field === null)) ||
          (item.field !== undefined && item.field !== null && !names.has(item.field)),
      ) ||
      dimensions.length > 2 ||
      dimensions.some(item => !names.has(item)) ||
      filters.length > 8 ||
      filters.some(
        item =>
          !names.has(item.field) ||
          !operators.has(item.operator) ||
          (!['is_null', 'not_null'].includes(item.operator) &&
            (item.value === undefined ||
              item.value === null ||
              !['string', 'number', 'boolean'].includes(typeof item.value) ||
              (typeof item.value === 'number' && !Number.isFinite(item.value)))),
      ) ||
      !Number.isSafeInteger(task.top_n) ||
      task.top_n < 1 ||
      task.top_n > 50
    ) {
      throw new RemoteError('gateway/bad-request', 'Invalid diagnostic task', {})
    }
    await this.writeDocument(join(this.diagnosticsDirectory(agent), 'tasks'), task.id, task)
  }
  /** List saved named tasks from the current workspace.
   * @param agent - Agent whose workspace stores the tasks.
   * @returns Task definitions in filename order.
   */
  @Remote async listTasks(agent: Agent): Promise<DiagnosticTask[]> {
    const directory = join(this.diagnosticsDirectory(agent), 'tasks')
    let files: string[]
    try {
      files = await readdir(directory)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const tasks: DiagnosticTask[] = []
    for (const file of files.filter(item => /^[a-f0-9-]{36}\.json$/iu.test(item)).sort()) {
      const value: unknown = JSON.parse(await readFile(join(directory, file), 'utf8'))
      if (typeof value !== 'object' || value === null || !('formatVersion' in value) || value.formatVersion !== 1) {
        throw new Error(`unsupported diagnostic task format: ${file}`)
      }
      tasks.push(value as DiagnosticTask)
    }
    return tasks
  }
  /** Save an immutable report only from this Session's issued and reverified results.
   * @param agent - Agent whose workspace receives the report.
   * @param report - Historical report with file fingerprints and query results.
   * @param signal - Cancellation signal for source verification.
   */
  @Remote async saveReport(agent: Agent, report: DiagnosticReport, signal: AbortSignal): Promise<void> {
    if (!/^[a-f0-9-]{36}$/iu.test(report.id)) {
      throw new RemoteError('gateway/bad-request', 'Invalid diagnostic report', {})
    }
    for (const queryId of [
      report.baselineQuality.query_id,
      report.currentQuality.query_id,
      report.comparison.query_id,
      ...(report.dimensionBreakdowns ?? []).map(item => item.query_id),
    ]) {
      await this.requireVerified(agent, queryId, signal)
    }
    const issued = this.diagnosticState(agent)
    const matchesSource = (source: SourceInfo) => isDeepStrictEqual(issued.sources.get(source.source_id), source)
    const matchesQuery = (query: QualityResult | ComparisonResult, sourceIds: readonly string[]) => {
      const retained = issued.queries.get(query.query_id)
      return (
        retained !== undefined &&
        isDeepStrictEqual(retained.result, query) &&
        isDeepStrictEqual(retained.sourceIds, sourceIds)
      )
    }
    if (
      !matchesSource(report.baseline) ||
      !matchesSource(report.current) ||
      report.baselineQuality.source_fingerprint !== report.baseline.fingerprint ||
      report.currentQuality.source_fingerprint !== report.current.fingerprint ||
      !matchesQuery(report.baselineQuality, [report.baseline.source_id]) ||
      !matchesQuery(report.currentQuality, [report.current.source_id]) ||
      !matchesQuery(report.comparison, [report.baseline.source_id, report.current.source_id]) ||
      (report.dimensionBreakdowns ?? []).some(
        item => !matchesQuery(item, [report.baseline.source_id, report.current.source_id]),
      )
    ) {
      throw new RemoteError('gateway/bad-request', 'Diagnostic report differs from verified Session results', {})
    }
    signal.throwIfAborted()
    await this.writeDocument(join(this.diagnosticsDirectory(agent), 'reports'), report.id, report, signal)
  }
  private diagnosticState(agent: Agent): {
    sources: Map<string, SourceInfo>
    queries: Map<string, { result: QualityResult | ComparisonResult; sourceIds: readonly string[] }>
  } {
    const session = String(agent.id)
    let state = this.diagnosticOutputs.get(session)
    if (state === undefined) {
      state = { sources: new Map(), queries: new Map() }
      this.diagnosticOutputs.set(session, state)
    }
    return state
  }
  private rememberDiagnosticQuery(
    agent: Agent,
    result: QualityResult | ComparisonResult,
    sourceIds: readonly string[],
  ): void {
    const queries = this.diagnosticState(agent).queries
    queries.delete(result.query_id)
    queries.set(result.query_id, { result: structuredClone(result), sourceIds: [...sourceIds] })
    if (queries.size > 64) {
      const oldest = queries.keys().next().value
      if (oldest !== undefined) queries.delete(oldest)
    }
  }
  private diagnosticsDirectory(agent: Agent): string {
    const cwd = agent.session.header.cwd
    if (cwd === undefined) throw new RemoteError('gateway/bad-request', 'This session has no workspace', {})
    return join(cwd, '.insight', 'diagnostics')
  }
  private async writeDocument(directory: string, id: string, value: unknown, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    await mkdir(directory, { recursive: true })
    const target = join(directory, `${id}.json`)
    const temporary = `${target}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', signal })
      signal?.throwIfAborted()
      await rename(temporary, target)
    } finally {
      await rm(temporary, { force: true })
    }
  }
  private async requireVerified(agent: Agent, queryId: string, signal: AbortSignal): Promise<void> {
    const checked = await this.run<Verification>(agent, NAMES.verify, { query_id: queryId }, signal)
    if (!checked.valid || checked.query_id !== queryId)
      throw new RemoteError('gateway/bad-request', 'Insight query verification failed', {})
  }
  private projectDirectory(agent: Agent): string {
    const cwd = agent.session.header.cwd
    if (cwd === undefined) throw new RemoteError('gateway/bad-request', 'This session has no workspace', {})
    return join(cwd, '.insight', agent.id.replace(/[^a-zA-Z0-9_-]/gu, '_'))
  }
  private async run<Value>(agent: Agent, name: string, args: unknown, signal: AbortSignal): Promise<Value> {
    const result = await this.ctx.tools.execute({
      name,
      arguments: args,
      agent,
      signal,
      callId: ToolCallId(`insight-ui-${randomUUID()}`),
    })
    if (result.isError) {
      const message = result.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('\n')
      throw new RemoteError('gateway/bad-request', message || `${name} failed`, {})
    }
    const payload = result.value as { structuredContent?: Value } | null
    if (payload?.structuredContent === undefined) {
      throw new RemoteError('gateway/bad-request', `${name} returned no structured content`, {})
    }
    return payload.structuredContent
  }
}

export default InsightController
