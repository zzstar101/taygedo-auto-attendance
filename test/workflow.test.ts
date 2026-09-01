import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('attendance workflow', () => {
  it('updates the accounts secret after a failed attendance step when an updated file exists', async () => {
    const workflow = await readFile(new URL('../.github/workflows/attendance.yml', import.meta.url), 'utf8')

    expect(workflow).toContain("if: always() && hashFiles('updated-accounts.json') != ''")
  })
})
