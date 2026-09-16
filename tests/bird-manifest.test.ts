import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('BIRD fixed subset manifest', () => {
  it('contains the deterministic 100-of-500 index sample', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '../evals/manifests/bird-mini-dev-100.json'), 'utf8'),
    ) as { indices: number[] }
    const expected = Array.from({ length: 500 }, (_, index) => ({
      index,
      hash: createHash('sha256').update(`insight-agent-v1:${index}`).digest('hex'),
    }))
      .sort((left, right) => left.hash.localeCompare(right.hash))
      .slice(0, 100)
      .map((item) => item.index)
      .sort((left, right) => left - right)

    expect(manifest.indices).toEqual(expected)
    expect(new Set(manifest.indices).size).toBe(100)
  })
})
