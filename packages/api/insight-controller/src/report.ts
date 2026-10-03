/** Script-free offline reports shared by Host task tools and the browser workbench. */
import type { DiagnosticNarrative, DiagnosticReport } from './types.ts'

/** Read accepted submit_analysis JSON without carrying unrelated execution metadata into a report.
 * @param value - Tool result received at the JSON boundary; acceptance and query ownership are checked by the caller.
 * @returns Narrative fields, rejecting incomplete text, evidence, or numerical fact records.
 */
export function parseDiagnosticNarrative(value: unknown): DiagnosticNarrative {
  const object = (value: unknown): Record<string, unknown> => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('narrative requires an object')
    return value as Record<string, unknown>
  }
  const text = (value: unknown): string => {
    if (typeof value !== 'string') throw new Error('narrative text must be a string')
    return value
  }
  const texts = (value: unknown): string[] => {
    if (!Array.isArray(value)) throw new Error('narrative notes must be arrays')
    return value.map(text)
  }
  const row = object(value)
  if (!Array.isArray(row.evidence) || !Array.isArray(row.facts)) throw new Error('narrative requires evidence and numerical facts')
  return {
    answer: text(row.answer), assumptions: texts(row.assumptions), limitations: texts(row.limitations),
    hypotheses: texts(row.hypotheses ?? []),
    evidence: row.evidence.map((value) => {
      const item = object(value)
      return { query_id: text(item.query_id), claim: text(item.claim) }
    }),
    facts: row.facts.map((value) => {
      const fact = object(value)
      if (!Number.isSafeInteger(fact.row) || Number(fact.row) < 0 ||
        (typeof fact.value !== 'string' && (typeof fact.value !== 'number' || !Number.isFinite(fact.value)))) {
        throw new Error('narrative fact requires a row index and finite numerical value')
      }
      return { name: text(fact.name), query_id: text(fact.query_id), row: Number(fact.row), column: text(fact.column), value: fact.value }
    }),
  }
}

/** Format a JSON result cell for a table or escaped HTML.
 * @param value - Cell value from a query result.
 * @param empty - Text shown for a null cell.
 * @returns Readable primitive or JSON text.
 */
export function displayCell(value: unknown, empty = ''): string {
  if (value === null || value === undefined) return empty
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return `${value}`
  if (typeof value === 'object') return JSON.stringify(value)
  return empty
}

