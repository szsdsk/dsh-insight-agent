import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { markdownReport } from './report.js'
import type { EvalCase, EvalRun, EvalVariant } from './types.js'

const repoRoot = resolve(import.meta.dirname, '../..')
const insightPersona = 'You are InsightAgent, an evidence-grounded data analyst powered by the {{model}} model. Analyze only workspace-local CSV, SQLite, and DuckDB sources through the mcp__insight tools. For every data question follow this workflow: discover the source and schema, state an analysis plan, execute read-only SQL, verify every query, then report. Never infer table names or values without inspection. Never use Shell or file tools to bypass the data service. Recover from invalid SQL using the returned error and the discovered schema. A final factual conclusion must cite a query_id created successfully in this session. Finish by calling submit_analysis, then return its JSON unchanged as your final message; do not present an unsupported final answer. State assumptions, ambiguity, empty results, truncation, and limitations.'
const variants: EvalVariant[] = [
  'direct-sql',
  'standard-dsh',
  'insight-agent',
  'no-schema',
  'no-verification',
  'no-evidence',
]

const [command = 'help', ...rawArgs] = process.argv.slice(2)
const options = parseOptions(rawArgs)

if (command === 'bird-manifest') {
  await buildBirdManifest()
} else if (command === 'report') {
  await renderReport(requiredOption(options, 'input'))
} else if (command === 'run') {
  await runEvaluation()
} else {
  printHelp()
}

async function runEvaluation(): Promise<void> {
  const suite = options.suite ?? 'synthetic'
  const python = requiredOption(options, 'python')
  const selectedVariants = (options.variants ?? 'insight-agent')
    .split(',')
    .map((item) => item.trim()) as EvalVariant[]
  for (const variant of selectedVariants) {
    if (!variants.includes(variant)) throw new Error(`unknown variant: ${variant}`)
  }
  const repeats = positiveInteger(options.repeats ?? '1', 'repeats')
  const limit = options.limit === undefined ? undefined : positiveInteger(options.limit, 'limit')
  const workspace = suite === 'bird' ? birdRoot() : repoRoot
  const cases = (await loadCases(suite, workspace)).slice(0, limit)
  if (cases.length === 0) throw new Error(`no cases available for suite ${suite}`)

  if (suite === 'synthetic') {
    await pythonBridge(python, 'prepare', {
      workspace,
      schema_path: 'evals/data/synthetic/schema.sql',
      database_path: 'evals/data/synthetic/insight.sqlite',
    })
  }
  const outputDirectory = resolve(repoRoot, 'evals/runs')
  await mkdir(outputDirectory, { recursive: true })
  const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
  const runs: EvalRun[] = []

  for (const variant of selectedVariants) {
    const patch = variant === 'direct-sql'
      ? undefined
      : await writeVariantPatch(variant, python, workspace)
    const run: EvalRun = {
      run_id: `${suite}-${variant}-${timestamp}`,
      created_at: new Date().toISOString(),
      suite,
      model: process.env.INSIGHT_MODEL_LABEL ?? 'configured-dsh-model',
      variant,
      records: [],
    }
    for (let repeat = 0; repeat < repeats; repeat += 1) {
      for (const testCase of cases) {
        run.records.push(await runCase(testCase, variant, python, workspace, patch))
      }
    }
    runs.push(run)
    await writeFile(
      resolve(outputDirectory, `${run.run_id}.json`),
      JSON.stringify(run, null, 2) + '\n',
      'utf8',
    )
  }
  const reportPath = resolve(outputDirectory, `${suite}-${timestamp}.md`)
  await writeFile(reportPath, markdownReport(runs, reportPath), 'utf8')
  console.log(reportPath)
}

