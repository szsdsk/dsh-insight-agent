/** Regenerate the offline expense example from verified office fixture queries. */
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { DiagnosticReport } from '../../packages/api/insight-controller/src/types.ts'
import { diagnosticHtml } from '../../packages/client/ui-insight-workbench/src/client/diagnostic-report.ts'

const root = resolve(import.meta.dirname, '../..')
const python = process.env.INSIGHT_AGENT_PYTHON ?? 'python'
const output = execFileSync(python, [resolve(import.meta.dirname, 'example_report.py')], {
  cwd: root, encoding: 'utf8', env: { ...process.env, PYTHONPATH: resolve(root, 'python/insight-mcp/src') },
})
const value: unknown = JSON.parse(output)
if (typeof value !== 'object' || value === null || !('formatVersion' in value) || value.formatVersion !== 1
  || !('comparison' in value) || !('baselineQuality' in value) || !('currentQuality' in value)) {
  throw new Error('example report payload is incomplete')
}
const directory = resolve(root, 'evals/examples')
await mkdir(directory, { recursive: true })
await writeFile(resolve(directory, 'expense-diagnostic.html'), diagnosticHtml(value as DiagnosticReport) + '\n', 'utf8')
