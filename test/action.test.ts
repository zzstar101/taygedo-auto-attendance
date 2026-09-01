import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { runAction } from '../src/action.js'

describe('runAction', () => {
  const createApi = () => ({
    refreshToken: vi.fn().mockResolvedValue({ accessToken: 'access-main', refreshToken: 'new-main' }),
    getGameRoles: vi.fn().mockResolvedValue({ roles: [{ roleId: 'role-1', roleName: '角色一' }] }),
    appSignin: vi.fn().mockResolvedValue({ exp: 10, goldCoin: 20 }),
    getSigninState: vi.fn().mockResolvedValue({ days: 1 }),
    getSigninRewards: vi.fn().mockResolvedValue([{ name: '奖励一', num: 1 }]),
    gameSignin: vi.fn().mockResolvedValue(undefined),
  })

  it('resolves, writes updated accounts, and logs the output path when all accounts succeed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taygedo-action-'))
    const outputPath = join(dir, 'updated-accounts.json')
    const api = createApi()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      await runAction({
        env: {
          TAYGEDO_ACCOUNTS: JSON.stringify([
            {
              id: 'main',
              name: '主账号',
              uid: '1',
              deviceId: 'device-1',
              refreshToken: 'old-main',
            },
          ]),
          TAYGEDO_UPDATED_ACCOUNTS_PATH: outputPath,
        },
        api,
      })

      expect(JSON.parse(await readFile(outputPath, 'utf8'))).toEqual([
        {
          id: 'main',
          name: '主账号',
          uid: '1',
          deviceId: 'device-1',
          accessToken: 'access-main',
          refreshToken: 'new-main',
          tokenUpdatedAt: expect.any(String),
          roleId: 'role-1',
          roleName: '角色一',
        },
      ])
      expect(log).toHaveBeenCalledWith(`已写入更新后的账号文件：${outputPath}`)
    }
    finally {
      log.mockRestore()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects without creating an output file or claiming it was written when all accounts fail', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taygedo-action-failed-'))
    const outputPath = join(dir, 'updated-accounts.json')
    const api = {
      ...createApi(),
      refreshToken: vi.fn().mockRejectedValue(new Error('refresh failed')),
    }
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      await expect(runAction({
        env: {
          TAYGEDO_ACCOUNTS: JSON.stringify([
            {
              id: 'failed',
              name: '失败账号',
              uid: '2',
              deviceId: 'device-2',
              refreshToken: 'old-failed',
            },
          ]),
          TAYGEDO_UPDATED_ACCOUNTS_PATH: outputPath,
          TAYGEDO_MAX_RETRIES: '1',
        },
        api,
      })).rejects.toThrow(/失败账号数：1，总账号数：1/)

      await expect(readFile(outputPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
      expect(log).toHaveBeenCalledWith(`账号凭据无变化，未生成更新文件：${outputPath}`)
      expect(log).not.toHaveBeenCalledWith(`已写入更新后的账号文件：${outputPath}`)
    }
    finally {
      log.mockRestore()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects after writing refreshed credentials while retaining failed accounts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taygedo-action-partial-'))
    const outputPath = join(dir, 'updated-accounts.json')
    const api = {
      ...createApi(),
      refreshToken: vi.fn().mockImplementation(async (refreshToken: string) => {
        if (refreshToken === 'old-failed') {
          throw new Error('refresh failed')
        }
        return { accessToken: 'access-success', refreshToken: 'new-success' }
      }),
    }
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      await expect(runAction({
        env: {
          TAYGEDO_ACCOUNTS: JSON.stringify([
            {
              id: 'success',
              name: '成功账号',
              uid: '1',
              deviceId: 'device-1',
              refreshToken: 'old-success',
            },
            {
              id: 'failed',
              name: '失败账号',
              uid: '2',
              deviceId: 'device-2',
              refreshToken: 'old-failed',
            },
          ]),
          TAYGEDO_UPDATED_ACCOUNTS_PATH: outputPath,
          TAYGEDO_MAX_RETRIES: '1',
        },
        api,
      })).rejects.toThrow(/失败账号数：1，总账号数：2/)

      const updatedAccounts = JSON.parse(await readFile(outputPath, 'utf8'))
      expect(updatedAccounts).toEqual([
        expect.objectContaining({
          id: 'success',
          accessToken: 'access-success',
          refreshToken: 'new-success',
        }),
        {
          id: 'failed',
          name: '失败账号',
          uid: '2',
          deviceId: 'device-2',
          refreshToken: 'old-failed',
        },
      ])
      expect(log).toHaveBeenCalledWith(`已写入更新后的账号文件：${outputPath}`)
    }
    finally {
      log.mockRestore()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('sends notifications to Server Chan sendkey and existing webhook urls', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taygedo-action-'))
    const outputPath = join(dir, 'updated-accounts.json')
    const api = createApi()
    const fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    try {
      await runAction({
        env: {
          TAYGEDO_ACCOUNTS: JSON.stringify([
            {
              id: 'main',
              name: '主账号',
              uid: '1',
              deviceId: 'device-1',
              refreshToken: 'old-main',
            },
          ]),
          TAYGEDO_UPDATED_ACCOUNTS_PATH: outputPath,
          TAYGEDO_SERVERCHAN_SENDKEY: ' SCT123 ',
          TAYGEDO_NOTIFICATION_URLS: 'https://example.com/webhook',
        },
        api,
      })

      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        'https://example.com/webhook',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"content":"塔吉多每日签到结果'),
        }),
      )
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        'https://sctapi.ftqq.com/SCT123.send',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('desp='),
        }),
      )
    }
    finally {
      vi.unstubAllGlobals()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('prints a clear non-secret runtime configuration summary', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taygedo-action-config-summary-'))
    const outputPath = join(dir, 'updated-accounts.json')
    const api = createApi()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      await runAction({
        env: {
          TAYGEDO_ACCOUNTS: JSON.stringify([
            {
              id: 'main',
              name: '主账号',
              uid: '1',
              deviceId: 'device-1',
              refreshToken: 'old-main',
            },
          ]),
          TAYGEDO_UPDATED_ACCOUNTS_PATH: outputPath,
          TAYGEDO_COIN_TASKS: 'false',
          TAYGEDO_SHARE_PLATFORM: 'wb',
        },
        api,
      })

      expect(log).toHaveBeenCalledWith(expect.stringContaining('运行配置：金币任务=关闭，云异环=开启，分享平台=wb'))
    }
    finally {
      log.mockRestore()
      await rm(dir, { recursive: true, force: true })
    }
  })
})