async function runCase(
  testCase: EvalCase,
  variant: EvalVariant,
  python: string,
  workspace: string,
  patch: string | undefined,
) {
  const started = Date.now()
  const base = {
    task_id: testCase.id,
    category: testCase.category,
    variant,
    invalid_sql_count: 0,
    sql_attempts: 0,
    recovered: false,
    steps: 0,
    input_tokens: null,
    output_tokens: null,
    token_cost_usd: null,
    result_fingerprint: null,
  }
  try {
    if (testCase.kind === 'safety') {
      const policy = await pythonBridge(python, 'policy', {
        sql: testCase.probe_sql,
        dialect: testCase.source.kind === 'sqlite' ? 'sqlite' : 'duckdb',
      }) as { blocked?: boolean; error?: string }
      const blocked = policy.blocked === true
      return {
        ...base,
        success: blocked,
        execution_correct: null,
        dangerous_sql_blocked: blocked,
        result_fingerprint: sha256(JSON.stringify({ blocked })),
        invalid_sql_count: blocked ? 1 : 0,
        sql_attempts: 1,
        latency_ms: Date.now() - started,
        error: blocked ? null : policy.error ?? 'dangerous SQL was accepted',
      }
    }

    const prompt = buildPrompt(testCase, variant)
    const processResult = await runDsh(prompt, workspace, patch)
    const parsed = parseAssistantOutput(processResult.stdout)
    const metadata = isRecord(parsed) ? parsed : {}
    const candidateSql = extractSql(parsed, processResult.stdout)

    if (testCase.kind === 'ambiguity') {
      const terms = testCase.expected_terms ?? []
      const success = terms.some((term) => processResult.stdout.includes(term))
      return {
        ...base,
        success,
        execution_correct: null,
        dangerous_sql_blocked: null,
        result_fingerprint: sha256(processResult.stdout),
        steps: numberField(metadata, 'steps'),
        latency_ms: Date.now() - started,
        error: success ? null : 'agent did not request clarification for an ambiguous metric',
      }
    }
    if (candidateSql === undefined || testCase.gold_sql === undefined) {
      throw new Error('final output did not contain candidate SQL')
    }
    const comparison = await pythonBridge(python, 'compare', {
      workspace,
      source_path: testCase.source.path,
      source_kind: testCase.source.kind,
      candidate_sql: candidateSql,
      gold_sql: testCase.gold_sql,
    }) as { equal?: boolean; error?: string; candidate_fingerprint?: string }
    const correct = comparison.equal === true
    const invalidCount = numberField(metadata, 'invalid_sql_count')
    const recovered = booleanField(metadata, 'recovered')
    const recoverySatisfied = testCase.kind !== 'recovery' || (recovered && invalidCount > 0)
    return {
      ...base,
      success: correct && recoverySatisfied && processResult.exitCode === 0,
      execution_correct: correct,
      dangerous_sql_blocked: null,
      invalid_sql_count: invalidCount,
      sql_attempts: numberField(metadata, 'sql_attempts') || (candidateSql ? 1 : 0),
      recovered,
      result_fingerprint: comparison.candidate_fingerprint ?? null,
      steps: numberField(metadata, 'steps'),
      latency_ms: Date.now() - started,
      error: correct ? (recoverySatisfied ? null : 'required SQL recovery was not observed') : comparison.error ?? 'execution result mismatch',
    }
  } catch (error) {
    return {
      ...base,
      success: false,
      execution_correct: testCase.kind === 'ambiguity' ? null : false,
      dangerous_sql_blocked: null,
      latency_ms: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function buildPrompt(testCase: EvalCase, variant: EvalVariant): string {
  const source = `Data source path: ${testCase.source.path}\nData source kind: ${testCase.source.kind}`
  const evidence = testCase.evidence ? `\nBusiness evidence: ${testCase.evidence}` : ''
  if (variant === 'direct-sql') {
    return `${source}${evidence}\nSchema: ${testCase.schema_context ?? syntheticSchema()}\nQuestion: ${testCase.question}\nReturn JSON only: {"sql":"one read-only SQL statement"}.`
  }
  const recovery = testCase.probe_sql
    ? `\nAs required by this case, first try: ${testCase.probe_sql}`
    : ''
  return `${source}${evidence}${recovery}\nQuestion: ${testCase.question}`
}

function legacyBuildPrompt(testCase: EvalCase, variant: EvalVariant): string {
  const source = `数据源路径：${testCase.source.path}\n数据源类型：${testCase.source.kind}`
  const evidence = testCase.evidence ? `\n业务知识：${testCase.evidence}` : ''
  if (variant === 'direct-sql') {
    return `${source}${evidence}\nSchema：${testCase.schema_context ?? syntheticSchema()}\n问题：${testCase.question}\n只返回 JSON：{"sql":"一条只读 SQL"}。`
  }
  const recovery = testCase.probe_sql ? `\n按用例要求先尝试：${testCase.probe_sql}` : ''
  return `${source}${evidence}${recovery}\n问题：${testCase.question}`
}

async function runDsh(task: string, cwd: string, patch: string | undefined) {
  const executable = process.env.DSH_BIN ?? 'dsh'
  const args = ['--profile', 'headless']
  if (patch !== undefined) args.push('--patch', patch)
  args.push(task)
  return runProcess(executable, args, cwd)
}

async function writeVariantPatch(
  variant: EvalVariant,
  python: string,
  workspace: string,
): Promise<string> {
  const directory = resolve(repoRoot, '.generated/evals')
  await mkdir(directory, { recursive: true })
  const path = resolve(directory, `${variant}.cordis.patch.yml`)
  const withSkills = ['insight-agent', 'no-schema', 'no-verification', 'no-evidence'].includes(variant)
  const withEvidence = ['insight-agent', 'no-schema', 'no-verification'].includes(variant)
  const persona = variantPersona(variant)
  const rows = [
    '- id: system-prompt',
    '  config:',
    '    personaSuffix: Your working directory is {{cwd}}.',
    `    personaPrefix: ${yamlSingle(persona)}`,
  ]
  if (withSkills) {
    rows.push(
      '',
      '- id: skill-filesystem',
      '  config:',
      `    customSkillDirs: [${yamlSingle(resolve(repoRoot, 'skills'))}]`,
    )
  }
  rows.push('', '- insert:')
  if (withEvidence) {
    rows.push(
      '    - id: insight-evidence',
      `      name: ${yamlSingle(resolve(repoRoot, 'dist/host.js'))}`,
      '',
    )
  }
  rows.push(
    '    - id: insight-data',
    "      name: '@deepseek-ai/dsh-mcp-client'",
    '      config:',
    '        serverName: insight',
    '        transport: stdio',
    `        command: ${yamlSingle(resolve(python))}`,
    "        args: ['-m', 'insight_mcp']",
    `        cwd: ${yamlSingle(workspace)}`,
    '        env:',
    `          INSIGHT_WORKSPACE: ${yamlSingle(workspace)}`,
    "          INSIGHT_MAX_ROWS: '200'",
    "          INSIGHT_QUERY_TIMEOUT_SECONDS: '10'",
    "          PYTHONUNBUFFERED: '1'",
    '        toolCallTimeoutMs: 35000',
    '        failOnStartupError: true',
  )
  await writeFile(path, rows.join('\n') + '\n', 'utf8')
  return path
}

function variantPersona(variant: EvalVariant): string {
  if (variant === 'standard-dsh') {
    return 'You are a data analyst. Use mcp__insight tools to inspect the source and answer. End with JSON containing answer and sql.'
  }
  if (variant === 'no-evidence') {
    return 'You are InsightAgent. Discover schema, execute and verify read-only SQL, but do not use evidence enforcement. End with JSON containing answer and sql.'
  }
  if (variant === 'no-schema') {
    return 'You are InsightAgent in a schema-exploration ablation. Do not call list_relations, describe_relation, profile_relation, or sample_rows. Execute read-only SQL, verify it, submit evidence, then return submit_analysis JSON unchanged.'
  }
  if (variant === 'no-verification') {
    return 'You are InsightAgent in a verification ablation. Discover schema but do not call verify_query or run cross-check queries. Submit evidence, then return submit_analysis JSON unchanged.'
  }
  return insightPersona
}

async function pythonBridge(
  python: string,
  action: 'prepare' | 'compare' | 'policy',
  payload: Record<string, unknown>,
): Promise<unknown> {
  const result = await runProcess(resolve(python), ['-m', 'insight_mcp.eval_bridge', action], repoRoot, JSON.stringify(payload))
  const parsed = JSON.parse(result.stdout) as { ok?: boolean; error?: string }
  if (result.exitCode !== 0 || parsed.ok !== true) throw new Error(parsed.error ?? result.stderr)
  return parsed
}

function runProcess(executable: string, args: string[], cwd: string, stdin?: string) {
  return new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolvePromise, reject) => {
    const child = spawn(executable, args, { cwd, windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => resolvePromise({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code ?? 1 }))
    if (stdin !== undefined) child.stdin.end(stdin)
    else child.stdin.end()
  })
}

async function buildBirdManifest(): Promise<void> {
  const root = birdRoot()
  const datasetPath = await findNamedFile(root, 'mini_dev_sqlite.json')
  if (datasetPath === undefined) throw new Error(`mini_dev_sqlite.json not found under ${root}`)
  const raw = JSON.parse(await readFile(datasetPath, 'utf8')) as Array<Record<string, unknown>>
  const manifest = await readBirdManifest()
  const cases = resolveBirdCases(raw, manifest.indices)
  const output = resolve(repoRoot, '.generated/bird-mini-dev-100.resolved.json')
  await mkdir(resolve(repoRoot, '.generated'), { recursive: true })
  await writeFile(output, JSON.stringify({
    dataset_sha256: sha256(await readFile(datasetPath, 'utf8')),
    cases,
  }, null, 2) + '\n', 'utf8')
  console.log(output)
}

async function loadCases(suite: string, workspace: string): Promise<EvalCase[]> {
  if (suite === 'synthetic') {
    return JSON.parse(await readFile(resolve(repoRoot, 'evals/data/synthetic/cases.json'), 'utf8')) as EvalCase[]
  }
  if (suite !== 'bird') throw new Error(`unknown suite: ${suite}`)
  const datasetPath = await findNamedFile(workspace, 'mini_dev_sqlite.json')
  if (datasetPath === undefined) throw new Error('mini_dev_sqlite.json not found under BIRD_DATA_ROOT')
  const raw = JSON.parse(await readFile(datasetPath, 'utf8')) as Array<Record<string, unknown>>
  const manifest = await readBirdManifest()
  const cases = resolveBirdCases(raw, manifest.indices)
  for (const item of cases) {
    if (item.db_id !== undefined) item.source.path = await locateBirdDatabase(workspace, item.db_id)
  }
  return cases
}

async function readBirdManifest(): Promise<{ indices: number[] }> {
  const value = JSON.parse(
    await readFile(resolve(repoRoot, 'evals/manifests/bird-mini-dev-100.json'), 'utf8'),
  ) as { indices?: unknown }
  if (!Array.isArray(value.indices) || value.indices.length !== 100 || !value.indices.every(Number.isSafeInteger)) {
    throw new Error('BIRD manifest must contain exactly 100 integer indices')
  }
  return { indices: value.indices as number[] }
}

function resolveBirdCases(raw: Array<Record<string, unknown>>, indices: number[]): EvalCase[] {
  return indices.map((index) => {
    const item = raw[index]
    if (item === undefined) throw new Error(`BIRD dataset does not contain frozen index ${index}`)
    const sql = String(item.SQL ?? item.sql ?? '').trim()
    if (!/^(select|with)\b/i.test(sql)) throw new Error(`BIRD index ${index} is not SELECT/WITH in this dataset release`)
    const dbId = String(item.db_id)
    return {
      id: `bird-${index.toString().padStart(4, '0')}`,
      category: String(item.difficulty ?? 'bird'),
      kind: 'sql',
      question: String(item.question),
      evidence: String(item.evidence ?? ''),
      gold_sql: sql,
      db_id: dbId,
      source: { path: '', kind: 'sqlite' },
    }
  })
}

async function locateBirdDatabase(root: string, dbId: string): Promise<string> {
  const exact = await findNamedFile(root, `${dbId}.sqlite`)
  if (exact === undefined) throw new Error(`database ${dbId}.sqlite not found under BIRD_DATA_ROOT`)
  return relative(root, exact).replaceAll('\\', '/')
}

async function findNamedFile(root: string, name: string): Promise<string | undefined> {
  const queue = [root]
  while (queue.length > 0) {
    const directory = queue.shift()!
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name)
      if (entry.isFile() && entry.name === name) return path
      if (entry.isDirectory() && !entry.name.startsWith('.')) queue.push(path)
    }
  }
  return undefined
}

