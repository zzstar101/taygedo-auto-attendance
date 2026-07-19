import { describe, expect, it, vi } from 'vitest'
import worker, { constantTimeTokenMatches } from '../src/runtimes/cloudflare-worker.js'

type ScheduledController = Record<string, unknown>
type ExecutionContext = Record<string, unknown>

describe('cloudflare worker runtime', () => {
  it('runs attendance from scheduled events and stores the latest summary', async () => {
    const kv = new Map<string, string>()
    kv.set('TAYGEDO_ACCOUNTS', JSON.stringify([
      { id: 'main', name: '主账号', uid: '1', deviceId: 'device-1', refreshToken: 'refresh' },
    ]))
    const env = createEnv(kv)

    await worker.scheduled({} as ScheduledController, env, {} as ExecutionContext)

    expect(kv.get('taygedo:last-summary')).toContain('塔吉多每日签到结果')
  })

  it('requires an admin token for manual trigger', async () => {
    const env = createEnv(new Map(), { TAYGEDO_ADMIN_TOKEN: 'secret' })

    const denied = await worker.fetch(new Request('https://example.com/run'), env, {} as ExecutionContext)
    const allowed = await worker.fetch(new Request('https://example.com/run', {
      headers: { Authorization: 'Bearer secret' },
    }), env, {} as ExecutionContext)

    expect(denied.status).toBe(401)
    expect(allowed.status).toBe(200)
  })

  it('compares admin tokens without short-circuiting on the first mismatch', () => {
    const expected = 'Bearer secret'

    expect(constantTimeTokenMatches(expected, 'Bearer secret')).toBe(true)
    expect(constantTimeTokenMatches(expected, 'Bearer secreu')).toBe(false)
    expect(constantTimeTokenMatches(expected, 'Bearer x')).toBe(false)
    expect(constantTimeTokenMatches(expected, null)).toBe(false)
  })

  it('force runs manual attendance from the query string', async () => {
    const kv = new Map<string, string>()
    const env = createEnv(kv, { TAYGEDO_ADMIN_TOKEN: 'secret' })
    kv.set('taygedo:attendance:main:2026-05-26', JSON.stringify({ status: 'success' }))

    const response = await worker.fetch(new Request('https://example.com/run?force=1', {
      headers: { Authorization: 'Bearer secret' },
    }), env, {} as ExecutionContext)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(expect.objectContaining({
      ok: true,
      forceRun: true,
    }))
    expect(env.TAYGEDO_TEST_API.refreshToken).toHaveBeenCalled()
  })

  it('logs in with a password through a protected endpoint and stores accounts without plaintext password', async () => {
    const kv = new Map<string, string>()
    const env = createEnv(kv, { TAYGEDO_ADMIN_TOKEN: 'secret', TAYGEDO_CREDENTIAL_KEY: 'test-credential-key' })

    const denied = await worker.fetch(new Request('https://example.com/login', {
      method: 'POST',
      body: JSON.stringify({
        mode: 'password',
        phone: '13800138000',
        password: 'secret-password',
        accountId: 'main',
        accountName: '主账号',
      }),
    }), env, {} as ExecutionContext)
    const allowed = await worker.fetch(new Request('https://example.com/login', {
      method: 'POST',
      headers: { Authorization: 'Bearer secret' },
      body: JSON.stringify({
        mode: 'password',
        phone: '13800138000',
        password: 'secret-password',
        accountId: 'main',
        accountName: '主账号',
      }),
    }), env, {} as ExecutionContext)

    expect(denied.status).toBe(401)
    expect(allowed.status).toBe(200)
    expect(kv.get('TAYGEDO_ACCOUNTS')).toBeDefined()
    expect(kv.get('TAYGEDO_ACCOUNTS')).not.toContain('secret-password')
    expect(JSON.parse(kv.get('TAYGEDO_ACCOUNTS') ?? '[]')[0].encryptedPassword).toBeDefined()
  })

  it('rejects password login without a credential key on Cloudflare', async () => {
    const env = createEnv(new Map(), { TAYGEDO_ADMIN_TOKEN: 'secret' })

    const response = await worker.fetch(new Request('https://example.com/login', {
      method: 'POST',
      headers: { Authorization: 'Bearer secret' },
      body: JSON.stringify({
        mode: 'password',
        phone: '13800138000',
        password: 'secret-password',
        accountId: 'main',
      }),
    }), env, {} as ExecutionContext)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual(expect.objectContaining({
      error: expect.stringContaining('TAYGEDO_CREDENTIAL_KEY'),
    }))
  })

  it('rejects invalid Cloudflare login request fields before calling the login service', async () => {
    const kv = new Map<string, string>()
    const env = createEnv(kv, { TAYGEDO_ADMIN_TOKEN: 'secret', TAYGEDO_CREDENTIAL_KEY: 'test-credential-key' })

    const response = await worker.fetch(new Request('https://example.com/login', {
      method: 'POST',
      headers: { Authorization: 'Bearer secret' },
      body: JSON.stringify({
        mode: 'password',
        phone: 'not-a-phone',
        password: 'secret-password',
        accountId: '../main',
      }),
    }), env, {} as ExecutionContext)

    expect(response.status).toBe(400)
    expect(env.TAYGEDO_TEST_LOGIN_API.loginWithPassword).not.toHaveBeenCalled()
  })

  it('returns upstream login failures as JSON instead of throwing a Worker exception', async () => {
    const env = createEnv(new Map(), { TAYGEDO_ADMIN_TOKEN: 'secret', TAYGEDO_CREDENTIAL_KEY: 'test-credential-key' })
    env.TAYGEDO_TEST_LOGIN_API.loginWithPassword.mockRejectedValueOnce(new Error('系统错误'))

    const response = await worker.fetch(new Request('https://example.com/login', {
      method: 'POST',
      headers: { Authorization: 'Bearer secret' },
      body: JSON.stringify({
        mode: 'password',
        phone: '13800138000',
        password: 'secret-password',
        accountId: 'main',
      }),
    }), env, {} as ExecutionContext)

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: '系统错误' })
  })

  it('treats Cloudflare login without mode as password login when checking credential key', async () => {
    const env = createEnv(new Map(), { TAYGEDO_ADMIN_TOKEN: 'secret' })

    const response = await worker.fetch(new Request('https://example.com/login', {
      method: 'POST',
      headers: { Authorization: 'Bearer secret' },
      body: JSON.stringify({
        phone: '13800138000',
        password: 'secret-password',
        accountId: 'main',
      }),
    }), env, {} as ExecutionContext)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual(expect.objectContaining({
      error: expect.stringContaining('TAYGEDO_CREDENTIAL_KEY'),
    }))
  })

  it('serves a Cloudflare-only login page from the root path', async () => {
    const env = createEnv(new Map(), { TAYGEDO_ADMIN_TOKEN: 'secret' })

    const response = await worker.fetch(new Request('https://example.com/'), env, {} as ExecutionContext)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    const html = await response.text()
    expect(html).toContain('塔吉多登录')
    expect(html).toContain('password')
    expect(html).toContain('value="captcha"')
    expect(html).toContain('id="send-code"')
    expect(html).not.toContain('value="send-code"')
    expect(html).not.toContain('value="login"')
    expect(html).not.toContain('name="deviceId"')
  })

  it('keeps one device id across the integrated captcha login flow', async () => {
    const kv = new Map<string, string>()
    const env = createEnv(kv, { TAYGEDO_ADMIN_TOKEN: 'secret' })

    const sendResponse = await worker.fetch(new Request('https://example.com/login', {
      method: 'POST',
      headers: { Authorization: 'Bearer secret' },
      body: JSON.stringify({
        mode: 'send-code',
        phone: '13800138000',
        accountId: 'main',
      }),
    }), env, {} as ExecutionContext)
    const sent = await sendResponse.json() as { deviceId?: string }

    expect(sendResponse.status).toBe(200)
    expect(sent.deviceId).toEqual(expect.any(String))
    expect(env.TAYGEDO_TEST_LOGIN_API.sendCaptcha).toHaveBeenCalledWith('13800138000', sent.deviceId)

    const loginResponse = await worker.fetch(new Request('https://example.com/login', {
      method: 'POST',
      headers: { Authorization: 'Bearer secret' },
      body: JSON.stringify({
        mode: 'login',
        phone: '13800138000',
        captcha: '123456',
        deviceId: sent.deviceId,
        accountId: 'main',
        accountName: '主账号',
      }),
    }), env, {} as ExecutionContext)

    expect(loginResponse.status).toBe(200)
    expect(env.TAYGEDO_TEST_LOGIN_API.checkCaptcha).not.toHaveBeenCalled()
    expect(env.TAYGEDO_TEST_LOGIN_API.loginWithCaptcha).toHaveBeenCalledWith('13800138000', '123456', sent.deviceId)
    expect(JSON.parse(kv.get('TAYGEDO_ACCOUNTS') ?? '[]')[0]).toEqual(expect.objectContaining({
      id: 'main',
      deviceId: sent.deviceId,
    }))
  })

  it('passes the new-device flag from Cloudflare login requests', async () => {
    const kv = new Map<string, string>()
    const env = createEnv(kv, { TAYGEDO_ADMIN_TOKEN: 'secret', TAYGEDO_CREDENTIAL_KEY: 'test-credential-key' })

    const response = await worker.fetch(new Request('https://example.com/login', {
      method: 'POST',
      headers: { Authorization: 'Bearer secret' },
      body: JSON.stringify({
        mode: 'password',
        phone: '13800138000',
        password: 'secret-password',
        accountId: 'main',
        newDevice: true,
      }),
    }), env, {} as ExecutionContext)

    expect(response.status).toBe(200)
    expect(JSON.parse(kv.get('TAYGEDO_ACCOUNTS') ?? '[]')[0].deviceId).not.toBe('device-1')
  })

  it('does not expose management APIs beyond login on Cloudflare', async () => {
    const env = createEnv(new Map(), { TAYGEDO_ADMIN_TOKEN: 'secret' })

    const response = await worker.fetch(new Request('https://example.com/api/accounts', {
      headers: { Authorization: 'Bearer secret' },
    }), env, {} as ExecutionContext)

    expect(response.status).toBe(404)
  })
})

