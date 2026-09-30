import type { DiagnosticReport } from '@deepseek-ai/dsh-api-insight-controller/types'

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
    const rows = findings.findings.map(item => `<tr><td>${escapeHtml(item.kind)}</td><td>${escapeHtml(item.field ?? item.fields?.join(', ') ?? '')}</td><td>${escapeHtml(item.classification ?? 'observation')}</td><td>${item.count}</td><td>${(item.rate * 100).toFixed(2)}%</td><td>${item.query_id ? `<a href="#query-${escapeHtml(findings.query_id)}">${escapeHtml(item.query_id)}</a>` : 'Source warning'}</td></tr>`).join('')
    return `<section><h2>${escapeHtml(title)}</h2><p>Rows: ${findings.row_total}</p><table><thead><tr><th>Finding</th><th>Field</th><th>Classification</th><th>Count</th><th>Share</th><th>Evidence</th></tr></thead><tbody>${rows}</tbody></table>${findings.source_warnings.map(item => `<p class="warning">${escapeHtml(item)}</p>`).join('')}<details id="query-${escapeHtml(findings.query_id)}"><summary>Quality query evidence · ${escapeHtml(findings.query_id)}</summary><pre>${escapeHtml(findings.sql)}</pre></details></section>`
  }
  const breakdowns = (report.dimensionBreakdowns ?? []).map(result => `<section><h2>${escapeHtml(result.mapping.find(item => item.name === result.columns[1])?.name ?? result.columns[1] ?? 'Dimension')} change</h2><p class="meta">Verified query: ${escapeHtml(result.query_id)}</p><table><thead><tr><th>Group</th><th>Change</th><th>Contribution</th></tr></thead><tbody>${result.groups.map(group => `<tr><td>${escapeHtml(group.dimensions.map(metric).join(' / '))}</td><td>${escapeHtml(metric(group.metrics[0]?.delta))}</td><td>${group.metrics[0]?.contribution_rate === null || group.metrics[0]?.contribution_rate === undefined ? '—' : `${(group.metrics[0].contribution_rate * 100).toFixed(2)}%`}</td></tr>`).join('')}</tbody></table></section>`).join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>Insight diagnostic report</title><style>body{font:14px/1.5 system-ui,sans-serif;max-width:1000px;margin:36px auto;padding:0 20px;color:#243247}h1{font-size:26px}h2{font-size:18px;margin-top:30px}table{border-collapse:collapse;width:100%}th,td{padding:8px;border-bottom:1px solid #d9dee7;text-align:left}th{background:#f4f6f9}.meta{color:#596b80;overflow-wrap:anywhere}.warning{color:#a05d00}img{max-width:100%}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f6f9;padding:12px}</style></head><body><h1>Insight diagnostic report</h1><p class="meta">Run: ${escapeHtml(report.ranAt)} · Report: ${escapeHtml(report.id)}</p><p class="meta">Baseline: ${escapeHtml(report.baseline.path)} (${escapeHtml(report.baseline.fingerprint)})<br>Current: ${escapeHtml(report.current.path)} (${escapeHtml(report.current.fingerprint)})</p>${quality('Baseline data quality', report.baselineQuality)}${quality('Current data quality', report.currentQuality)}<section><h2>Metric comparison</h2><p class="meta">Verified query: ${escapeHtml(report.comparison.query_id)}</p><table><thead><tr><th>Metric</th><th>Baseline</th><th>Current</th><th>Change</th><th>Change rate</th></tr></thead><tbody>${report.comparison.totals.map(item => `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(metric(item.baseline))}</td><td>${escapeHtml(metric(item.current))}</td><td>${escapeHtml(metric(item.delta))}</td><td>${item.change_rate === null ? '—' : `${(item.change_rate * 100).toFixed(2)}%`}</td></tr>`).join('')}</tbody></table></section><section><h2>Group changes</h2><img alt="Change by group" src="data:image/svg+xml,${encodeURIComponent(svg)}"><table><thead><tr><th>Group</th>${report.comparison.metrics.flatMap(item => [`<th>${escapeHtml(item.name)} change</th>`, `<th>${escapeHtml(item.name)} contribution</th>`]).join('')}</tr></thead><tbody>${report.comparison.groups.map(group => `<tr><td>${escapeHtml(group.dimensions.map(metric).join(' / '))}</td>${group.metrics.flatMap(item => [`<td>${escapeHtml(metric(item.delta))}</td>`, `<td>${item.contribution_rate === null || item.contribution_rate === undefined ? '—' : `${(item.contribution_rate * 100).toFixed(2)}%`}</td>`]).join('')}</tr>`).join('')}</tbody></table></section>${breakdowns}<section id="query-${escapeHtml(report.comparison.query_id)}"><h2>Query evidence</h2><p class="meta">Quality and comparison values come from the recorded queries. Business causes require separate validation.</p><pre>${escapeHtml(report.comparison.sql)}</pre></section></body></html>`
}
