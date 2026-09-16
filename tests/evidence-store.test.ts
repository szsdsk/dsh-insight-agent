import { describe, expect, it } from 'vitest'
import { EvidenceError, EvidenceStore, parseQueryRecord } from '../src/evidence-store.js'

const query = {
  queryId: 'q_abc',
  sourceId: 'src_sales',
  sql: 'SELECT SUM(amount) AS total FROM sales',
  columns: ['total'],
  rowCount: 1,
  truncated: false,
  elapsedMs: 4,
  resultDigest: 'sha256:123',
}

describe('EvidenceStore', () => {
  it('accepts only successful queries from the same session', () => {
    let now = 1_000
    const store = new EvidenceStore(() => now)
    store.start('session-a')
    store.record('session-a', query)
    store.observeStep('session-a')
    store.observeSql('session-a', false)
    store.observeSql('session-a', true)
    now = 1_025

    const result = store.submit('session-a', 'deepseek-chat', {
      answer: 'Revenue is 42.',
      evidence: [{ query_id: 'q_abc', claim: 'The total revenue is 42.' }],
    })

    expect(result.steps).toBe(1)
    expect(result.elapsed_ms).toBe(25)
    expect(result.sql_attempts).toBe(2)
    expect(result.invalid_sql_count).toBe(1)
    expect(result.recovered).toBe(true)
    expect(result.evidence[0]?.sql).toBe(query.sql)
    expect(result.evidence[0]?.result_summary).not.toHaveProperty('rows')
  })

  it('rejects forged and cross-session query ids', () => {
    const store = new EvidenceStore()
    store.record('session-a', query)

    expect(() =>
      store.submit('session-b', 'model', {
        answer: 'Unsupported',
        evidence: [{ query_id: 'q_abc', claim: 'A claim' }],
      }),
    ).toThrow(EvidenceError)
  })

  it('clears session evidence', () => {
    const store = new EvidenceStore()
    store.record('session-a', query)
    store.clear('session-a')
    expect(store.has('session-a', query.queryId)).toBe(false)
  })
})

describe('parseQueryRecord', () => {
  it('accepts the MCP execute_sql contract', () => {
    expect(
      parseQueryRecord({
        query_id: 'q_1',
        source_id: 'src_1',
        sql: 'SELECT 1',
        columns: ['1'],
        rows: [[1]],
        row_count: 1,
        truncated: false,
        elapsed_ms: 1,
      }),
    ).toMatchObject({ queryId: 'q_1', sourceId: 'src_1' })
  })

  it('unwraps the protocol-complete dsh-mcp-client value', () => {
    expect(
      parseQueryRecord({
        content: [],
        structuredContent: {
          query_id: 'q_2',
          source_id: 'src_2',
          sql: 'SELECT 2',
          columns: ['2'],
          rows: [[2]],
          row_count: 1,
          truncated: false,
          elapsed_ms: 2,
        },
      }),
    ).toMatchObject({ queryId: 'q_2', sourceId: 'src_2' })
  })

  it('rejects malformed successful values', () => {
    expect(parseQueryRecord({ query_id: 'q_1' })).toBeUndefined()
  })

  it('parses MCP text content when structured content is unavailable', () => {
    expect(
      parseQueryRecord({
        content: [{
          type: 'text',
          text: JSON.stringify({
            query_id: 'q_3',
            source_id: 'src_3',
            sql: 'SELECT 3',
            columns: ['3'],
            row_count: 1,
            truncated: false,
            elapsed_ms: 3,
          }),
        }],
        structuredContent: null,
      }),
    ).toMatchObject({ queryId: 'q_3', sourceId: 'src_3' })
  })
})
