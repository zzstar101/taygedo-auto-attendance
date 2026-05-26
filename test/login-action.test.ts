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
      checkCaptcha: vi.fn(),
      loginWithCaptcha: vi.fn(),
      loginWithPassword: vi.fn(),
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
        generateDeviceIdentity: () => ({ deviceId: 'device-generated', openudid: 'OPEN-GENERATED', vendorid: 'VENDOR-GENERATED' }),
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
      checkCaptcha: vi.fn().mockResolvedValue(undefined),
      loginWithCaptcha: vi.fn().mockResolvedValue({ token: 'laohu-token', userId: 'laohu-user' }),
      loginWithPassword: vi.fn(),
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
          TAYGEDO_LOGIN_OPENUDID: 'OPEN-FROM-SECRET',
          TAYGEDO_LOGIN_VENDORID: 'VENDOR-FROM-SECRET',
          TAYGEDO_LOGIN_ACCOUNT_ID: 'main',
          TAYGEDO_LOGIN_ACCOUNT_NAME: '主账号',
          TAYGEDO_ACCOUNTS: JSON.stringify([
            {
              id: 'alt',
              name: '小号',
              uid: 'old-uid',
              deviceId: 'old-device',
              openudid: 'OPEN-OLD',
              vendorid: 'VENDOR-OLD',
              refreshToken: 'old-token',
            },
          ]),
          TAYGEDO_LOGIN_UPDATED_ACCOUNTS_PATH: accountsPath,
        },
        api,
      })

      expect(api.checkCaptcha).toHaveBeenCalledWith('13800138000', '123456', 'device-from-secret')
      expect(api.loginWithCaptcha).toHaveBeenCalledWith('13800138000', '123456', 'device-from-secret')
      expect(api.userCenterLogin).toHaveBeenCalledWith('laohu-token', 'laohu-user', 'device-from-secret')
      expect(JSON.parse(await readFile(accountsPath, 'utf8'))).toEqual([
        {
          id: 'alt',
          name: '小号',
          uid: 'old-uid',
          deviceId: 'old-device',
          openudid: 'OPEN-OLD',
          vendorid: 'VENDOR-OLD',
          refreshToken: 'old-token',
        },
        {
          id: 'main',
          name: '主账号',
          uid: 'tjd-uid',
          deviceId: 'device-from-secret',
          openudid: 'OPEN-FROM-SECRET',
          vendorid: 'VENDOR-FROM-SECRET',
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          laohuToken: 'laohu-token',
          laohuUserId: 'laohu-user',
          tokenUpdatedAt: expect.any(String),
          roleId: 'role-1',
          roleName: '角色一',
        },
      ])
    }
    finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('logs in with a password without storing the plaintext password', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taygedo-login-password-'))
    const accountsPath = join(dir, 'updated-accounts.json')
    const api = {
      sendCaptcha: vi.fn(),
      checkCaptcha: vi.fn(),
      loginWithCaptcha: vi.fn(),
      loginWithPassword: vi.fn().mockResolvedValue({ token: 'laohu-token', userId: 'laohu-user' }),
      userCenterLogin: vi.fn().mockResolvedValue({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        uid: 'tjd-uid',
      }),
      getBindRole: vi.fn().mockResolvedValue({}),
    }

    try {
      await runLoginAction({
        env: {
          TAYGEDO_LOGIN_MODE: 'password',
          TAYGEDO_LOGIN_PHONE: '13800138000',
          TAYGEDO_LOGIN_PASSWORD: 'secret-password',
          TAYGEDO_LOGIN_ACCOUNT_ID: 'main',
          TAYGEDO_LOGIN_ACCOUNT_NAME: '主账号',
          TAYGEDO_LOGIN_UPDATED_ACCOUNTS_PATH: accountsPath,
        },
        api,
        generateDeviceIdentity: () => ({ deviceId: 'device-generated', openudid: 'OPEN-GENERATED', vendorid: 'VENDOR-GENERATED' }),
      })

      expect(api.checkCaptcha).not.toHaveBeenCalled()
      expect(api.loginWithCaptcha).not.toHaveBeenCalled()
      expect(api.loginWithPassword).toHaveBeenCalledWith('13800138000', 'secret-password', 'device-generated')
      expect(api.userCenterLogin).toHaveBeenCalledWith('laohu-token', 'laohu-user', 'device-generated')
      expect(JSON.parse(await readFile(accountsPath, 'utf8'))).toEqual([
        {
          id: 'main',
          name: '主账号',
          uid: 'tjd-uid',
          deviceId: 'device-generated',
          openudid: 'OPEN-GENERATED',
          vendorid: 'VENDOR-GENERATED',
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          laohuToken: 'laohu-token',
          laohuUserId: 'laohu-user',
          tokenUpdatedAt: expect.any(String),
          phone: '13800138000',
        },
      ])
    }
    finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('writes tokenUpdatedAt using Asia/Shanghai offset', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taygedo-login-shanghai-time-'))
    const accountsPath = join(dir, 'updated-accounts.json')
    const api = {
      sendCaptcha: vi.fn(),
      checkCaptcha: vi.fn(),
      loginWithCaptcha: vi.fn(),
      loginWithPassword: vi.fn().mockResolvedValue({ token: 'laohu-token', userId: 'laohu-user' }),
      userCenterLogin: vi.fn().mockResolvedValue({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        uid: 'tjd-uid',
      }),
      getBindRole: vi.fn().mockResolvedValue({}),
    }

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-25T18:30:00.000Z'))
    try {
      await runLoginAction({
        env: {
          TAYGEDO_LOGIN_MODE: 'password',
          TAYGEDO_LOGIN_PHONE: '13800138000',
          TAYGEDO_LOGIN_PASSWORD: 'secret-password',
          TAYGEDO_LOGIN_ACCOUNT_ID: 'main',
          TAYGEDO_LOGIN_UPDATED_ACCOUNTS_PATH: accountsPath,
        },
        api,
        generateDeviceIdentity: () => ({ deviceId: 'device-generated', openudid: 'OPEN-GENERATED', vendorid: 'VENDOR-GENERATED' }),
      })

      expect(JSON.parse(await readFile(accountsPath, 'utf8'))[0].tokenUpdatedAt).toBe('2026-05-26T02:30:00+08:00')
    }
    finally {
      vi.useRealTimers()
      await rm(dir, { recursive: true, force: true })
    }
  })


  it('encrypts the password when a credential key is configured', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taygedo-login-encrypted-password-'))
    const accountsPath = join(dir, 'updated-accounts.json')
    const api = {
      sendCaptcha: vi.fn(),
      checkCaptcha: vi.fn(),
      loginWithCaptcha: vi.fn(),
      loginWithPassword: vi.fn().mockResolvedValue({ token: 'laohu-token', userId: 'laohu-user' }),
      userCenterLogin: vi.fn().mockResolvedValue({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        uid: 'tjd-uid',
      }),
      getBindRole: vi.fn().mockResolvedValue({}),
    }

    try {
      await runLoginAction({
        env: {
          TAYGEDO_LOGIN_MODE: 'password',
          TAYGEDO_LOGIN_PHONE: '13800138000',
          TAYGEDO_LOGIN_PASSWORD: 'secret-password',
          TAYGEDO_LOGIN_ACCOUNT_ID: 'main',
          TAYGEDO_LOGIN_ACCOUNT_NAME: '主账号',
          TAYGEDO_CREDENTIAL_KEY: 'test-credential-key',
          TAYGEDO_LOGIN_UPDATED_ACCOUNTS_PATH: accountsPath,
        },
        api,
        generateDeviceIdentity: () => ({ deviceId: 'device-generated', openudid: 'OPEN-GENERATED', vendorid: 'VENDOR-GENERATED' }),
      })

      const payload = await readFile(accountsPath, 'utf8')
      const account = JSON.parse(payload)[0]
      expect(payload).not.toContain('secret-password')
      expect(account.encryptedPassword).toEqual(expect.objectContaining({
        v: 1,
        alg: 'AES-256-GCM',
        iv: expect.any(String),
        tag: expect.any(String),
        data: expect.any(String),
      }))
    }
    finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('generates a credential key file when password login has no configured key', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taygedo-login-generated-key-'))
    const accountsPath = join(dir, 'updated-accounts.json')
    const credentialKeyPath = join(dir, 'credential-key.txt')
    const api = {
      sendCaptcha: vi.fn(),
      checkCaptcha: vi.fn(),
      loginWithCaptcha: vi.fn(),
      loginWithPassword: vi.fn().mockResolvedValue({ token: 'laohu-token', userId: 'laohu-user' }),
      userCenterLogin: vi.fn().mockResolvedValue({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        uid: 'tjd-uid',
      }),
      getBindRole: vi.fn().mockResolvedValue({}),
    }

    try {
      await runLoginAction({
        env: {
          TAYGEDO_LOGIN_MODE: 'password',
          TAYGEDO_LOGIN_PHONE: '13800138000',
          TAYGEDO_LOGIN_PASSWORD: 'secret-password',
          TAYGEDO_LOGIN_ACCOUNT_ID: 'main',
          TAYGEDO_LOGIN_UPDATED_ACCOUNTS_PATH: accountsPath,
          TAYGEDO_CREDENTIAL_KEY_PATH: credentialKeyPath,
        },
        api,
        generateDeviceIdentity: () => ({ deviceId: 'device-generated', openudid: 'OPEN-GENERATED', vendorid: 'VENDOR-GENERATED' }),
      })

      expect((await readFile(credentialKeyPath, 'utf8')).trim()).not.toBe('')
      const payload = await readFile(accountsPath, 'utf8')
      expect(payload).not.toContain('secret-password')
      expect(JSON.parse(payload)[0].encryptedPassword).toBeDefined()
    }
    finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('forces a new device identity for password login when requested', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taygedo-login-new-device-'))
    const accountsPath = join(dir, 'updated-accounts.json')
    const api = {
      sendCaptcha: vi.fn(),
      checkCaptcha: vi.fn(),
      loginWithCaptcha: vi.fn(),
      loginWithPassword: vi.fn().mockResolvedValue({ token: 'laohu-token', userId: 'laohu-user' }),
      userCenterLogin: vi.fn().mockResolvedValue({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        uid: 'tjd-uid',
      }),
      getBindRole: vi.fn().mockResolvedValue({}),
    }

    try {
      await runLoginAction({
        env: {
          TAYGEDO_LOGIN_MODE: 'password',
          TAYGEDO_LOGIN_PHONE: '13800138000',
          TAYGEDO_LOGIN_PASSWORD: 'secret-password',
          TAYGEDO_LOGIN_DEVICE_ID: 'old-device',
          TAYGEDO_LOGIN_OPENUDID: 'OPEN-OLD',
          TAYGEDO_LOGIN_VENDORID: 'VENDOR-OLD',
          TAYGEDO_LOGIN_NEW_DEVICE: 'true',
          TAYGEDO_LOGIN_ACCOUNT_ID: 'main',
          TAYGEDO_LOGIN_UPDATED_ACCOUNTS_PATH: accountsPath,
        },
        api,
        generateDeviceIdentity: () => ({ deviceId: 'new-device', openudid: 'OPEN-NEW', vendorid: 'VENDOR-NEW' }),
      })

      expect(api.loginWithPassword).toHaveBeenCalledWith('13800138000', 'secret-password', 'new-device')
      expect(JSON.parse(await readFile(accountsPath, 'utf8'))[0]).toEqual(expect.objectContaining({
        deviceId: 'new-device',
        openudid: 'OPEN-NEW',
        vendorid: 'VENDOR-NEW',
      }))
    }
    finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('requires a stored device id when logging in with a captcha', async () => {
    const api = {
      sendCaptcha: vi.fn(),
      checkCaptcha: vi.fn(),
      loginWithCaptcha: vi.fn(),
      loginWithPassword: vi.fn(),
      userCenterLogin: vi.fn(),
      getBindRole: vi.fn(),
    }

    await expect(runLoginAction({
      env: {
        TAYGEDO_LOGIN_MODE: 'login',
        TAYGEDO_LOGIN_PHONE: '13800138000',
        TAYGEDO_LOGIN_CAPTCHA: '123456',
        TAYGEDO_LOGIN_ACCOUNT_ID: 'main',
      },
      api,
      generateDeviceId: () => 'unexpected-device',
    })).rejects.toThrow('缺少必需环境变量 TAYGEDO_LOGIN_DEVICE_ID')

    expect(api.checkCaptcha).not.toHaveBeenCalled()
  })
})
