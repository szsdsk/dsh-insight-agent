import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import YAML from 'js-yaml'

const root = resolve(import.meta.dirname, '../..')
const bundle = resolve(root, 'packages/bundle/web-app')

type Entry = {
  id?: string
  name?: string
  config?: { id?: string; default?: string; plugins?: Entry[] }
  insert?: Entry[]
}

async function parsePatch(path: string): Promise<Entry[]> {
  const raw = await readFile(path, 'utf8')
  if (/command:\s+[A-Z]:(?:\\|\/)/i.test(raw)) {
    throw new Error(`${path} contains a machine-specific interpreter path`)
  }
  return YAML.load(raw.replace(/!!js ([^\r\n]+)/g, (_match, expression: string) =>
    JSON.stringify(expression.trim()))) as Entry[]
}

const preset = await parsePatch(resolve(bundle, 'presets/insight-agent.patch.yml'))
const declaration = preset.flatMap(row => row.insert ?? []).find(row => row.id === 'preset-insight-agent')
if (declaration?.config?.id !== 'insight-agent' || declaration.name !== '@deepseek-ai/dsh-agent-preset') {
  throw new Error('InsightAgent preset declaration is missing')
}

const pluginIds = new Set(declaration.config.plugins?.map(plugin => plugin.id))
for (const id of ['persona', 'skill-filesystem', 'insight-evidence', 'insight-data']) {
  if (!pluginIds.has(id)) throw new Error(`InsightAgent preset is missing ${id}`)
}

const webPatch = await parsePatch(resolve(bundle, 'cordis.patch.yml'))
const registry = webPatch.flatMap(row => row.insert ?? []).find(row => row.id === 'agent-preset-registry')
if (registry?.config?.default !== 'insight-agent') {
  throw new Error('The Web bundle must default to InsightAgent')
}

const manifest = JSON.parse(await readFile(resolve(bundle, 'package.json'), 'utf8')) as {
  dsh?: { bundle?: { patch?: string[] } }
  dependencies?: Record<string, string>
}
if (!manifest.dsh?.bundle?.patch?.includes('./presets/insight-agent.patch.yml')) {
  throw new Error('The Web bundle does not include the InsightAgent preset')
}
if (manifest.dependencies?.['@deepseek-ai/dsh-insight-evidence'] !== 'workspace:^') {
  throw new Error('The Web bundle does not depend on the evidence plugin')
}

const skills = await readdir(resolve(bundle, 'insight-skills'))
if (!skills.includes('text-to-sql') || !skills.includes('result-verification')) {
  throw new Error('InsightAgent analysis skills are missing')
}
console.log('InsightAgent bundle configuration is valid')
