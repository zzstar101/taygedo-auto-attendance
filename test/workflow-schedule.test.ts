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

  it('disables CI and Docker workflows in downstream forks', () => {
    const ciWorkflow = readFileSync('.github/workflows/ci.yml', 'utf8')
    const dockerWorkflow = readFileSync('.github/workflows/docker.yml', 'utf8')

    expect(ciWorkflow).toContain("if: github.repository == 'zzstar101/taygedo-auto-attendance'")
    expect(dockerWorkflow).toContain("if: github.repository == 'zzstar101/taygedo-auto-attendance'")
  })

  it('runs the test suite on Windows as well as Linux', () => {
    const ciWorkflow = readFileSync('.github/workflows/ci.yml', 'utf8')

    expect(ciWorkflow).toContain('runs-on: ubuntu-latest')
    expect(ciWorkflow).toContain('runs-on: windows-latest')
  })

  it('runs Windows smoke tests only after the Windows verify job', () => {
    const ciWorkflow = readFileSync('.github/workflows/ci.yml', 'utf8')

    expect(ciWorkflow).toContain('smoke-windows:')
    expect(ciWorkflow).toContain('needs: verify-windows')
    expect(ciWorkflow).toContain('name: Cloudflare Worker build smoke test')
    expect(ciWorkflow).toContain('name: Cloud function build smoke test')
  })

  it('keeps scheduled workflows active without empty commits', () => {
    const workflow = readFileSync('.github/workflows/attendance.yml', 'utf8')

    expect(workflow).toContain('workflow-keepalive:')
    expect(workflow).toContain("if: github.event_name == 'schedule'")
    expect(workflow).toContain('actions: write')
    expect(workflow).toContain('uses: liskin/gh-workflow-keepalive@v1')
    expect(workflow).not.toContain('git commit --allow-empty')
    expect(workflow).not.toContain('git push')
  })
})
