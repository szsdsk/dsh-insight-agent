import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-tools'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { AnalysisResult, AnalysisSpec, InsightProject, RelationList, RelationSchema, SourceInfo, SourceKind } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' { interface Context { insightController: InsightController } }

const NAMES = {
  register: 'mcp__insight__register_source', relations: 'mcp__insight__list_relations', describe: 'mcp__insight__describe_relation',
  execute: 'mcp__insight__execute_analysis', verify: 'mcp__insight__verify_query', result: 'mcp__insight__get_query_result',
} as const
interface Verification { readonly query_id: string; readonly valid: boolean; readonly warnings?: readonly string[] }

/** Session-scoped bridge from the browser workbench to the registered Insight MCP tools. */
export class InsightController extends TypertRemoteService {
  static inject = ['tools', 'attachments', 'fileUploads']
  private readonly active = new Set<string>()

  constructor(ctx: Context) { super(ctx, 'insightController', { namespace: 'insight' }) }

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
    const uploads = this.ctx.get('fileUploads') as { resolve(agent: Agent, receiptId: string): FileAttachmentRef | undefined } | undefined
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
  @Remote async execute(agent: Agent, sourceId: string, spec: AnalysisSpec, signal: AbortSignal): Promise<AnalysisResult> {
    if (this.active.has(agent.id)) throw new RemoteError('gateway/bad-request', 'An analysis is already running for this session', {})
    if (agent.status !== 'idle') throw new RemoteError('gateway/bad-request', 'Wait for the current Agent turn to finish before running analysis', {})
    this.active.add(agent.id)
    try {
      const result = await this.run<AnalysisResult>(agent, NAMES.execute, { source_id: sourceId, spec }, signal)
      const checked = await this.run<Verification>(agent, NAMES.verify, { query_id: result.query_id }, signal)
      if (!checked.valid) throw new RemoteError('gateway/bad-request', 'Insight query verification failed', {})
      return { ...result, verified: true, warnings: checked.warnings ?? [] }
    } finally { this.active.delete(agent.id) }
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
  private projectDirectory(agent: Agent): string {
    const cwd = agent.session.header.cwd
    if (cwd === undefined) throw new RemoteError('gateway/bad-request', 'This session has no workspace', {})
    return join(cwd, '.insight', agent.id.replace(/[^a-zA-Z0-9_-]/gu, '_'))
  }
  private async run<Value>(agent: Agent, name: string, args: unknown, signal: AbortSignal): Promise<Value> {
    const result = await this.ctx.tools.execute({ name, arguments: args, agent, signal, callId: ToolCallId(`insight-ui-${randomUUID()}`) })
    if (result.isError) {
      const message = result.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
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
