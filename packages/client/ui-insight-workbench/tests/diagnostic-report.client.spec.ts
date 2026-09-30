import { expect, it } from 'vitest'
import { diagnosticHtml } from '../src/client/diagnostic-report.ts'
import type { DiagnosticReport } from '@deepseek-ai/dsh-api-insight-controller/types'

it('escapes uploaded cells and emits a script-free offline chart', () => {
  const source = { source_id: 'a', kind: 'csv' as const, path: '<file>.csv', fingerprint: 'abc', warnings: [] }
  const quality = { query_id: 'q1', source_id: 'a', source_fingerprint: 'abc', sql: 'SELECT <script>', columns: ['rows'], rows: [[1]], row_count: 1,
    truncated: false, elapsed_ms: 1, verified: true, warnings: [], row_total: 1, findings: [
      { kind: 'missing', field: '<script>alert(1)</script>', count: 1, rate: 1, query_id: 'q1' },
      { kind: 'formula_cache_missing', count: 1, rate: 1 },
    ], source_warnings: [] }
  const report: DiagnosticReport = { formatVersion: 1, id: 'r1', taskId: 't1', ranAt: '2026-09-27', baseline: source, current: source,
    baselineQuality: quality, currentQuality: quality,
    comparison: { ...quality, query_id: 'q2', totals: [{ name: '<b>cost</b>', baseline: 1, current: 2, delta: 1, change_rate: 1 }],
      metrics: [{ name: 'cost', aggregation: 'sum', field: 'cost' }], mapping: [], groups: [{ dimensions: ['<img src=x>'], metrics: [{ baseline: 1, current: 2, delta: 1, change_rate: 1 }] }] } }
  const html = diagnosticHtml(report)
  expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  expect(html).toContain('data:image/svg+xml,')
  expect(html).toContain('Classification')
  expect(html).toContain('href="#query-q1"')
  expect(html).toContain('<td>Source warning</td>')
  expect(html).toContain('SELECT &lt;script&gt;')
  expect(html).toContain('contribution')
  expect(html).not.toContain('<script>')
  expect(html).not.toContain('<img src=x>')
})
