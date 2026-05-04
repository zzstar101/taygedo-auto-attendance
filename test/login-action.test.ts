import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { runLoginAction } from '../src/login-action.js'

describe('runLoginAction', () => {
  it('sends a captcha and writes the generated device id', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taygedo-login-send-'))
    const devicePath = join(dir, 'device-id.txt')
    const api = {
      sendCaptcha: vi.fn().mockResolvedValue(undefined),
      loginWithCaptcha: vi.fn(),
      userCenterLogin: vi.fn(),
      getBindRole: vi.fn(),
    }

    try {
      await runLoginAction({
        env: {
          TAYGEDO_LOGIN_MODE: 'send-code',
          TAYGEDO_LOGIN_PHONE: '13800138000',
          TAYGEDO_LOGIN_DEVICE_ID_PATH: devicePath,
        },
        api,
        generateDeviceId: () => 'device-generated',
      })

      expect(api.sendCaptcha).toHaveBeenCalledWith('13800138000', 'device-generated')
      expect(await readFile(devicePath, 'utf8')).toBe('device-generated\n')
    }
    finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('logs in with a captcha and appends the account to the updated accounts payload', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taygedo-login-accounts-'))
    const accountsPath = join(dir, 'updated-accounts.json')
    const api = {
      sendCaptcha: vi.fn(),
      loginWithCaptcha: vi.fn().mockResolvedValue({ token: 'laohu-token', userId: 'laohu-user' }),
      userCenterLogin: vi.fn().mockResolvedValue({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        uid: 'tjd-uid',
      }),
      getBindRole: vi.fn().mockResolvedValue({ roleId: 'role-1', roleName: '角色一' }),
    }

    try {
      await runLoginAction({
        env: {
          TAYGEDO_LOGIN_MODE: 'login',
          TAYGEDO_LOGIN_PHONE: '13800138000',
          TAYGEDO_LOGIN_CAPTCHA: '123456',
          TAYGEDO_LOGIN_DEVICE_ID: 'device-from-secret',
          TAYGEDO_LOGIN_ACCOUNT_ID: 'main',
          TAYGEDO_LOGIN_ACCOUNT_NAME: '主账号',
          TAYGEDO_ACCOUNTS: JSON.stringify([
            {
              id: 'alt',
              name: '小号',
              uid: 'old-uid',
              deviceId: 'old-device',
              refreshToken: 'old-token',
            },
          ]),
          TAYGEDO_LOGIN_UPDATED_ACCOUNTS_PATH: accountsPath,
        },
        api,
      })

      expect(api.loginWithCaptcha).toHaveBeenCalledWith('13800138000', '123456', 'device-from-secret')
      expect(api.userCenterLogin).toHaveBeenCalledWith('laohu-token', 'laohu-user', 'device-from-secret')
      expect(JSON.parse(await readFile(accountsPath, 'utf8'))).toEqual([
        {
          id: 'alt',
          name: '小号',
          uid: 'old-uid',
          deviceId: 'old-device',
          refreshToken: 'old-token',
        },
        {
          id: 'main',
          name: '主账号',
          uid: 'tjd-uid',
          deviceId: 'device-from-secret',
          refreshToken: 'refresh-token',
          roleId: 'role-1',
          roleName: '角色一',
        },
      ])
    }
    finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
