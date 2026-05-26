import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('scheduled attendance time', () => {
  it('runs GitHub Actions attendance at 02:00 Asia/Shanghai', () => {
    const workflow = readFileSync('.github/workflows/attendance.yml', 'utf8')

    expect(workflow).toContain("cron: '0 18 * * *'")
  })

  it('runs Cloudflare Worker cron at 02:00 Asia/Shanghai', () => {
    const wrangler = readFileSync('wrangler.jsonc', 'utf8')

    expect(wrangler).toContain('"crons": ["0 18 * * *"]')
  })

  it('passes non-secret coin task variables into the attendance action', () => {
    const workflow = readFileSync('.github/workflows/attendance.yml', 'utf8')

    expect(workflow).toContain('TAYGEDO_COIN_TASKS: ${{ vars.TAYGEDO_COIN_TASKS }}')
    expect(workflow).toContain('TAYGEDO_SHARE_PLATFORM: ${{ vars.TAYGEDO_SHARE_PLATFORM }}')
  })
})
