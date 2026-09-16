import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import YAML from 'yaml'

const root = resolve(import.meta.dirname, '..')
const preset = YAML.parse(await readFile(resolve(root, 'preset.yml'), 'utf8')) as {
  name?: string
}
const raw = await readFile(resolve(root, 'agent.cordis.yml'), 'utf8')
const yamlWithoutExecutableTags = raw.replace(
  /!!js ([^\r\n]+)/g,
  (_match, expression: string) => JSON.stringify(expression.trim()),
)
const composition = YAML.parse(
  yamlWithoutExecutableTags,
) as Array<{ id?: string; name?: string; config?: unknown }>
const headless = YAML.parse(
  await readFile(resolve(root, 'evals/headless/cordis.patch.template.yml'), 'utf8'),
) as Array<{ id?: string; config?: unknown }>

const requiredRows = new Set([
  'persona',
  'tool-pwsh',
  'tool-fs',
  'skill-filesystem',
  'tool-skill',
  'tool-goal',
  'planning',
  'compaction',
  'delegation',
  'tool-workflow',
  'insight-evidence',
  'insight-data',
])
const ids = new Set<string>()
const visit = (rows: unknown): void => {
  if (!Array.isArray(rows)) return
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue
    const item = row as { id?: string; config?: unknown }
    if (item.id !== undefined) ids.add(item.id)
    visit(item.config)
  }
}
visit(composition)

const missing = [...requiredRows].filter((id) => !ids.has(id))
if (preset.name !== 'InsightAgent') throw new Error('preset.yml name must be InsightAgent')
if (missing.length > 0) throw new Error(`agent.cordis.yml missing rows: ${missing.join(', ')}`)

if (/command:\s+[A-Za-z]:[\\/]/i.test(raw)) {
  throw new Error('committed preset must not contain an absolute interpreter path')
}
const productPersona = configString(composition, 'persona', 'prefix')
const evalPersona = configString(headless, 'system-prompt', 'personaPrefix')
if (normalizeWhitespace(productPersona) !== normalizeWhitespace(evalPersona)) {
  throw new Error('product and headless evaluation personas must stay identical')
}
console.log('InsightAgent preset structure is valid')

function configString(
  rows: Array<{ id?: string; config?: unknown }>,
  id: string,
  key: string,
): string {
  const row = rows.find((item) => item.id === id)
  if (typeof row?.config !== 'object' || row.config === null) {
    throw new Error(`missing config for ${id}`)
  }
  const value = (row.config as Record<string, unknown>)[key]
  if (typeof value !== 'string') throw new Error(`missing ${id}.${key}`)
  return value
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}