function escapeHtml(value: unknown): string {
  return displayCell(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

function metric(value: unknown): string { return displayCell(value, '—') }

/** Render a self-contained, script-free historical diagnostic report.
 * @param report - Verified query outputs and exact file fingerprints.
 * @returns Offline HTML with escaped source text and an embedded SVG chart.
 */
export function diagnosticHtml(report: DiagnosticReport): string {
  const rows = report.comparison.groups.map(group => ({
    label: group.dimensions.map(metric).join(' / '),
    change: group.metrics[0]?.delta ?? 0,
  }))
  const max = Math.max(1, ...rows.map(row => Math.abs(row.change)))
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="${Math.max(70, rows.length * 34 + 16)}" viewBox="0 0 720 ${Math.max(70, rows.length * 34 + 16)}"><rect width="100%" height="100%" fill="#fff"/>${rows.map((row, index) => `<text x="8" y="${index * 34 + 23}" font-size="12" fill="#243247">${escapeHtml(row.label.slice(0, 28))}</text><rect x="240" y="${index * 34 + 8}" width="${Math.round(Math.abs(row.change) / max * 330)}" height="22" fill="${row.change < 0 ? '#c75550' : '#287e68'}"/><text x="${250 + Math.round(Math.abs(row.change) / max * 330)}" y="${index * 34 + 23}" font-size="12" fill="#243247">${escapeHtml(row.change)}</text>`).join('')}</svg>`
  const quality = (title: string, findings: DiagnosticReport['baselineQuality']) => {
    const rows = findings.findings.map((item) => {
      const samples = (item.samples ?? []).map(sample => `<p>${escapeHtml(sample.sheet ? `${sample.sheet}!` : '')}${escapeHtml(sample.cells?.join(', ') ?? `${sample.source_row === undefined ? 'Selected row' : 'Source row / CSV record'} ${sample.source_row ?? sample.table_row}`)} · ${escapeHtml(Object.entries(sample.values).map(([field, value]) => `${field}: ${metric(value)}`).join(', '))}${sample.values_truncated ? ' (values shortened)' : ''}</p>`).join('')
      return `<tr><td>${escapeHtml(item.kind)}</td><td>${escapeHtml(item.field ?? item.fields?.join(', ') ?? '')}</td><td>${escapeHtml(item.classification ?? 'observation')}</td><td>${item.count}</td><td>${(item.rate * 100).toFixed(2)}%</td><td>${samples}</td><td>${item.query_id ? `<a href="#query-${escapeHtml(findings.query_id)}">${escapeHtml(item.query_id)}</a>` : 'Source warning'}</td></tr>`
    }).join('')
    return `<section><h2>${escapeHtml(title)}</h2><p>Rows: ${findings.row_total}</p><table><thead><tr><th>Finding</th><th>Field</th><th>Classification</th><th>Count</th><th>Share</th><th>Location examples</th><th>Evidence</th></tr></thead><tbody>${rows}</tbody></table>${findings.source_warnings.map(item => `<p class="warning">${escapeHtml(item)}</p>`).join('')}<details id="query-${escapeHtml(findings.query_id)}"><summary>Quality query evidence · ${escapeHtml(findings.query_id)}</summary><pre>${escapeHtml(findings.sql)}</pre></details></section>`
  }
  const breakdowns = (report.dimensionBreakdowns ?? []).map((result) => {
    const label = result.groups.length === 0 ? 'Selected cohort' : result.columns[1] ?? 'Dimension'
    const totals = result.totals.map(item => `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(metric(item.baseline))}</td><td>${escapeHtml(metric(item.current))}</td><td>${escapeHtml(metric(item.delta))}</td></tr>`).join('')
    const groups = result.groups.map(group => `<tr><td>${escapeHtml(group.dimensions.map(metric).join(' / '))}</td><td>${escapeHtml(metric(group.metrics[0]?.delta))}</td><td>${group.metrics[0]?.contribution_rate === null || group.metrics[0]?.contribution_rate === undefined ? '—' : `${(group.metrics[0].contribution_rate * 100).toFixed(2)}%`}</td></tr>`).join('')
    return `<section><h2>${escapeHtml(label)} change</h2><p class="meta">Verified query: ${escapeHtml(result.query_id)}</p><table><thead><tr><th>Metric</th><th>Baseline</th><th>Current</th><th>Change</th></tr></thead><tbody>${totals}</tbody></table><table><thead><tr><th>Group</th><th>Change</th><th>Contribution</th></tr></thead><tbody>${groups}</tbody></table><details id="query-${escapeHtml(result.query_id)}"><summary>Selected cohort and query evidence</summary><pre>${escapeHtml(result.sql)}</pre></details></section>`
  }).join('')
  const analysis = report.narrative
  const paragraphs = (title: string, values: readonly string[]) => values.length === 0 ? ''
    : `<section><h2>${title}</h2>${values.map(value => `<p>${escapeHtml(value)}</p>`).join('')}</section>`
  const narrative = analysis === undefined ? '' : `<section><h2>Retrospective</h2><p style="white-space:pre-wrap">${escapeHtml(analysis.answer)}</p>${analysis.evidence.map(item => `<p><a href="#query-${escapeHtml(item.query_id)}">${escapeHtml(item.query_id)}</a> · ${escapeHtml(item.claim)}</p>`).join('')}<h3>Verified numerical facts</h3><table><thead><tr><th>Fact</th><th>Value</th><th>Query cell (zero-based row)</th></tr></thead><tbody>${analysis.facts.map(fact => `<tr><td>${escapeHtml(fact.name)}</td><td>${escapeHtml(fact.value)}</td><td>${escapeHtml(fact.query_id)} · ${fact.row} · ${escapeHtml(fact.column)}</td></tr>`).join('')}</tbody></table></section>${paragraphs('Assumptions', analysis.assumptions)}${paragraphs('Limitations', analysis.limitations)}${paragraphs('Business hypotheses — require validation', analysis.hypotheses ?? [])}`
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>Insight diagnostic report</title><style>body{font:14px/1.5 system-ui,sans-serif;max-width:1000px;margin:36px auto;padding:0 20px;color:#243247}h1{font-size:26px}h2{font-size:18px;margin-top:30px}table{border-collapse:collapse;width:100%}th,td{padding:8px;border-bottom:1px solid #d9dee7;text-align:left}th{background:#f4f6f9}.meta{color:#596b80;overflow-wrap:anywhere}.warning{color:#a05d00}img{max-width:100%}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f6f9;padding:12px}</style></head><body><h1>Insight diagnostic report</h1><p class="meta">Run: ${escapeHtml(report.ranAt)} · Report: ${escapeHtml(report.id)}</p><p class="meta">Baseline: ${escapeHtml(report.baseline.path)} (${escapeHtml(report.baseline.fingerprint)})<br>Current: ${escapeHtml(report.current.path)} (${escapeHtml(report.current.fingerprint)})</p>${narrative}${quality('Baseline data quality', report.baselineQuality)}${quality('Current data quality', report.currentQuality)}<section><h2>Metric comparison</h2><p class="meta">Verified query: ${escapeHtml(report.comparison.query_id)}</p><table><thead><tr><th>Metric</th><th>Baseline</th><th>Current</th><th>Change</th><th>Change rate</th></tr></thead><tbody>${report.comparison.totals.map(item => `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(metric(item.baseline))}</td><td>${escapeHtml(metric(item.current))}</td><td>${escapeHtml(metric(item.delta))}</td><td>${item.change_rate === null ? '—' : `${(item.change_rate * 100).toFixed(2)}%`}</td></tr>`).join('')}</tbody></table></section><section><h2>Group changes</h2><img alt="Change by group" src="data:image/svg+xml,${encodeURIComponent(svg)}"><table><thead><tr><th>Group</th>${report.comparison.metrics.flatMap(item => [`<th>${escapeHtml(item.name)} change</th>`, `<th>${escapeHtml(item.name)} contribution</th>`]).join('')}</tr></thead><tbody>${report.comparison.groups.map(group => `<tr><td>${escapeHtml(group.dimensions.map(metric).join(' / '))}</td>${group.metrics.flatMap(item => [`<td>${escapeHtml(metric(item.delta))}</td>`, `<td>${item.contribution_rate === null || item.contribution_rate === undefined ? '—' : `${(item.contribution_rate * 100).toFixed(2)}%`}</td>`]).join('')}</tr>`).join('')}</tbody></table></section>${breakdowns}<section id="query-${escapeHtml(report.comparison.query_id)}"><h2>Query evidence</h2><p class="meta">Quality and comparison values come from the recorded queries. Business causes require separate validation.</p><pre>${escapeHtml(report.comparison.sql)}</pre></section></body></html>`
}
