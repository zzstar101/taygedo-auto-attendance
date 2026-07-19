import { describe, expect, it, vi } from 'vitest'
import { runAttendance } from '../src/runner.js'
import { encryptPassword } from '../src/config/credentials.js'
import { MemoryStateStore } from '../src/stores/state-store.js'
import { TaygedoApi } from '../src/taygedo/api.js'

describe('runAttendance', () => {
  const shanghaiNoon = new Date('2026-05-26T04:00:00.000Z')

  it('keeps failed account refresh tokens unchanged in the updated secret payload', async () => {
    const secretWriter = vi.fn()
    const api = {
      refreshToken: vi.fn()
        .mockResolvedValueOnce({ accessToken: 'access-main', refreshToken: 'new-main' })
        .mockRejectedValueOnce(new Error('expired')),
      getGameRoles: vi.fn().mockResolvedValue({ roles: [{ roleId: 'role-1', roleName: '角色一' }] }),
      appSignin: vi.fn().mockResolvedValue({ exp: 10, goldCoin: 20 }),
      getSigninState: vi.fn().mockResolvedValue({ days: 1 }),
      getSigninRewards: vi.fn().mockResolvedValue([{ name: '奖励一', num: 1 }]),
      gameSignin: vi.fn().mockResolvedValue(undefined),
    }

    const result = await runAttendance({
      accountsSecret: JSON.stringify([
        {
          id: 'main',
          name: '主账号',
          uid: '1',
          deviceId: 'device-1',
          refreshToken: 'old-main',
        },
        {
          id: 'alt',
          name: '备用账号',
          uid: '2',
          deviceId: 'device-2',
          refreshToken: 'old-alt',
        },
      ]),
      api,
      notificationUrls: [],
      maxRetries: 1,
      secretWriter,
    })

    expect(result.updatedAccounts).toEqual([
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
      {
        id: 'alt',
        name: '备用账号',
        uid: '2',
        deviceId: 'device-2',
        refreshToken: 'old-alt',
      },
    ])
    expect(secretWriter).toHaveBeenCalledWith(JSON.stringify(result.updatedAccounts, null, 2))
  })

  it('does not write the secret when every account fails before refresh completes', async () => {
    const secretWriter = vi.fn()
    const api = {
      refreshToken: vi.fn().mockRejectedValue(new Error('expired')),
      getGameRoles: vi.fn(),
      appSignin: vi.fn(),
      getSigninState: vi.fn(),
      getSigninRewards: vi.fn(),
      gameSignin: vi.fn(),
    }

    await runAttendance({
      accountsSecret: JSON.stringify([
        {
          id: 'main',
          name: '主账号',
          uid: '1',
          deviceId: 'device-1',
          refreshToken: 'old-main',
        },
      ]),
      api,
      secretWriter,
    })

    expect(secretWriter).not.toHaveBeenCalled()
  })

  it('uses a stored accessToken without refreshing or writing the secret', async () => {
    const secretWriter = vi.fn()
    const api = {
      refreshToken: vi.fn(),
      userCenterLogin: vi.fn(),
      getGameRoles: vi.fn()
        .mockResolvedValueOnce({ roles: [{ roleId: 'role-1256-a', roleName: '幻塔A' }] })
        .mockResolvedValueOnce({ roles: [] })
        .mockResolvedValueOnce({ roles: [] }),
      appSignin: vi.fn().mockResolvedValue({ exp: 10, goldCoin: 20 }),
      getSigninState: vi.fn().mockResolvedValue({ days: 1 }),
      getSigninRewards: vi.fn().mockResolvedValue([{ name: '奖励一', num: 1 }]),
      gameSignin: vi.fn().mockResolvedValue(undefined),
    }

    const result = await runAttendance({
      accountsSecret: JSON.stringify([
        {
          id: 'main',
          name: '主账号',
          uid: '1',
          deviceId: 'device-1',
          accessToken: 'stored-access',
          refreshToken: 'old-main',
        },
      ]),
      api,
      maxRetries: 1,
      secretWriter,
    })

    expect(api.refreshToken).not.toHaveBeenCalled()
    expect(api.getGameRoles).toHaveBeenNthCalledWith(1, 'stored-access', '1', 'device-1', '1256')
    expect(api.appSignin).toHaveBeenCalledWith('stored-access', '1', 'device-1')
    expect(api.gameSignin).toHaveBeenCalledWith('stored-access', 'role-1256-a', '1256')
    expect(secretWriter).not.toHaveBeenCalled()
    expect(result.updatedAccounts[0]?.refreshToken).toBe('old-main')
  })

  it('runs accounts concurrently while preserving result order', async () => {
    let activeAccounts = 0
    let maxActiveAccounts = 0
    const api = {
      refreshToken: vi.fn(async (refreshToken: string) => {
        activeAccounts++
        maxActiveAccounts = Math.max(maxActiveAccounts, activeAccounts)
        await Promise.resolve()
        activeAccounts--
        return { accessToken: `access-${refreshToken}`, refreshToken: `new-${refreshToken}` }
      }),
      getGameRoles: vi.fn().mockResolvedValue({ roles: [] }),
      appSignin: vi.fn().mockResolvedValue({ exp: 10, goldCoin: 20 }),
      getSigninState: vi.fn(),
      getSigninRewards: vi.fn(),
      gameSignin: vi.fn(),
    }

    const result = await runAttendance({
      accountsSecret: JSON.stringify([
        { id: 'main', name: '主账号', uid: '1', deviceId: 'device-1', refreshToken: 'main' },
        { id: 'alt', name: '备用账号', uid: '2', deviceId: 'device-2', refreshToken: 'alt' },
      ]),
      api,
      maxRetries: 1,
      accountConcurrency: 2,
    })

    expect(maxActiveAccounts).toBe(2)
    expect(result.accounts.map(account => account.id)).toEqual(['main', 'alt'])
    expect(result.updatedAccounts.map(account => account.id)).toEqual(['main', 'alt'])
  })

  it('loads game roles for configured games concurrently', async () => {
    let activeRoleLookups = 0
    let maxActiveRoleLookups = 0
    const api = {
      refreshToken: vi.fn().mockResolvedValue({ accessToken: 'access-main', refreshToken: 'new-main' }),
      getGameRoles: vi.fn(async (accessToken: string, uid: string, deviceId: string, gameId: string) => {
        activeRoleLookups++
        maxActiveRoleLookups = Math.max(maxActiveRoleLookups, activeRoleLookups)
        await new Promise(resolve => setTimeout(resolve, 5))
        activeRoleLookups--
        return { roles: [{ roleId: `role-${gameId}`, roleName: `角色${gameId}` }] }
      }),
      appSignin: vi.fn().mockResolvedValue({ exp: 10, goldCoin: 20 }),
      getSigninState: vi.fn().mockResolvedValue({ days: 1 }),
      getSigninRewards: vi.fn().mockResolvedValue([{ name: '奖励一', num: 1 }]),
      gameSignin: vi.fn().mockResolvedValue(undefined),
    }

    const result = await runAttendance({
      accountsSecret: JSON.stringify([
        { id: 'main', name: '主账号', uid: '1', deviceId: 'device-1', refreshToken: 'old-main' },
      ]),
      api,
      maxRetries: 1,
    })

    expect(api.getGameRoles).toHaveBeenCalledTimes(3)
    expect(maxActiveRoleLookups).toBe(3)
    expect(result.accounts[0]?.gameSignins).toHaveLength(3)
  })

  it('runs game signin work for multiple roles concurrently', async () => {
    let activeStateLookups = 0
    let maxActiveStateLookups = 0
    const api = {
      refreshToken: vi.fn().mockResolvedValue({ accessToken: 'access-main', refreshToken: 'new-main' }),
      getGameRoles: vi.fn()
        .mockResolvedValueOnce({ roles: [{ roleId: 'role-1256', roleName: '角色1256' }] })
        .mockResolvedValueOnce({ roles: [{ roleId: 'role-1257', roleName: '角色1257' }] })
        .mockResolvedValueOnce({ roles: [{ roleId: 'role-1289', roleName: '角色1289' }] }),
      appSignin: vi.fn().mockResolvedValue({ exp: 10, goldCoin: 20 }),
      getSigninState: vi.fn(async () => {
        activeStateLookups++
        maxActiveStateLookups = Math.max(maxActiveStateLookups, activeStateLookups)
        await new Promise(resolve => setTimeout(resolve, 5))
        activeStateLookups--
        return { days: 1 }
      }),
      getSigninRewards: vi.fn().mockResolvedValue([{ name: '奖励一', num: 1 }]),
      gameSignin: vi.fn().mockResolvedValue(undefined),
    }

    const result = await runAttendance({
      accountsSecret: JSON.stringify([
        { id: 'main', name: '主账号', uid: '1', deviceId: 'device-1', refreshToken: 'old-main' },
      ]),
      api,
      maxRetries: 1,
    })

    expect(maxActiveStateLookups).toBe(3)
    expect(result.accounts[0]?.gameSignins.map(item => item.gameId)).toEqual(['1256', '1257', '1289'])
  })

  it('refreshes and writes tokens only after the stored accessToken is rejected', async () => {
    const secretWriter = vi.fn()
    const api = {
      refreshToken: vi.fn().mockResolvedValue({ accessToken: 'new-access', refreshToken: 'new-refresh', uid: '1' }),
      userCenterLogin: vi.fn(),
      getGameRoles: mockGameRolesAfterAuthExpired(),
      appSignin: vi.fn().mockResolvedValue({ exp: 10, goldCoin: 20 }),
      getSigninState: vi.fn().mockResolvedValue({ days: 1 }),
      getSigninRewards: vi.fn().mockResolvedValue([{ name: '奖励一', num: 1 }]),
      gameSignin: vi.fn().mockResolvedValue(undefined),
    }

    const result = await runAttendance({
      accountsSecret: JSON.stringify([
        {
          id: 'main',
          name: '主账号',
          uid: '1',
          deviceId: 'device-1',
          accessToken: 'stored-access',
          refreshToken: 'old-main',
        },
      ]),
      api,
      maxRetries: 1,
      secretWriter,
    })

    expect(api.refreshToken).toHaveBeenCalledWith('old-main', 'device-1')
    expect(result.updatedAccounts[0]).toEqual(expect.objectContaining({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      tokenUpdatedAt: expect.any(String),
    }))
    expect(secretWriter).toHaveBeenCalledWith(JSON.stringify(result.updatedAccounts, null, 2))
  })

  it('rebuilds the usercenter session from laohu credentials when refresh is rejected', async () => {
    const secretWriter = vi.fn()
    const api = {
      refreshToken: vi.fn().mockRejectedValue(new Error('REFRESH_REJECTED_402: refreshToken 已失效，请重新登录')),
      userCenterLogin: vi.fn().mockResolvedValue({ accessToken: 'rebuilt-access', refreshToken: 'rebuilt-refresh', uid: '1' }),
      getGameRoles: mockGameRolesAfterAuthExpired(),
      appSignin: vi.fn().mockResolvedValue({ exp: 10, goldCoin: 20 }),
      getSigninState: vi.fn().mockResolvedValue({ days: 1 }),
      getSigninRewards: vi.fn().mockResolvedValue([{ name: '奖励一', num: 1 }]),
      gameSignin: vi.fn().mockResolvedValue(undefined),
    }

    const result = await runAttendance({
      accountsSecret: JSON.stringify([
        {
          id: 'main',
          name: '主账号',
          uid: '1',
          deviceId: 'device-1',
          accessToken: 'stored-access',
          refreshToken: 'old-main',
          laohuToken: 'laohu-token',
          laohuUserId: 'laohu-user',
        },
      ]),
      api,
      maxRetries: 1,
      secretWriter,
    })

    expect(api.userCenterLogin).toHaveBeenCalledWith('laohu-token', 'laohu-user', 'device-1')
    expect(result.updatedAccounts[0]).toEqual(expect.objectContaining({
      accessToken: 'rebuilt-access',
      refreshToken: 'rebuilt-refresh',
      laohuToken: 'laohu-token',
      laohuUserId: 'laohu-user',
      tokenUpdatedAt: expect.any(String),
    }))
    expect(secretWriter).toHaveBeenCalledWith(JSON.stringify(result.updatedAccounts, null, 2))
  })

  it('uses an environment password before refresh when the stored accessToken is rejected', async () => {
    const secretWriter = vi.fn()
    const api = {
      loginWithPassword: vi.fn().mockResolvedValue({ token: 'new-laohu-token', userId: 'new-laohu-user' }),
      refreshToken: vi.fn(),
      userCenterLogin: vi.fn().mockResolvedValue({ accessToken: 'password-access', refreshToken: 'password-refresh', uid: '1' }),
      getGameRoles: mockGameRolesAfterAuthExpired(),
      appSignin: vi.fn().mockResolvedValue({ exp: 10, goldCoin: 20 }),
      getSigninState: vi.fn().mockResolvedValue({ days: 1 }),
      getSigninRewards: vi.fn().mockResolvedValue([{ name: '奖励一', num: 1 }]),
      gameSignin: vi.fn().mockResolvedValue(undefined),
    }

    const result = await runAttendance({
      accountsSecret: JSON.stringify([
        {
          id: 'main',
          name: '主账号',
          uid: '1',
          deviceId: 'device-1',
          accessToken: 'stored-access',
          refreshToken: 'old-main',
          phone: '13800138000',
        },
      ]),
      api,
      accountPasswords: {
        main: 'secret-password',
      },
      maxRetries: 1,
      secretWriter,
    })

    expect(api.loginWithPassword).toHaveBeenCalledWith('13800138000', 'secret-password', 'device-1', {
      openudid: undefined,
      vendorid: undefined,
    })
    expect(api.userCenterLogin).toHaveBeenCalledWith('new-laohu-token', 'new-laohu-user', 'device-1')
    expect(api.refreshToken).not.toHaveBeenCalled()
    expect(result.updatedAccounts[0]).toEqual(expect.objectContaining({
      accessToken: 'password-access',
      refreshToken: 'password-refresh',
      laohuToken: 'new-laohu-token',
      laohuUserId: 'new-laohu-user',
      phone: '13800138000',
      tokenUpdatedAt: expect.any(String),
    }))
    expect(secretWriter).toHaveBeenCalledWith(JSON.stringify(result.updatedAccounts, null, 2))
  })

  it('uses an encrypted account password before refresh when a credential key is configured', async () => {
    const credentialKey = 'test-credential-key'
    const api = {
      loginWithPassword: vi.fn().mockResolvedValue({ token: 'new-laohu-token', userId: 'new-laohu-user' }),
      refreshToken: vi.fn(),
      userCenterLogin: vi.fn().mockResolvedValue({ accessToken: 'password-access', refreshToken: 'password-refresh', uid: '1' }),
      getGameRoles: mockGameRolesAfterAuthExpired(),
      appSignin: vi.fn().mockResolvedValue({ exp: 10, goldCoin: 20 }),
      getSigninState: vi.fn().mockResolvedValue({ days: 1 }),
      getSigninRewards: vi.fn().mockResolvedValue([{ name: '奖励一', num: 1 }]),
      gameSignin: vi.fn().mockResolvedValue(undefined),
    }

    await runAttendance({
      accountsSecret: JSON.stringify([
        {
          id: 'main',
          name: '主账号',
          uid: '1',
          deviceId: 'device-1',
          accessToken: 'stored-access',
          refreshToken: 'old-main',
          phone: '13800138000',
          encryptedPassword: encryptPassword('secret-password', credentialKey),
        },
      ]),
      api,
      credentialKey,
      maxRetries: 1,
    })

    expect(api.loginWithPassword).toHaveBeenCalledWith('13800138000', 'secret-password', 'device-1', {
      openudid: undefined,
      vendorid: undefined,
    })
    expect(api.refreshToken).not.toHaveBeenCalled()
  })

  it('falls back to refresh when password relogin fails', async () => {
    const api = {
      loginWithPassword: vi.fn().mockRejectedValue(new Error('password login failed')),
      refreshToken: vi.fn().mockResolvedValue({ accessToken: 'new-access', refreshToken: 'new-refresh', uid: '1' }),
      userCenterLogin: vi.fn(),
      getGameRoles: mockGameRolesAfterAuthExpired(),
      appSignin: vi.fn().mockResolvedValue({ exp: 10, goldCoin: 20 }),
      getSigninState: vi.fn().mockResolvedValue({ days: 1 }),
      getSigninRewards: vi.fn().mockResolvedValue([{ name: '奖励一', num: 1 }]),
      gameSignin: vi.fn().mockResolvedValue(undefined),
    }

    const result = await runAttendance({
      accountsSecret: JSON.stringify([
        {
          id: 'main',
          name: '主账号',
          uid: '1',
          deviceId: 'device-1',
          accessToken: 'stored-access',
          refreshToken: 'old-main',
          phone: '13800138000',
        },
      ]),
      api,
      accountPasswords: {
        main: 'secret-password',
      },
      maxRetries: 1,
    })

    expect(api.loginWithPassword).toHaveBeenCalledTimes(1)
    expect(api.refreshToken).toHaveBeenCalledWith('old-main', 'device-1')
    expect(result.updatedAccounts[0]).toEqual(expect.objectContaining({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      phone: '13800138000',
    }))
  })

  it('does not write the secret when refresh is rejected and no laohu credentials are available', async () => {
    const secretWriter = vi.fn()
    const api = {
      refreshToken: vi.fn().mockRejectedValue(new Error('REFRESH_REJECTED_402: refreshToken 已失效，请重新登录')),
      userCenterLogin: vi.fn(),
      getGameRoles: vi.fn(),
      appSignin: vi.fn(),
      getSigninState: vi.fn(),
      getSigninRewards: vi.fn(),
      gameSignin: vi.fn(),
    }

    const result = await runAttendance({
      accountsSecret: JSON.stringify([
        {
          id: 'main',
          name: '主账号',
          uid: '1',
          deviceId: 'device-1',
          refreshToken: 'old-main',
        },
      ]),
      api,
      maxRetries: 1,
      secretWriter,
    })

    expect(secretWriter).not.toHaveBeenCalled()
    expect(result.updatedAccounts[0]?.refreshToken).toBe('old-main')
    expect(result.summary).toContain('refreshToken 已失效')
  })

  it('retries transient account failures before marking an account failed', async () => {
    const api = {
      refreshToken: vi.fn()
        .mockRejectedValueOnce(new Error('temporary'))
        .mockResolvedValueOnce({ accessToken: 'access-main', refreshToken: 'new-main' }),
      getGameRoles: vi.fn().mockResolvedValue({ roles: [{ roleId: 'role-1', roleName: '角色一' }] }),
      appSignin: vi.fn().mockResolvedValue({ exp: 10, goldCoin: 20 }),
      getSigninState: vi.fn().mockResolvedValue({ days: 1 }),
      getSigninRewards: vi.fn().mockResolvedValue([{ name: '奖励一', num: 1 }]),
      gameSignin: vi.fn().mockResolvedValue(undefined),
    }

    const result = await runAttendance({
      accountsSecret: JSON.stringify([
        {
          id: 'main',
          name: '主账号',
          uid: '1',
          deviceId: 'device-1',
          refreshToken: 'old-main',
        },
      ]),
      api,
      maxRetries: 2,
    })

    expect(api.refreshToken).toHaveBeenCalledTimes(2)
    expect(result.updatedAccounts[0]?.refreshToken).toBe('new-main')
  })

  it('signs all known games for each account', async () => {
    const api = {
      refreshToken: vi.fn().mockResolvedValue({ accessToken: 'access-main', refreshToken: 'new-main' }),
      getGameRoles: vi.fn()
        .mockResolvedValueOnce({ roles: [{ roleId: 'role-1256-a', roleName: '幻塔A' }] })
        .mockResolvedValueOnce({ roles: [{ roleId: 'role-1257-a', roleName: '异环A' }] })
        .mockResolvedValueOnce({ roles: [{ roleId: 'role-1289-a', roleName: '第三游戏A' }] }),
      appSignin: vi.fn().mockResolvedValue({ exp: 10, goldCoin: 20 }),
      getSigninState: vi.fn().mockResolvedValue({ days: 1 }),
      getSigninRewards: vi.fn().mockResolvedValue([{ name: '奖励一', num: 1 }]),
      gameSignin: vi.fn().mockResolvedValue(undefined),
    }

    const result = await runAttendance({
      accountsSecret: JSON.stringify([
        {
          id: 'main',
          name: '主账号',
          uid: '1',
          deviceId: 'device-1',
          refreshToken: 'old-main',
        },
      ]),
      api,
      maxRetries: 1,
    })

    expect(api.getGameRoles).toHaveBeenCalledTimes(3)
    expect(api.gameSignin).toHaveBeenCalledTimes(3)
    expect(api.gameSignin).toHaveBeenNthCalledWith(1, 'access-main', 'role-1256-a', '1256')
    expect(api.gameSignin).toHaveBeenNthCalledWith(2, 'access-main', 'role-1257-a', '1257')
    expect(api.gameSignin).toHaveBeenNthCalledWith(3, 'access-main', 'role-1289-a', '1289')
    expect(result.updatedAccounts[0]?.roleId).toBe('role-1256-a')
    expect(result.updatedAccounts[0]?.roleName).toBe('幻塔A')
  })

  it('falls back to game record cards when game roles endpoint returns no roles', async () => {
    const api = {
      refreshToken: vi.fn().mockResolvedValue({ accessToken: 'access-main', refreshToken: 'new-main' }),
      getGameRoles: vi.fn().mockResolvedValue({ roles: [] }),
      getGameRecordCards: vi.fn().mockResolvedValue({
        cards: [{ gameId: '1289', gameName: '异环', roleId: 'role-1289-a', roleName: '异环A' }],
      }),
      appSignin: vi.fn().mockResolvedValue({ exp: 10, goldCoin: 20 }),
      getSigninState: vi.fn().mockResolvedValue({ days: 4 }),
      getSigninRewards: vi.fn().mockResolvedValue([
        { name: '第1天', num: 1 },
        { name: '第2天', num: 1 },
        { name: '第3天', num: 1 },
        { name: '扩容核心', num: 2 },
      ]),
      gameSignin: vi.fn().mockResolvedValue(undefined),
    }

    const result = await runAttendance({
      accountsSecret: JSON.stringify([
        {
          id: 'main',
          name: '主账号',
          uid: '1',
          deviceId: 'device-1',
          refreshToken: 'old-main',
        },
      ]),
      api,
      maxRetries: 1,
    })

    expect(api.getGameRecordCards).toHaveBeenCalledWith('access-main', '1', 'device-1')
    expect(api.gameSignin).toHaveBeenCalledWith('access-main', 'role-1289-a', '1289')
    expect(result.successCount).toBe(1)
    expect(result.summary).toContain('游戏 1289 / 异环A：签到成功，本月第 4 天，奖励 扩容核心 x2')
  })

  it('claims cloud yihuan duration when laohu credentials are stored', async () => {
    const api = {
      refreshToken: vi.fn(),
      getGameRoles: vi.fn().mockResolvedValue({ roles: [] }),
      appSignin: vi.fn().mockResolvedValue({ exp: 10, goldCoin: 20 }),
      getSigninState: vi.fn(),
      getSigninRewards: vi.fn(),
      gameSignin: vi.fn(),
      cloudGetUserInfo: vi.fn().mockResolvedValue({ gave: 15, remained: 120 }),
    }

    const result = await runAttendance({
      accountsSecret: JSON.stringify([
        {
          id: 'main',
          name: '主账号',
          uid: '1',
          deviceId: 'device-1',
          accessToken: 'stored-access',
          refreshToken: 'old-main',
          laohuToken: 'laohu-token',
          laohuUserId: 'laohu-user',
        },
      ]),
      api,
      maxRetries: 1,
    })

    expect(api.cloudGetUserInfo).toHaveBeenCalledWith('laohu-token', 'laohu-user', 'device-1')
    expect(result.accounts[0]?.cloudDuration).toEqual({
      status: 'success',
      gave: 15,
      remained: 120,
    })
    expect(result.summary).toContain('云异环时长：+15 分钟，剩余 120 分钟')
  })

  it('skips cloud yihuan duration without stored laohu credentials', async () => {
    const api = {
      refreshToken: vi.fn().mockResolvedValue({ accessToken: 'access-main', refreshToken: 'new-main' }),
      getGameRoles: vi.fn().mockResolvedValue({ roles: [] }),
      appSignin: vi.fn().mockResolvedValue({ exp: 10, goldCoin: 20 }),
      getSigninState: vi.fn(),
      getSigninRewards: vi.fn(),
      gameSignin: vi.fn(),
      cloudGetUserInfo: vi.fn(),
    }

    const result = await runAttendance({
      accountsSecret: JSON.stringify([
        {
          id: 'main',
          name: '主账号',
          uid: '1',
          deviceId: 'device-1',
          refreshToken: 'old-main',
        },
      ]),
      api,
      maxRetries: 1,
    })

    expect(api.cloudGetUserInfo).not.toHaveBeenCalled()
    expect(result.accounts[0]?.cloudDuration).toEqual({
      status: 'skipped',
      skippedReason: '账号缺少 laohuToken/laohuUserId',
    })
    expect(result.summary).toContain('云异环时长：跳过')
  })

  it('logs in with a password to claim cloud yihuan duration when laohu credentials are missing', async () => {
    const secretWriter = vi.fn()
    const api = {
      refreshToken: vi.fn(),
      loginWithPassword: vi.fn().mockResolvedValue({ token: 'new-laohu-token', userId: 'new-laohu-user' }),
      getGameRoles: vi.fn().mockResolvedValue({ roles: [] }),
      appSignin: vi.fn().mockResolvedValue({ exp: 10, goldCoin: 20 }),
      getSigninState: vi.fn(),
      getSigninRewards: vi.fn(),
      gameSignin: vi.fn(),
      cloudGetUserInfo: vi.fn().mockResolvedValue({ gave: 15, remained: 120 }),
    }

    const result = await runAttendance({
      accountsSecret: JSON.stringify([
        {
          id: 'main',
          name: '主账号',
          uid: '1',
          deviceId: 'device-1',
          accessToken: 'stored-access',
          refreshToken: 'old-main',
          phone: '13800138000',
        },
      ]),
      api,
      accountPasswords: {
        main: 'secret-password',
      },
      maxRetries: 1,
      secretWriter,
    })

    expect(api.loginWithPassword).toHaveBeenCalledWith('13800138000', 'secret-password', 'device-1', {
      openudid: undefined,
      vendorid: undefined,
    })
    expect(api.cloudGetUserInfo).toHaveBeenCalledWith('new-laohu-token', 'new-laohu-user', 'device-1')
    expect(result.updatedAccounts[0]).toEqual(expect.objectContaining({
      laohuToken: 'new-laohu-token',
      laohuUserId: 'new-laohu-user',
      tokenUpdatedAt: expect.any(String),
    }))
    expect(secretWriter).toHaveBeenCalledWith(JSON.stringify(result.updatedAccounts, null, 2))
    expect(result.summary).toContain('云异环时长：+15 分钟，剩余 120 分钟')
  })

  it('can disable cloud yihuan duration', async () => {
    const api = {
      refreshToken: vi.fn(),
      getGameRoles: vi.fn().mockResolvedValue({ roles: [] }),
      appSignin: vi.fn().mockResolvedValue({ exp: 10, goldCoin: 20 }),
      getSigninState: vi.fn(),
      getSigninRewards: vi.fn(),
      gameSignin: vi.fn(),
      cloudGetUserInfo: vi.fn(),
    }

    const result = await runAttendance({
      accountsSecret: JSON.stringify([
        {
          id: 'main',
          name: '主账号',
          uid: '1',
          deviceId: 'device-1',
          accessToken: 'stored-access',
          refreshToken: 'old-main',
          laohuToken: 'laohu-token',
          laohuUserId: 'laohu-user',
        },
      ]),
      api,
      cloudDuration: false,
      maxRetries: 1,
    })

    expect(api.cloudGetUserInfo).not.toHaveBeenCalled()
    expect(result.accounts[0]?.cloudDuration).toBeUndefined()
    expect(result.summary).not.toContain('云异环时长')
  })

  it('builds a readable Chinese summary with account rewards and game rewards', async () => {
    const api = {
      refreshToken: vi.fn().mockResolvedValue({ accessToken: 'access-main', refreshToken: 'new-main' }),
      getGameRoles: vi.fn()
        .mockResolvedValueOnce({ roles: [{ roleId: 'role-1256-a', roleName: '幻塔A' }] })
        .mockResolvedValueOnce({ roles: [] })
        .mockResolvedValueOnce({ roles: [] }),
      appSignin: vi.fn().mockResolvedValue({ exp: 10, goldCoin: 20 }),
      getSigninState: vi.fn().mockResolvedValue({ days: 1 }),
      getSigninRewards: vi.fn().mockResolvedValue([{ name: '墨晶', num: 5 }]),
      gameSignin: vi.fn().mockResolvedValue(undefined),
    }

    const result = await runAttendance({
      accountsSecret: JSON.stringify([
        {
          id: 'main',
          name: '主账号',
          uid: '1',
          deviceId: 'device-1',
          refreshToken: 'old-main',
        },
      ]),
      api,
      maxRetries: 1,
    })

    expect(result.summary).toContain('塔吉多每日签到结果')
    expect(result.summary).toContain('总账号：1，成功：1，失败：0')
    expect(result.summary).toContain('主账号（main）：成功')
    expect(result.summary).toContain('APP 签到：获得 20 金币，10 经验')
    expect(result.summary).toContain('游戏 1256 / 幻塔A：签到成功，本月第 1 天，奖励 墨晶 x5')
  })

  it('reads game signin days after signing so the first day is not shown as day zero', async () => {
    const api = {
      refreshToken: vi.fn().mockResolvedValue({ accessToken: 'access-main', refreshToken: 'new-main' }),
      getGameRoles: vi.fn()
        .mockResolvedValueOnce({ roles: [{ roleId: 'role-1256-a', roleName: '幻塔A' }] })
        .mockResolvedValueOnce({ roles: [] })
        .mockResolvedValueOnce({ roles: [] }),
      appSignin: vi.fn().mockResolvedValue({ exp: 10, goldCoin: 20 }),
      getSigninState: vi.fn().mockResolvedValue({ days: 1 }),
      getSigninRewards: vi.fn().mockResolvedValue([{ name: '墨晶', num: 5 }]),
      gameSignin: vi.fn().mockResolvedValue(undefined),
    }

    const result = await runAttendance({
      accountsSecret: JSON.stringify([
        {
          id: 'main',
          name: '主账号',
          uid: '1',
          deviceId: 'device-1',
          refreshToken: 'old-main',
        },
      ]),
      api,
      maxRetries: 1,
    })

    expect(api.gameSignin.mock.invocationCallOrder[0]).toBeLessThan(api.getSigninState.mock.invocationCallOrder[0])
    expect(result.summary).toContain('游戏 1256 / 幻塔A：签到成功，本月第 1 天，奖励 墨晶 x5')
  })

  it('continues game signins when app signin reports already signed today', async () => {
    const api = {
      refreshToken: vi.fn().mockResolvedValue({ accessToken: 'access-main', refreshToken: 'new-main' }),
      getGameRoles: vi.fn()
        .mockResolvedValueOnce({ roles: [{ roleId: 'role-1256-a', roleName: '幻塔A' }] })
        .mockResolvedValueOnce({ roles: [] })
        .mockResolvedValueOnce({ roles: [] }),
      appSignin: vi.fn().mockRejectedValue(new Error('您今天已经签到过了')),
      getSigninState: vi.fn().mockResolvedValue({ days: 1 }),
      getSigninRewards: vi.fn().mockResolvedValue([{ name: '墨晶', num: 5 }]),
      gameSignin: vi.fn().mockResolvedValue(undefined),
    }

    const result = await runAttendance({
      accountsSecret: JSON.stringify([
        {
          id: 'main',
          name: '主账号',
          uid: '1',
          deviceId: 'device-1',
          refreshToken: 'old-main',
        },
      ]),
      api,
      maxRetries: 1,
    })

    expect(api.gameSignin).toHaveBeenCalledWith('access-main', 'role-1256-a', '1256')
    expect(result.successCount).toBe(1)
    expect(result.summary).toContain('APP 签到：今日已签到')
    expect(result.summary).toContain('游戏 1256 / 幻塔A：签到成功，本月第 1 天，奖励 墨晶 x5')
  })

  it('treats game already-signed responses as successful idempotent signins', async () => {
    const api = {
      refreshToken: vi.fn().mockResolvedValue({ accessToken: 'access-main', refreshToken: 'new-main' }),
      getGameRoles: vi.fn()
        .mockResolvedValueOnce({ roles: [{ roleId: 'role-1256-a', roleName: '幻塔A' }] })
        .mockResolvedValueOnce({ roles: [] })
        .mockResolvedValueOnce({ roles: [] }),
      appSignin: vi.fn().mockResolvedValue({ exp: 10, goldCoin: 20 }),
      getSigninState: vi.fn().mockResolvedValue({ days: 1 }),
      getSigninRewards: vi.fn().mockResolvedValue([{ name: '墨晶', num: 5 }]),
      gameSignin: vi.fn().mockRejectedValue(new Error('重复签到')),
    }

    const result = await runAttendance({
      accountsSecret: JSON.stringify([
        {
          id: 'main',
          name: '主账号',
          uid: '1',
          deviceId: 'device-1',
          refreshToken: 'old-main',
        },
      ]),
      api,
      maxRetries: 1,
    })

    expect(result.successCount).toBe(1)
    expect(result.summary).toContain('游戏 1256 / 幻塔A：今日已签到，本月第 1 天，奖励 墨晶 x5')
  })

  it('skips accounts that already succeeded today in state storage', async () => {
    const stateStore = new MemoryStateStore('test')
    await stateStore.set('attendance:main:2026-05-26', { status: 'success' })
    const api = {
      refreshToken: vi.fn(),
      getGameRoles: vi.fn(),
      appSignin: vi.fn(),
      getSigninState: vi.fn(),
      getSigninRewards: vi.fn(),
      gameSignin: vi.fn(),
    }

    const result = await runAttendance({
      accountsSecret: JSON.stringify([
        { id: 'main', name: '主账号', uid: '1', deviceId: 'device-1', refreshToken: 'old-main' },
      ]),
      api,
      stateStore,
      now: shanghaiNoon,
    })

    expect(api.refreshToken).not.toHaveBeenCalled()
    expect(result.skippedCount).toBe(1)
    expect(result.accounts[0]).toEqual(expect.objectContaining({
      id: 'main',
      status: 'skipped',
    }))
    expect(result.summary).toContain('跳过：1')
  })

  it('force runs accounts even when today already succeeded', async () => {
    const stateStore = new MemoryStateStore('test')
    await stateStore.set('attendance:main:2026-05-26', { status: 'success' })
    const api = {
      refreshToken: vi.fn().mockResolvedValue({ accessToken: 'access-main', refreshToken: 'new-main' }),
      getGameRoles: vi.fn().mockResolvedValue({ roles: [] }),
      appSignin: vi.fn().mockResolvedValue({ exp: 10, goldCoin: 20 }),
      getSigninState: vi.fn(),
      getSigninRewards: vi.fn(),
      gameSignin: vi.fn(),
    }

    const result = await runAttendance({
      accountsSecret: JSON.stringify([
        { id: 'main', name: '主账号', uid: '1', deviceId: 'device-1', refreshToken: 'old-main' },
      ]),
      api,
      stateStore,
      forceRun: true,
      now: shanghaiNoon,
    })

    expect(api.refreshToken).toHaveBeenCalledWith('old-main', 'device-1')
    expect(result.forceRun).toBe(true)
    expect(result.skippedCount).toBe(0)
    expect(result.successCount).toBe(1)
    await expect(stateStore.get('attendance:main:2026-05-26')).resolves.toEqual(expect.objectContaining({
      status: 'success',
      accountId: 'main',
    }))
  })

  it('saves structured run history and notification failures without failing attendance', async () => {
    const stateStore = new MemoryStateStore('test')
    const api = {
      refreshToken: vi.fn().mockResolvedValue({ accessToken: 'access-main', refreshToken: 'new-main' }),
      getGameRoles: vi.fn().mockResolvedValue({ roles: [] }),
      appSignin: vi.fn().mockResolvedValue({ exp: 10, goldCoin: 20 }),
      getSigninState: vi.fn(),
      getSigninRewards: vi.fn(),
      gameSignin: vi.fn(),
    }
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('webhook down'))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))

    const result = await runAttendance({
      accountsSecret: JSON.stringify([
        { id: 'main', name: '主账号', uid: '1', deviceId: 'device-1', refreshToken: 'old-main' },
      ]),
      api,
      stateStore,
      notificationUrls: ['https://example.com/a', 'https://example.com/b'],
      notificationFetch: fetchMock,
      now: shanghaiNoon,
    })

    expect(result.notificationErrors).toEqual([{
      url: 'https://example.com/a',
      error: 'webhook down',
    }])
    await expect(stateStore.get('last-summary')).resolves.toContain('塔吉多每日签到结果')
    await expect(stateStore.get('last-run')).resolves.toEqual(expect.objectContaining({
      forceRun: false,
      totalCount: 1,
      successCount: 1,
      failedCount: 0,
      skippedCount: 0,
      notificationErrors: result.notificationErrors,
      accounts: [expect.objectContaining({
        id: 'main',
        status: 'success',
        appSignin: { exp: 10, goldCoin: 20 },
      })],
    }))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rebuilds the session and retries when a later signed request reports auth expired', async () => {
    const api = {
      refreshToken: vi.fn().mockResolvedValue({ accessToken: 'new-access', refreshToken: 'new-refresh', uid: '1' }),
      userCenterLogin: vi.fn(),
      getGameRoles: vi.fn()
        .mockResolvedValueOnce({ roles: [{ roleId: 'role-1', roleName: '角色一' }] })
        .mockResolvedValueOnce({ roles: [] })
        .mockResolvedValueOnce({ roles: [] })
        .mockResolvedValueOnce({ roles: [{ roleId: 'role-1', roleName: '角色一' }] })
        .mockResolvedValueOnce({ roles: [] })
        .mockResolvedValueOnce({ roles: [] }),
      appSignin: vi.fn()
        .mockRejectedValueOnce(new Error('AUTH_EXPIRED: token expired'))
        .mockResolvedValueOnce({ exp: 10, goldCoin: 20 }),
      getSigninState: vi.fn().mockResolvedValue({ days: 1 }),
      getSigninRewards: vi.fn().mockResolvedValue([{ name: '奖励一', num: 1 }]),
      gameSignin: vi.fn().mockResolvedValue(undefined),
    }

    const result = await runAttendance({
      accountsSecret: JSON.stringify([
        {
          id: 'main',
          name: '主账号',
          uid: '1',
          deviceId: 'device-1',
          accessToken: 'stored-access',
          refreshToken: 'old-main',
        },
      ]),
      api,
      maxRetries: 1,
    })

    expect(api.refreshToken).toHaveBeenCalledTimes(1)
    expect(api.appSignin).toHaveBeenNthCalledWith(2, 'new-access', '1', 'device-1')
    expect(result.successCount).toBe(1)
    expect(result.updatedAccounts[0]).toEqual(expect.objectContaining({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
    }))
  })

  it('runs enabled coin tasks and includes the result in structured history and summary', async () => {
    const api = {
      refreshToken: vi.fn().mockResolvedValue({ accessToken: 'access-main', refreshToken: 'new-main' }),
      getGameRoles: vi.fn().mockResolvedValue({ roles: [] }),
      appSignin: vi.fn().mockResolvedValue({ exp: 10, goldCoin: 20 }),
      getSigninState: vi.fn(),
      getSigninRewards: vi.fn(),
      gameSignin: vi.fn(),
      getUserTasks: vi.fn().mockResolvedValue([
        { code: 'signin_c', completeTimes: 0, limitTimes: 1 },
        { code: 'browse_post_c', completeTimes: 3, limitTimes: 5 },
        { code: 'like_post_c', completeTimes: 4, limitTimes: 5 },
        { code: 'share', completeTimes: 0, limitTimes: 1 },
      ]),
      bbsSignin: vi.fn().mockResolvedValue(undefined),
      getRecommendPostList: vi.fn().mockResolvedValue([
        { postId: 'post-1', selfOperation: { liked: false } },
        { postId: 'post-2', selfOperation: { liked: true } },
        { postId: 'post-3', selfOperation: { liked: false } },
      ]),
      getPostFull: vi.fn()
        .mockResolvedValueOnce({ postId: 'post-1', selfOperation: { liked: false } })
        .mockResolvedValueOnce({ postId: 'post-3', selfOperation: { liked: false } }),
      likePost: vi.fn().mockResolvedValue(undefined),
      sharePost: vi.fn().mockResolvedValue(undefined),
      getUserCoinTaskState: vi.fn().mockResolvedValue({ todayCoin: 110, limitCoin: 150 }),
    }

    const result = await runAttendance({
      accountsSecret: JSON.stringify([
        { id: 'main', name: '主账号', uid: '1', deviceId: 'device-1', refreshToken: 'old-main' },
      ]),
      api,
      maxRetries: 1,
      coinTasks: true,
      sharePlatform: 'qq',
      delay: () => Promise.resolve(),
    })

    expect(api.bbsSignin).toHaveBeenCalledWith('access-main', '1', 'device-1')
    expect(api.getPostFull).toHaveBeenCalledTimes(2)
    expect(api.likePost).toHaveBeenCalledTimes(1)
    expect(api.likePost).toHaveBeenCalledWith('access-main', '1', 'device-1', 'post-1')
    expect(api.sharePost).toHaveBeenCalledWith('access-main', '1', 'device-1', 'post-1', 'qq')
    expect(result.accounts[0]?.coinTasks).toEqual({
      bbsSignin: true,
      browse: { done: 2, target: 2 },
      like: { done: 1, target: 1 },
      share: { done: 1, target: 1, platform: 'qq' },
      coinState: { todayCoin: 110, limitCoin: 150 },
    })
    expect(result.summary).toContain('金币任务：签到✓ 浏览2/2 点赞1/1 分享✓ 今日金币110/150')
  })

  it('continues browse like and share coin tasks when bbs signin is already done', async () => {
    const api = {
      refreshToken: vi.fn().mockResolvedValue({ accessToken: 'access-main', refreshToken: 'new-main' }),
      getGameRoles: vi.fn().mockResolvedValue({ roles: [] }),
      appSignin: vi.fn().mockResolvedValue({ exp: 10, goldCoin: 20 }),
      getSigninState: vi.fn(),
      getSigninRewards: vi.fn(),
      gameSignin: vi.fn(),
      getUserTasks: vi.fn().mockResolvedValue([
        { code: 'signin_c', completeTimes: 0, limitTimes: 1 },
        { code: 'browse_post_c', completeTimes: 0, limitTimes: 1 },
        { code: 'like_post_c', completeTimes: 0, limitTimes: 1 },
        { code: 'share', completeTimes: 0, limitTimes: 1 },
      ]),
      bbsSignin: vi.fn().mockRejectedValue(new Error('您今天已经签到过了')),
      getRecommendPostList: vi.fn().mockResolvedValue([
        { postId: 'post-1', selfOperation: { liked: false } },
      ]),
      getPostFull: vi.fn().mockResolvedValue({ postId: 'post-1', selfOperation: { liked: false } }),
      likePost: vi.fn().mockResolvedValue(undefined),
      sharePost: vi.fn().mockResolvedValue(undefined),
      getUserCoinTaskState: vi.fn().mockResolvedValue({ todayCoin: 110, limitCoin: 150 }),
    }

    const result = await runAttendance({
      accountsSecret: JSON.stringify([
        { id: 'main', name: '主账号', uid: '1', deviceId: 'device-1', refreshToken: 'old-main' },
      ]),
      api,
      maxRetries: 1,
      coinTasks: true,
      sharePlatform: 'qq',
      delay: () => Promise.resolve(),
    })

    expect(api.getPostFull).toHaveBeenCalledWith('access-main', '1', 'device-1', 'post-1')
    expect(api.likePost).toHaveBeenCalledWith('access-main', '1', 'device-1', 'post-1')
    expect(api.sharePost).toHaveBeenCalledWith('access-main', '1', 'device-1', 'post-1', 'qq')
    expect(result.successCount).toBe(1)
    expect(result.summary).toContain('金币任务：签到✓ 浏览1/1 点赞1/1 分享✓ 今日金币110/150')
  })

  it('keeps the api method this binding while handling already-done bbs signin', async () => {
    class BoundBbsApi {
      readonly refreshToken = vi.fn().mockResolvedValue({ accessToken: 'access-main', refreshToken: 'new-main' })
      readonly getGameRoles = vi.fn().mockResolvedValue({ roles: [] })
      readonly appSignin = vi.fn().mockResolvedValue({ exp: 10, goldCoin: 20 })
      readonly getSigninState = vi.fn()
      readonly getSigninRewards = vi.fn()
      readonly gameSignin = vi.fn()
      readonly getUserTasks = vi.fn().mockResolvedValue([
        { code: 'signin_c', completeTimes: 0, limitTimes: 1 },
      ])

      bbsSignin(): Promise<void> {
        if (!(this instanceof BoundBbsApi)) {
          throw new Error('lost this binding')
        }
        throw new Error('您今天已经签到过了')
      }

      readonly getRecommendPostList = vi.fn().mockResolvedValue([])
      readonly getPostFull = vi.fn()
      readonly likePost = vi.fn()
      readonly sharePost = vi.fn()
      readonly getUserCoinTaskState = vi.fn().mockResolvedValue({})
    }

    const result = await runAttendance({
      accountsSecret: JSON.stringify([
        { id: 'main', name: '主账号', uid: '1', deviceId: 'device-1', refreshToken: 'old-main' },
      ]),
      api: new BoundBbsApi(),
      maxRetries: 1,
      coinTasks: true,
      delay: () => Promise.resolve(),
    })

    expect(result.successCount).toBe(1)
    expect(result.summary).toContain('金币任务：签到✓')
  })

  it('does not call coin task APIs when coin tasks are disabled', async () => {
    const api = {
      refreshToken: vi.fn().mockResolvedValue({ accessToken: 'access-main', refreshToken: 'new-main' }),
      getGameRoles: vi.fn().mockResolvedValue({ roles: [] }),
      appSignin: vi.fn().mockResolvedValue({ exp: 10, goldCoin: 20 }),
      getSigninState: vi.fn(),
      getSigninRewards: vi.fn(),
      gameSignin: vi.fn(),
      getUserTasks: vi.fn(),
      bbsSignin: vi.fn(),
      getRecommendPostList: vi.fn(),
      getPostFull: vi.fn(),
      likePost: vi.fn(),
      sharePost: vi.fn(),
      getUserCoinTaskState: vi.fn(),
    }

    await runAttendance({
      accountsSecret: JSON.stringify([
        { id: 'main', name: '主账号', uid: '1', deviceId: 'device-1', refreshToken: 'old-main' },
      ]),
      api,
      maxRetries: 1,
      coinTasks: false,
    })

    expect(api.getUserTasks).not.toHaveBeenCalled()
    expect(api.bbsSignin).not.toHaveBeenCalled()
  })

  it('runs the full HTTP-backed attendance flow and keeps coin tasks resilient', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const parsed = new URL(url)
      const path = parsed.pathname
      const method = init?.method ?? 'GET'
      if (path === '/usercenter/api/v2/getGameRoles') {
        if (parsed.searchParams.get('gameId') === '1289') {
          return jsonResponse({ code: 0, msg: 'ok', data: { roles: [{ roleId: 'role-1289', roleName: '异环角色' }] } })
        }
        return jsonResponse({ code: 0, msg: 'ok', data: { roles: [] } })
      }
      if (path === '/apihub/api/signin' && method === 'POST') {
        return jsonResponse({ code: 1, msg: '您今天已经签到过了' })
      }
      if (path === '/apihub/awapi/signin/state') {
        return jsonResponse({ code: 0, msg: 'ok', data: { days: 4 } })
      }
      if (path === '/apihub/awapi/sign/rewards') {
        return jsonResponse({ code: 0, msg: 'ok', data: [{ name: '甲硬币', num: 10000 }] })
      }
      if (path === '/apihub/awapi/sign') {
        return jsonResponse({ code: 1, msg: '重复签到' })
      }
      if (path === '/apihub/api/getUserTasks') {
        return jsonResponse({
          code: 0,
          msg: 'ok',
          data: {
            task_list1: [
              { code: 'signin_c', completeTimes: 0, limitTimes: 1 },
              { code: 'browse_post_c', completeTimes: 0, limitTimes: 2 },
              { code: 'like_post_c', completeTimes: 0, limitTimes: 1 },
              { code: 'share', completeTimes: 0, limitTimes: 1 },
            ],
          },
        })
      }
      if (path === '/bbs/api/getRecommendPostList') {
        return jsonResponse({
          code: 0,
          msg: 'ok',
          data: {
            hasMore: true,
            posts: [
              { id: 100, selfOperation: { liked: false } },
              { id: 200, selfOperation: { liked: false } },
            ],
          },
        })
      }
      if (path === '/bbs/api/getPostFull') {
        const postId = parsed.searchParams.get('postId')
        if (postId === '100') {
          return jsonResponse({ code: 0, msg: 'ok', data: { unexpected: true } })
        }
        return jsonResponse({ code: 0, msg: 'ok', data: { id: postId, selfOperation: { liked: false } } })
      }
      if (path === '/bbs/api/post/like') {
        return jsonResponse({ code: 1, msg: 'ok' })
      }
      if (path === '/bbs/api/post/share') {
        return jsonResponse({ code: 0, msg: 'ok' })
      }
      if (path === '/apihub/api/getUserCoinTaskState') {
        return jsonResponse({ code: 0, msg: 'ok', data: { todayCoin: 120, limitCoin: 150 } })
      }
      throw new Error(`unexpected request: ${method} ${url}`)
    }) as unknown as typeof fetch

    const result = await runAttendance({
      accountsSecret: JSON.stringify([
        {
          id: 'main',
          name: '主账号',
          uid: '1',
          deviceId: 'device-1',
          accessToken: 'access-main',
          refreshToken: 'refresh-main',
        },
      ]),
      api: new TaygedoApi({ fetch: fetchMock }),
      maxRetries: 1,
      coinTasks: true,
      sharePlatform: 'qq',
      delay: () => Promise.resolve(),
    })

    expect(result.successCount).toBe(1)
    expect(result.failedCount).toBe(0)
    expect(result.summary).toContain('APP 签到：今日已签到')
    expect(result.summary).toContain('游戏 1289 / 异环角色：今日已签到，本月第 4 天')
    expect(result.summary).toContain('金币任务：签到✓ 浏览1/2 点赞0/1 分享✓ 今日金币120/150')
    expect(result.accounts[0]?.coinTasks?.error).toContain('getPostFull 请求失败')
    expect(result.accounts[0]?.coinTasks?.error).toContain('likePost 请求失败')
  })
})

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

function mockGameRolesAfterAuthExpired() {
  return vi.fn()
    .mockRejectedValueOnce(new Error('AUTH_EXPIRED: token expired'))
    .mockImplementation(async (_accessToken: string, _uid: string, _deviceId: string, gameId: string) => ({
      roles: gameId === '1256'
        ? [{ roleId: 'role-1256-a', roleName: '幻塔A' }]
        : [],
    }))
}
