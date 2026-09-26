import type { ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

export interface HeaderActionInjected { open(this: void): void }

export function HeaderAction(
  { open, t }: PropsRuntime<'conversation.session.header.actions'> & PropsLocale<'insightWorkbench'> & HeaderActionInjected,
): ReactNode {
  return <button type="button" title={t('header.open')} aria-label={t('header.open')} onClick={open}>{t('type.label')}</button>
}
