import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

// 青龙面板是 Linux 环境，脚本本身依赖 bash；Windows 上没有 Git Bash 时跳过需要执行脚本的用例。
const bashAvailable = (() => {
  try {
    return spawnSync('bash', ['-c', 'exit 0'], { stdio: 'ignore' }).status === 0
  }
  catch {
    return false
  }
})()

describe('qinglong script', () => {
  it('includes Qinglong task metadata for auto discovery', async () => {
    const script = await readFile('scripts/qinglong.sh', 'utf8')

    expect(script).toContain("new Env('塔吉多自动签到')")
    expect(script).toContain('cron: 15 1 * * *')
  })

  it.runIf(bashAvailable)('initializes accounts from env and runs local CLI commands', async () => {
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
  }, 20000)

  it.runIf(bashAvailable)('prints a Qinglong-friendly setup hint when accounts file is missing', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'taygedo-ql-'))

    try {
      const result = await runScript(['attendance'], {
        TAYGEDO_DATA_DIR: dataDir,
      })

      expect(result.code).toBe(1)
      expect(result.stderr).toContain('缺少账号文件')
      expect(result.stderr).toContain('bash scripts/qinglong.sh login')
      expect(result.stderr).not.toContain('ENOENT')
    }
    finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  }, 20000)
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
