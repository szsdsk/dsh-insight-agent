/** Bounded JSON event projection from one headless Agent run. */
export interface Trace {
  finalText: string | null
  submitted: Record<string, unknown> | null
  toolCalls: readonly { callId: string; tool: string; input: Record<string, unknown> }[]
  toolResults: readonly { callId: string; tool: string; status: string; result: Record<string, unknown> | null }[]
  inputTokens: number | null
  outputTokens: number | null
  steps: number
  complete: boolean
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseObject(value: unknown): Record<string, unknown> | null {
  if (record(value)) return value
  if (typeof value !== 'string') return null
  try { const parsed: unknown = JSON.parse(value); return record(parsed) ? parsed : null }
  catch { return null }
}

/** Parse the headless JSONL stream without recovering missing or truncated evidence.
 * @param stdout - Captured newline-delimited events.
 * @returns Final answer, submitted tool payload, usage, calls, and completeness.
 */
export function parseTrace(stdout: string): Trace {
  const calls: { callId: string; tool: string; input: Record<string, unknown> }[] = []
  const results: { callId: string; tool: string; status: string; result: Record<string, unknown> | null }[] = []
  let finalText: string | null = null
  let submitted: Record<string, unknown> | null = null
  let inputTokens = 0
  let outputTokens = 0
  let usageSeen = false
  let steps = 0
  let complete = true
  let finalSeen = false
  for (const line of stdout.split(/\r?\n/u).filter(Boolean)) {
    let event: unknown
    try { event = JSON.parse(line) } catch { complete = false; continue }
    if (!record(event)) { complete = false; continue }
    if (event.truncated === true || event.type === 'error') complete = false
    if (event.type === 'tool_call') {
      const input = parseObject(event.input)
      if (typeof event.callId === 'string' && typeof event.tool === 'string' && input !== null) calls.push({ callId: event.callId, tool: event.tool, input })
      else complete = false
    }
    if (event.type === 'tool_result') {
      const matched = calls.find(call => call.callId === event.callId)
      if (matched !== undefined) {
        const payload = parseObject(event.result)
        results.push({ callId: matched.callId, tool: matched.tool, status: String(event.status), result: payload })
        if (matched.tool === 'submit_analysis' && event.status === 'completed') submitted = payload ?? submitted
      } else complete = false
    }
    if (event.type === 'status' && event.phase === 'step_end') steps += 1
    if (event.type === 'status' && event.phase === 'step_end' && record(event.usage)) {
      const input = event.usage.inputTokens
      const output = event.usage.outputTokens
      if (typeof input === 'number' && typeof output === 'number') {
        inputTokens += input; outputTokens += output; usageSeen = true
      }
    }
    if (event.type === 'final') { finalSeen = true; finalText = typeof event.text === 'string' ? event.text : null }
  }
  if (calls.some(call => !results.some(result => result.callId === call.callId))) complete = false
  return { finalText, submitted, toolCalls: calls, toolResults: results, inputTokens: usageSeen ? inputTokens : null,
    outputTokens: usageSeen ? outputTokens : null, steps, complete: complete && finalSeen && finalText !== null }
}