function createEnv(kv: Map<string, string>, overrides: Partial<Record<string, string>> = {}) {
  const api = {
    refreshToken: vi.fn().mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh-new', uid: '1' }),
    getGameRoles: vi.fn()
      .mockResolvedValueOnce({ roles: [{ roleId: 'role-1', roleName: '角色一' }] })
      .mockResolvedValue({ roles: [] }),
    appSignin: vi.fn().mockResolvedValue({ exp: 10, goldCoin: 20 }),
    getSigninState: vi.fn().mockResolvedValue({ days: 1 }),
    getSigninRewards: vi.fn().mockResolvedValue([{ name: '奖励一', num: 1 }]),
    gameSignin: vi.fn().mockResolvedValue(undefined),
    sendCaptcha: vi.fn().mockResolvedValue(undefined),
    checkCaptcha: vi.fn().mockResolvedValue(undefined),
    loginWithCaptcha: vi.fn().mockResolvedValue({ token: 'laohu-token', userId: 'laohu-user' }),
    loginWithPassword: vi.fn().mockResolvedValue({ token: 'laohu-token', userId: 'laohu-user' }),
    userCenterLogin: vi.fn().mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh-new', uid: '1' }),
    getBindRole: vi.fn().mockResolvedValue({ roleId: 'role-1', roleName: '角色一' }),
  }
  return {
    KV: {
      get: vi.fn(async (key: string) => kv.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => { kv.set(key, value) }),
    },
    TAYGEDO_TEST_API: api,
    TAYGEDO_TEST_LOGIN_API: api,
    TAYGEDO_ACCOUNTS: JSON.stringify([
      { id: 'main', name: '主账号', uid: '1', deviceId: 'device-1', refreshToken: 'refresh' },
    ]),
    ...overrides,
  }
}
