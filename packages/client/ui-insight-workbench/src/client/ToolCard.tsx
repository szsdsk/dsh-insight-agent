import type { ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import css from './ToolCard.module.css'

export interface ToolCardInjected { open(this: void): void }

function outputOf(block: ToolCallViewProps['block']): string {
  if (!('kind' in block)) return ''
  return block.content.filter(item => item.type === 'text').map(item => item.text).join('\n')
}

export function ToolCard(
  { toolName, block, open, t }: ToolCallViewProps & PropsLocale<'insightWorkbench'> & ToolCardInjected,
): ReactNode {
  const output = outputOf(block)
  const query = /"query_id"\s*:\s*"([^"]+)"/u.exec(output)?.[1]
  return <div className={css.card} data-state={'kind' in block ? block.isError ? 'error' : 'ok' : 'running'}>
    <div>
      <strong>{toolName === 'mcp__insight__submit_analysis' ? t('tool.analysis') : t('tool.query')}</strong>
      {query !== undefined && <span>{query}</span>}
    </div>
    <button type="button" onClick={open}>{t('action.open')}</button>
    {output !== '' && <details><summary>{t('result.sql')}</summary><pre>{output}</pre></details>}
  </div>
}
