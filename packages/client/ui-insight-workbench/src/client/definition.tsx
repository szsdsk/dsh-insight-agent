import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'

export const INSIGHT_KIND = 'insight'
export const INSIGHT_ID = '@deepseek-ai/dsh-client-ui-insight-workbench'

export function insightDefinition(t: TranslateNS<'insightWorkbench'>): SidebarRightTabDefinition {
  return { id: INSIGHT_ID, kind: INSIGHT_KIND, priority: 'extension', title: () => t('type.label'), guide: [{ id: 'workbench', order: 5, title: () => t('guide.title'), description: () => t('guide.description') }] }
}
