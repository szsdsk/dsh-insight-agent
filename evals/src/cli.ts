import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { delimiter, relative, resolve } from 'node:path'
import YAML from 'js-yaml'
import { markdownReport } from './report.ts'
import { assessOfficeCase } from './office.ts'
import { parseTrace, type Trace } from './trace.ts'
import type { EvalCase, EvalRun, EvalVariant, OfficeCase } from './types.ts'

const repoRoot = resolve(import.meta.dirname, '../..')
const insightPersona = await readProductPersona()
const variants: EvalVariant[] = [
  'direct-sql',
  'standard-dsh',
  'insight-agent',
  'no-plan',
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
    if (suite === 'office' && ['direct-sql', 'no-verification', 'no-evidence'].includes(variant)) {
      throw new Error(`variant ${variant} is not comparable on the office suite`)
    }
  }
  const repeats = positiveInteger(options.repeats ?? '1', 'repeats')
  const limit = options.limit === undefined ? undefined : positiveInteger(options.limit, 'limit')
  const workspace = suite === 'bird' ? birdRoot() : suite === 'office' ? resolve(options.workspace ?? repoRoot) : repoRoot
  const service = await runProcess(resolve(python), ['-c', 'import insight_mcp.server'], repoRoot)
  if (service.exitCode !== 0) {
    throw new Error(`Insight MCP is unavailable in ${python}: ${service.stderr || service.stdout}`)
  }
  if (suite === 'office') {
    const checked = await runProcess(resolve(python), [resolve(repoRoot, 'evals/office/prepare.py'), '--check'], repoRoot)
    if (checked.exitCode !== 0) throw new Error(`frozen office fixtures failed: ${checked.stderr || checked.stdout}`)
    if (workspace !== repoRoot) {
      const source = resolve(repoRoot, 'evals/data/office')
      const target = resolve(workspace, 'evals/data/office')
      await mkdir(target, { recursive: true })
      for (const file of await readdir(source)) {
        if (file.endsWith('.csv')) await copyFile(resolve(source, file), resolve(target, file))
      }
    }
  }
  const cases = suite === 'office' ? (await loadOfficeCases()).slice(0, limit) : (await loadCases(suite, workspace)).slice(0, limit)
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
      : await writeVariantPatch(variant, python, workspace, suite)
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
        const tracePath = resolve(outputDirectory, 'traces', suite, variant, `${testCase.id}-${repeat}.jsonl`)
        run.records.push(suite === 'office'
          ? await runOfficeCase(testCase as OfficeCase, variant, workspace, patch, tracePath)
          : await runCase(testCase as EvalCase, variant, python, workspace, patch, tracePath))
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
  tracePath: string,
) {
  const started = Date.now()
  let savedTrace: Trace | undefined
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
    evidence_complete: false,
    trace_path: null,
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

    const schema = variant === 'direct-sql' && testCase.schema_context === undefined
      ? (testCase.source.kind === 'sqlite' ? (await pythonBridge(python, 'schema', {
        workspace, source_path: testCase.source.path, source_kind: testCase.source.kind,
      }) as { schema: string }).schema : undefined)
      : testCase.schema_context
    const prompt = buildPrompt(testCase, variant, schema)
    const processResult = await runDsh(prompt, workspace, patch)
    await mkdir(resolve(tracePath, '..'), { recursive: true })
    await writeFile(tracePath, processResult.stdout + '\n', 'utf8')
    const trace = parseTrace(processResult.stdout)
    savedTrace = trace
    const parsed = trace.submitted ?? parseAssistantOutput(trace.finalText ?? '')
    const metadata = isRecord(parsed) ? parsed : {}
    const candidateSql = extractSql(parsed, trace)

    if (testCase.kind === 'ambiguity') {
      const terms = testCase.expected_terms ?? []
      const success = trace.complete && terms.some((term) => (trace.finalText ?? '').includes(term))
      return {
        ...base,
        success,
        execution_correct: null,
        dangerous_sql_blocked: null,
        result_fingerprint: sha256(trace.finalText ?? ''),
        steps: trace.steps,
        input_tokens: trace.inputTokens,
        output_tokens: trace.outputTokens,
        evidence_complete: trace.complete,
        trace_path: tracePath,
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
      method: testCase.id.startsWith('bird-') ? 'bird_ex' : 'structured',
    }) as { equal?: boolean; error?: string; candidate_fingerprint?: string }
    const correct = comparison.equal === true
    const invalidCount = numberField(metadata, 'invalid_sql_count')
    const recovered = booleanField(metadata, 'recovered')
    const recoverySatisfied = testCase.kind !== 'recovery' || (recovered && invalidCount > 0)
    return {
      ...base,
      success: correct && recoverySatisfied && processResult.exitCode === 0 && trace.complete,
      execution_correct: correct,
      dangerous_sql_blocked: null,
      invalid_sql_count: invalidCount,
      sql_attempts: numberField(metadata, 'sql_attempts') || (candidateSql ? 1 : 0),
      recovered,
      result_fingerprint: comparison.candidate_fingerprint ?? null,
      steps: trace.steps,
      input_tokens: trace.inputTokens,
      output_tokens: trace.outputTokens,
      evidence_complete: trace.complete,
      trace_path: tracePath,
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
      trace_path: savedTrace === undefined ? null : tracePath,
      evidence_complete: savedTrace?.complete ?? false,
      input_tokens: savedTrace?.inputTokens ?? null,
      output_tokens: savedTrace?.outputTokens ?? null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function loadOfficeCases(): Promise<OfficeCase[]> {
  const manifest = JSON.parse(await readFile(resolve(repoRoot, 'evals/manifests/office-frozen-30.json'), 'utf8')) as { formatVersion: number; caseCount: number; cases: OfficeCase[] }
  if (manifest.formatVersion !== 1 || manifest.caseCount !== 30 || manifest.cases.length !== 30) throw new Error('office evaluation manifest must contain 30 frozen cases')
  return manifest.cases
}

async function runOfficeCase(testCase: OfficeCase, variant: EvalVariant, workspace: string, patch: string | undefined, tracePath: string) {
  const started = Date.now()
  let savedTrace: Trace | undefined
  const prompt = `Baseline file: ${testCase.baseline}\nCurrent file: ${testCase.current}\nBoth files are CSV. ${testCase.question} Check quality, state the metric definition, compare the two periods, and cite query evidence. Ask for clarification if the requested definition is ambiguous.`
  const base = { task_id: testCase.id, category: testCase.category, variant, success: false,
    execution_correct: false, dangerous_sql_blocked: null, invalid_sql_count: 0, sql_attempts: 0,
    recovered: false, steps: 0, input_tokens: null, output_tokens: null, token_cost_usd: null,
    result_fingerprint: null, evidence_complete: false, trace_path: null, latency_ms: 0,
    quality_precision: null, quality_recall: null, focus_correct: null, error: null }
  try {
    const processResult = await runDsh(prompt, workspace, patch)
    await mkdir(resolve(tracePath, '..'), { recursive: true })
    await writeFile(tracePath, processResult.stdout + '\n', 'utf8')
    const trace = parseTrace(processResult.stdout)
    savedTrace = trace
    const assessment = assessOfficeCase(testCase, trace)
    const calls = trace.toolCalls.filter(item => item.tool === 'mcp__insight__compare_tables' || item.tool === 'mcp__insight__execute_sql')
    return { ...base, success: assessment.success && processResult.exitCode === 0,
      execution_correct: testCase.category === 'ambiguity' ? null : assessment.metricCorrect,
      sql_attempts: calls.length, invalid_sql_count: trace.toolResults.filter(item => item.status !== 'completed' && item.tool === 'mcp__insight__compare_tables').length,
      recovered: trace.toolResults.some(item => item.status !== 'completed' && item.tool === 'mcp__insight__compare_tables') &&
        trace.toolResults.some(item => item.status === 'completed' && item.tool === 'mcp__insight__compare_tables'), steps: trace.steps,
      input_tokens: trace.inputTokens, output_tokens: trace.outputTokens, evidence_complete: trace.complete,
      trace_path: tracePath, latency_ms: Date.now() - started, result_fingerprint: assessment.fingerprint,
      quality_precision: assessment.qualityPrecision, quality_recall: assessment.qualityRecall,
      focus_correct: assessment.focusCorrect, error: assessment.error }
  } catch (error) {
    return { ...base, latency_ms: Date.now() - started, trace_path: savedTrace === undefined ? null : tracePath,
      evidence_complete: savedTrace?.complete ?? false, input_tokens: savedTrace?.inputTokens ?? null,
      output_tokens: savedTrace?.outputTokens ?? null, steps: savedTrace?.steps ?? 0,
      error: error instanceof Error ? error.message : String(error) }
  }
}

function buildPrompt(testCase: EvalCase, variant: EvalVariant, schema?: string): string {
  const source = `Data source path: ${testCase.source.path}\nData source kind: ${testCase.source.kind}`
  const evidence = testCase.evidence ? `\nBusiness evidence: ${testCase.evidence}` : ''
  if (variant === 'direct-sql') {
    if (schema === undefined) throw new Error(`schema is unavailable for direct SQL case ${testCase.id}`)
    return `${source}${evidence}\nSchema: ${schema}\nQuestion: ${testCase.question}\nReturn JSON only: {"sql":"one read-only SQL statement"}.`
  }
  const recovery = testCase.probe_sql
    ? `\nAs required by this case, first try: ${testCase.probe_sql}`
    : ''
  return `${source}${evidence}${recovery}\nQuestion: ${testCase.question}`
}

async function runDsh(task: string, cwd: string, patch: string | undefined) {
  const executable = process.execPath
  const args = [resolve(repoRoot, 'apps/cli/lib/bin.js'), '--profile', 'headless']
  if (patch !== undefined) args.push('--patch', patch)
  args.push('--json', task)
  return runProcess(executable, args, cwd)
}

async function writeVariantPatch(
  variant: EvalVariant,
  python: string,
  workspace: string,
  suite: string,
): Promise<string> {
  const directory = resolve(repoRoot, '.generated/evals')
  await mkdir(directory, { recursive: true })
  const path = resolve(directory, `${variant}.cordis.patch.yml`)
  const withSkills = ['insight-agent', 'no-schema', 'no-plan'].includes(variant)
  const withEvidence = ['insight-agent', 'no-schema', 'no-plan'].includes(variant) || (suite === 'office' && variant === 'standard-dsh')
  const persona = variantPersona(variant, suite)
  const rows = [
    '- id: system-prompt',
    '  config:',
    `    personaSuffix: ${withEvidence ? 'Your working directory is {{cwd}}. This is a headless evaluation. Return submit_analysis JSON unchanged as the final message.' : 'Your working directory is {{cwd}}. This is a headless evaluation. Return a JSON answer with SQL evidence.'}`,
    `    personaPrefix: ${yamlSingle(persona)}`,
    '',
    '- id: headless-runner',
    '  config:',
    '    task: !!js ctx.headlessStartup.task',
    '    sessionId: !!js ctx.headlessStartup.sessionId',
    '    json: !!js ctx.headlessStartup.json',
    '    jsonMaxStringBytes: 24576',
  ]
  if (withSkills) {
    rows.push(
      '',
      '- id: skill-filesystem',
      '  config:',
      `    customSkillDirs: [${yamlSingle(resolve(repoRoot, 'packages/bundle/web-app/insight-skills'))}]`,
    )
  }
  rows.push('', '- insert:')
  if (withEvidence) {
    rows.push(
      '    - id: insight-evidence',
      `      name: ${yamlSingle(resolve(repoRoot, 'packages/insight/insight-evidence/lib/index.js'))}`,
      '      config:',
      `        enableDiagnosticPlan: ${variant !== 'no-plan' && variant !== 'standard-dsh'}`,
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
    `          PYTHONPATH: ${yamlSingle(resolve(repoRoot, 'python/insight-mcp/src'))}`,
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

function variantPersona(variant: EvalVariant, suite: string): string {
  if (variant === 'standard-dsh') {
    return 'You are a data analyst. Use mcp__insight tools to inspect the files, diagnose data quality, compare the periods, verify queries, and submit a grounded final answer.'
  }
  if (variant === 'no-plan') {
    return 'You are InsightAgent without structured planning. Inspect the files and schema, call the read-only diagnostic and comparison tools directly, verify every query, then submit_analysis with query evidence.'
  }
  if (variant === 'no-evidence') {
    return 'You are InsightAgent. Discover schema, execute and verify read-only SQL, but do not use evidence enforcement. End with JSON containing answer and sql.'
  }
  if (variant === 'no-schema') {
    if (suite === 'office') return 'You are InsightAgent without proactive data exploration. Register both supplied files, avoid preview_table, list_relations, describe_relation, profile_relation, and sample_rows. Plan the comparison from the user request, execute_diagnostic_plan, then submit_analysis with verified query evidence.'
    return 'You are InsightAgent in a schema-exploration ablation. Do not call list_relations, describe_relation, profile_relation, or sample_rows. Execute read-only SQL, verify it, submit evidence, then return submit_analysis JSON unchanged.'
  }
  if (variant === 'no-verification') {
    return 'You are InsightAgent in a verification ablation. Discover schema and execute read-only SQL but do not call verify_query. End with JSON containing answer and sql.'
  }
  return insightPersona
}

async function readProductPersona(): Promise<string> {
  const path = resolve(repoRoot, 'packages/bundle/web-app/presets/insight-agent.patch.yml')
  const raw = await readFile(path, 'utf8')
  const rows = YAML.load(raw.replace(/!!js ([^\r\n]+)/g, (_match, expression: string) =>
    JSON.stringify(expression.trim()))) as Array<{
      insert?: Array<{ id?: string; config?: { plugins?: Array<{ id?: string; config?: { prefix?: string } }> } }>
    }>
  const preset = rows.flatMap(row => row.insert ?? []).find(row => row.id === 'preset-insight-agent')
  const persona = preset?.config?.plugins?.find(plugin => plugin.id === 'persona')?.config?.prefix
  if (!persona) throw new Error('InsightAgent preset persona is missing')
  return persona
}

async function pythonBridge(
  python: string,
  action: 'prepare' | 'compare' | 'policy' | 'schema',
  payload: Record<string, unknown>,
): Promise<unknown> {
  const result = await runProcess(resolve(python), ['-m', 'insight_mcp.eval_bridge', action], repoRoot, JSON.stringify(payload))
  const parsed = JSON.parse(result.stdout) as { ok?: boolean; error?: string }
  if (result.exitCode !== 0 || parsed.ok !== true) throw new Error(parsed.error ?? result.stderr)
  return parsed
}

function runProcess(executable: string, args: string[], cwd: string, stdin?: string) {
  return new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolvePromise, reject) => {
    const pythonPath = [resolve(repoRoot, 'python/insight-mcp/src'), process.env.PYTHONPATH].filter(Boolean).join(delimiter)
    const child = spawn(executable, args, { cwd, windowsHide: true, env: { ...process.env, PYTHONPATH: pythonPath } })
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
  try { return JSON.parse(text) } catch { return undefined }
}

function extractSql(parsed: unknown, trace: Trace): string | undefined {
  if (isRecord(parsed)) {
    if (typeof parsed.sql === 'string') return parsed.sql
    if (Array.isArray(parsed.cited_sql) && typeof parsed.cited_sql[0] === 'string') return parsed.cited_sql[0]
  }
  const call = [...trace.toolCalls].reverse().find(item => item.tool === 'mcp__insight__execute_sql')
  return typeof call?.input.sql === 'string' ? call.input.sql : undefined
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

function printHelp(): void {
  console.log(`InsightAgent eval\n\nCommands:\n  run --python PATH [--suite office|synthetic|bird] [--workspace PATH] [--variants insight-agent,...] [--repeats 3] [--limit N]\n  bird-manifest                 requires BIRD_DATA_ROOT\n  report --input RUN.json`)
}
