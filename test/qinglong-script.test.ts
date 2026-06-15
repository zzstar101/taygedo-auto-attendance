import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'

describe('qinglong script', () => {
  it('initializes accounts from env and runs local CLI commands', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'taygedo-ql-'))
    const accounts = JSON.stringify([
      {
        id: 'main',
        name: '主账号',
        uid: '123456',
        deviceId: 'abcdef1234567890',
        refreshToken: 'refresh-token',
      },
    ])

    try {
      const result = await runScript(['device', '--print'], {
        TAYGEDO_DATA_DIR: dataDir,
        TAYGEDO_ACCOUNTS: accounts,
      })

      expect(result.code).toBe(0)
      expect(result.stdout).toContain('"id": "main"')
      await expect(readFile(join(dataDir, 'accounts.json'), 'utf8')).resolves.toContain('"refreshToken":"refresh-token"')
    }
    finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })
})

function runScript(args: string[], env: Record<string, string>): Promise<{ code: number | null, stdout: string, stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', ['scripts/qinglong.sh', ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...env,
      },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => {
      stdout += chunk
    })
    child.stderr.on('data', chunk => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', code => resolve({ code, stdout, stderr }))
  })
}