async function renderReport(input: string): Promise<void> {
  const path = resolve(input)
  const value = JSON.parse(await readFile(path, 'utf8')) as EvalRun | EvalRun[]
  const runs = Array.isArray(value) ? value : [value]
  const output = path.replace(/\.json$/i, '.md')
  await writeFile(output, markdownReport(runs, path), 'utf8')
  console.log(output)
}

function parseAssistantOutput(text: string): unknown {
  try { return JSON.parse(text) } catch { /* try the outermost object below */ }
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)) } catch { return undefined }
  }
  return undefined
}

function extractSql(parsed: unknown, text: string): string | undefined {
  if (isRecord(parsed)) {
    if (typeof parsed.sql === 'string') return parsed.sql
    if (Array.isArray(parsed.cited_sql) && typeof parsed.cited_sql[0] === 'string') return parsed.cited_sql[0]
  }
  return text.match(/```sql\s*([\s\S]*?)```/i)?.[1]?.trim()
}

function parseOptions(args: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (key === undefined || !key.startsWith('--') || value === undefined) {
      throw new Error(`expected --name value, received: ${args.slice(index).join(' ')}`)
    }
    result[key.slice(2)] = value
  }
  return result
}

function requiredOption(values: Record<string, string>, name: string): string {
  const value = values[name]
  if (!value) throw new Error(`--${name} is required`)
  return value
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`--${name} must be a positive integer`)
  return parsed
}

function birdRoot(): string {
  const root = process.env.BIRD_DATA_ROOT
  if (!root || !existsSync(root)) throw new Error('BIRD_DATA_ROOT must point to the extracted canonical BIRD Mini-Dev data')
  return resolve(root)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function numberField(value: Record<string, unknown>, key: string): number {
  return typeof value[key] === 'number' ? value[key] : 0
}

function booleanField(value: Record<string, unknown>, key: string): boolean {
  return value[key] === true
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function yamlSingle(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function syntheticSchema(): string {
  return 'customers(customer_id,name,region,signup_date); orders(order_id,customer_id,ordered_at,status,amount); products(product_id,name,category); order_items(order_id,product_id,quantity,unit_price)'
}

function printHelp(): void {
  console.log(`InsightAgent eval\n\nCommands:\n  run --python PATH [--suite synthetic|bird] [--variants insight-agent,...] [--repeats 3] [--limit N]\n  bird-manifest                 requires BIRD_DATA_ROOT\n  report --input RUN.json`)
}
