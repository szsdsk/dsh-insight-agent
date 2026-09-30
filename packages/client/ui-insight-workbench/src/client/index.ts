import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-insight-controller/remote'
import type {} from '@deepseek-ai/dsh-client-file-upload/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type { AnalysisSpec, ComparisonSpec, DiagnosticReport, DiagnosticTask, InsightProject, SourceKind, TableSelection } from '@deepseek-ai/dsh-api-insight-controller/types'
import { INSIGHT_ID, insightDefinition } from './definition.tsx'
import { HeaderAction, type HeaderActionInjected } from './HeaderAction.tsx'
import { en, zh } from './locales.ts'
import { ToolCard, type ToolCardInjected } from './ToolCard.tsx'
import { InsightTitle } from './Title.tsx'
import { Workbench, type InsightInjected } from './Workbench.tsx'

export const inject = ['slots', 'locale', 'sessions', 'sidebarRight', 'sidebarRightTabs', 'remote', 'remote.insight', 'fileUpload']
const NS = 'insightWorkbench'

function unwrap<Value>(result: { readonly ok: true; readonly value: Value } | { readonly ok: false; readonly error: unknown }): Value {
  if (!result.ok) throw result.error
  return result.value
}

/** Register the workbench page, Session header entry, and Insight tool cards. */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-insight-workbench: dictionaries')
  ctx.effect(() => ctx.sidebarRightTabs.register(insightDefinition(t)), 'ui-insight-workbench: tab type')

  ctx.effect(() => ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions', id: INSIGHT_ID, order: 10, locale: NS,
    inject: (sessionId: SessionId): HeaderActionInjected => ({
      open: () => { ctx.sidebarRight.openTabIn(sessionId, 'insight') },
    }),
  }, HeaderAction)), 'ui-insight-workbench: header action')

  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: INSIGHT_ID, locale: NS,
    inject: (sessionId: SessionId): InsightInjected => ({
      upload: async (file: File, kind: SourceKind, signal: AbortSignal) => {
        const uploaded = unwrap(await ctx.fileUpload.upload(sessionId, file, file.name, signal))
        return unwrap(await ctx.remote.insight.storeUpload(sessionId, uploaded.receiptId, kind, signal))
      },
      register: async (path: string, kind: SourceKind, signal: AbortSignal) => (
        unwrap(await ctx.remote.insight.register(sessionId, path, kind, signal))
      ),
      preview: async (path: string, kind: SourceKind, sheet: string | null, signal: AbortSignal) => (
        unwrap(await ctx.remote.insight.preview(sessionId, path, kind, sheet, signal))
      ),
      registerSelected: async (path: string, kind: SourceKind, selection: TableSelection, signal: AbortSignal) => (
        unwrap(await ctx.remote.insight.registerSelected(sessionId, path, kind, selection, signal))
      ),
      diagnose: async (sourceId: string, relation: string, keys: string[], metrics: string[], signal: AbortSignal) => (
        unwrap(await ctx.remote.insight.diagnose(sessionId, sourceId, relation, keys, metrics, signal))
      ),
      compare: async (spec: ComparisonSpec, signal: AbortSignal) => (
        unwrap(await ctx.remote.insight.compare(sessionId, spec, signal))
      ),
      saveTask: async (task: DiagnosticTask) => { unwrap(await ctx.remote.insight.saveTask(sessionId, task)) },
      listTasks: async () => unwrap(await ctx.remote.insight.listTasks(sessionId)),
      saveReport: async (report: DiagnosticReport, signal: AbortSignal) => {
        unwrap(await ctx.remote.insight.saveReport(sessionId, report, signal))
      },
      relations: async (sourceId: string, signal: AbortSignal) => (
        unwrap(await ctx.remote.insight.relations(sessionId, sourceId, signal))
      ),
      describe: async (sourceId: string, relation: string, signal: AbortSignal) => (
        unwrap(await ctx.remote.insight.describe(sessionId, sourceId, relation, signal))
      ),
      execute: async (sourceId: string, spec: AnalysisSpec, signal: AbortSignal) => (
        unwrap(await ctx.remote.insight.execute(sessionId, sourceId, spec, signal))
      ),
      save: async (project: InsightProject) => { unwrap(await ctx.remote.insight.save(sessionId, project)) },
      load: async () => unwrap(await ctx.remote.insight.load(sessionId)),
      explain: async (queryId: string) => {
        const session = ctx.sessions.binding(sessionId)?.session
        if (session === undefined) throw new Error('Session is unavailable')
        const text = `${t('action.explainPromptPrefix')} ${queryId}${t('action.explainPromptSuffix')}`
        const result = await session.prompt([{ type: 'text', text }], 'queue')
        if (!result.ok) throw result.error
      },
    }),
  }, Workbench)), 'ui-insight-workbench: tab body')

  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab.title', key: INSIGHT_ID,
  }, InsightTitle)), 'ui-insight-workbench: tab title')

  for (const toolName of ['mcp__insight__execute_analysis', 'mcp__insight__diagnose_table', 'mcp__insight__compare_tables', 'mcp__insight__verify_query', 'submit_analysis']) {
    ctx.effect(() => ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
      name: 'tool.call.toolview', key: toolName, locale: NS,
      inject: (sessionId: SessionId): ToolCardInjected => ({
        open: () => { ctx.sidebarRight.openTabIn(sessionId, 'insight') },
      }),
    }, ToolCard)), `ui-insight-workbench: ${toolName} card`)
  }
}
