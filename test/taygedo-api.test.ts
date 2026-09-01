import { describe, expect, it, vi } from 'vitest'
import { TaygedoApi } from '../src/taygedo/api.js'

describe('TaygedoApi', () => {
  it('refreshes tokens using the official 1.2.5 session profile', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 0,
          msg: 'ok',
          data: {
            accessToken: 'new-access',
            refreshToken: 'new-refresh',
          },
        }),
        { status: 200 },
      ),
    )
    const api = new TaygedoApi({ fetch: fetchMock })

    const result = await api.refreshToken('old-refresh', 'device-1', 'uid-1')

    expect(result).toEqual({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://bbs-api.tajiduo.com/usercenter/api/refreshToken',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'old-refresh',
          deviceId: 'device-1',
          uid: 'uid-1',
          appVersion: '1.2.5',
          platform: 'android',
          'debug-uid': '3',
          ds: expect.any(String),
        }),
      }),
    )
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty('body')
  })

  it('reports which endpoint returned invalid json', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 200 }))
    const api = new TaygedoApi({ fetch: fetchMock })

    await expect(api.refreshToken('old-refresh', 'device-1', 'uid-1')).rejects.toThrow(
      'refreshToken 返回了无效 JSON（HTTP 200，响应为空）',
    )
  })

  it('does not use a bare ok message for malformed business responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 1, msg: 'ok' }), { status: 200 }),
    )
    const api = new TaygedoApi({ fetch: fetchMock })

    await expect(api.getRecommendPostList('access-token', 'uid-1', 'device-1')).rejects.toThrow(
      'getRecommendPostList 请求失败（HTTP 200，code=1，msg=ok，响应：{"code":1,"msg":"ok"}）',
    )
  })

  it('does not use a bare ok message for malformed signed endpoint responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 0, msg: 'ok', data: { unexpected: true } }), { status: 200 }),
    )
    const api = new TaygedoApi({ fetch: fetchMock })

    await expect(api.getPostFull('access-token', 'uid-1', 'device-1', 'post-1')).rejects.toThrow(
      'getPostFull 请求失败（HTTP 200，code=0，msg=ok，响应：{"code":0,"msg":"ok","data":{"unexpected":true}}）',
    )
  })

  it('reads recommended posts from the posts field returned by the bbs api', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        code: 0,
        msg: 'ok',
        data: {
          hasMore: true,
          page: 2,
          posts: [
            { id: 123, selfOperation: { liked: false } },
          ],
        },
      }), { status: 200 }),
    )
    const api = new TaygedoApi({ fetch: fetchMock })

    await expect(api.getRecommendPostList('access-token', 'uid-1', 'device-1')).resolves.toEqual([
      { postId: '123', selfOperation: { liked: false } },
    ])
  })

  it('reads full posts from the post field returned by the bbs api', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        code: 0,
        msg: 'ok',
        data: {
          draftId: 0,
          post: {
            columnId: 2,
            content: '<p>uid:2</p>',
            selfOperation: { liked: false },
          },
        },
      }), { status: 200 }),
    )
    const api = new TaygedoApi({ fetch: fetchMock })

    await expect(api.getPostFull('access-token', 'uid-1', 'device-1', 'post-1')).resolves.toEqual({
      postId: 'post-1',
      selfOperation: { liked: false },
    })
  })

  it('classifies an empty HTTP 402 refresh response as a rejected refresh token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 402 }))
    const api = new TaygedoApi({ fetch: fetchMock })

    await expect(api.refreshToken('old-refresh', 'device-1', 'uid-1')).rejects.toThrow(
      'REFRESH_REJECTED_402: refreshToken 已失效，请重新登录',
    )
  })

  it('calls app and game signin endpoints with the access token', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 0, msg: 'ok', data: { exp: 0, goldCoin: 0 } }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 0, msg: 'ok', data: { days: 7 } }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 0, msg: 'ok', data: [{ name: '奖励一', num: 1 }] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 0, msg: 'ok' }), { status: 200 }),
      )
    const api = new TaygedoApi({ fetch: fetchMock })

    expect(await api.appSignin('access-token', 'uid-1', 'device-1')).toEqual({ exp: 0, goldCoin: 0 })
    expect(await api.getSigninState('access-token')).toEqual({ days: 7 })
    expect(await api.getSigninRewards('access-token')).toEqual([{ name: '奖励一', num: 1 }])
    await expect(api.gameSignin('access-token', 'role-1')).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://bbs-api.tajiduo.com/apihub/api/signin',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'access-token',
          uid: 'uid-1',
          deviceid: 'device-1',
          appversion: '1.2.5',
          platform: 'android',
          ds: expect.any(String),
        }),
        body: 'communityId=1',
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      'https://bbs-api.tajiduo.com/apihub/awapi/sign',
      expect.objectContaining({
        method: 'POST',
        body: 'roleId=role-1&gameId=1256',
      }),
    )
  })

  it('gets game roles through the native 1.2.5 request profile', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        code: 0,
        msg: 'ok',
        data: { roles: [{ roleId: 123, roleName: '角色一' }] },
      }), { status: 200 }),
    )
    const api = new TaygedoApi({ fetch: fetchMock })

    await expect(api.getGameRoles('access-token', 'uid-1', 'device-1', '1256')).resolves.toEqual({
      roles: [{ roleId: '123', roleName: '角色一' }],
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://bbs-api.tajiduo.com/usercenter/api/v2/getGameRoles?gameId=1256',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'access-token',
          uid: 'uid-1',
          deviceid: 'device-1',
          appversion: '1.2.5',
          platform: 'android',
          ds: expect.any(String),
        }),
      }),
    )
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty('body')
  })

  it('reads bound game roles from record cards', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 0,
      msg: 'ok',
      data: [
        {
          gameId: 1289,
          gameName: '异环',
          bindRoleInfo: { roleId: 456, roleName: '测试角色' },
        },
        {
          gameId: 1256,
          gameName: '幻塔',
          bindRoleInfo: null,
        },
      ],
    }), { status: 200 }))
    const api = new TaygedoApi({ fetch: fetchMock })

    await expect(api.getGameRecordCards('access-token', 'uid-1', 'device-1')).resolves.toEqual({
      cards: [
        { gameId: '1289', gameName: '异环', roleId: '456', roleName: '测试角色' },
        { gameId: '1256', gameName: '幻塔' },
      ],
    })
  })

  it('calls native and h5 coin task endpoints with protocol headers', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        msg: 'ok',
        data: {
          task_list1: [
            { code: 'browse_post_c', completeTimes: 1, limitTimes: 5 },
            { code: 'like_post_c', completeTimes: 0, limitTimes: 5 },
          ],
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        msg: 'ok',
        data: {
          list: [
            { postId: 'post-1', selfOperation: { liked: false } },
            { postId: 'post-2', selfOperation: { liked: true } },
          ],
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        msg: 'ok',
        data: { postId: 'post-1', selfOperation: { liked: false } },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, msg: 'ok' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, msg: 'ok' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, msg: 'ok', data: { todayCoin: 110, limitCoin: 150 } }), { status: 200 }))

    const api = new TaygedoApi({ fetch: fetchMock })

    expect(await api.getUserTasks('access-token', 'uid-1', 'device-1')).toEqual([
      { code: 'browse_post_c', completeTimes: 1, limitTimes: 5 },
      { code: 'like_post_c', completeTimes: 0, limitTimes: 5 },
    ])
    expect(await api.getRecommendPostList('access-token', 'uid-1', 'device-1', 20, 1)).toEqual([
      { postId: 'post-1', selfOperation: { liked: false } },
      { postId: 'post-2', selfOperation: { liked: true } },
    ])
    expect(await api.getPostFull('access-token', 'uid-1', 'device-1', 'post-1')).toEqual({
      postId: 'post-1',
      selfOperation: { liked: false },
    })
    await expect(api.likePost('access-token', 'uid-1', 'device-1', 'post-1')).resolves.toBeUndefined()
    await expect(api.sharePost('access-token', 'uid-1', 'device-1', 'post-1', 'qq')).resolves.toBeUndefined()
    expect(await api.getUserCoinTaskState('access-token')).toEqual({ todayCoin: 110, limitCoin: 150 })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://bbs-api.tajiduo.com/apihub/api/getUserTasks?gid=1',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'access-token',
          appversion: '1.2.5',
          platform: 'android',
          uid: 'uid-1',
          deviceid: 'device-1',
          ds: expect.any(String),
        }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      6,
      'https://bbs-api.tajiduo.com/apihub/api/getUserCoinTaskState',
      expect.objectContaining({
        method: 'GET',
        headers: expect.not.objectContaining({
          ds: expect.any(String),
        }),
      }),
    )
    expect(fetchMock.mock.calls[4]?.[1]?.body).toBe('platform=qq&postId=post-1')
  })

  it('reads coin task codes from taskKey when code is absent', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 0,
      msg: 'ok',
      data: {
        task_list1: [
          { taskKey: 'browse_post_c', completeTimes: 2, limitTimes: 5 },
        ],
      },
    }), { status: 200 }))
    const api = new TaygedoApi({ fetch: fetchMock })

    await expect(api.getUserTasks('access-token', 'uid-1', 'device-1')).resolves.toEqual([
      { code: 'browse_post_c', completeTimes: 2, limitTimes: 5 },
    ])
  })

  it.each([
    { field: 'message', body: { code: 1, message: '短信正在发送，请稍候' } },
    { field: 'msg', body: { code: 1, msg: '短信正在发送，请勿重复操作' } },
  ])('accepts HTTP 200 code 1 when $field explicitly says the SMS is being sent', async ({ body }) => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), { status: 200 }),
    )
    const api = new TaygedoApi({ fetch: fetchMock })

    await expect(api.sendCaptcha('13800138000', 'device-1')).resolves.toBeUndefined()
  })

  it.each([
    { name: 'unrelated code 1', status: 200, body: { code: 1, message: '系统错误' } },
    { name: 'non-200 response', status: 400, body: { code: 1, message: '短信正在发送，请稍候' } },
  ])('does not generalize $name into a successful captcha send', async ({ status, body }) => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), { status }),
    )
    const api = new TaygedoApi({ fetch: fetchMock })

    await expect(api.sendCaptcha('13800138000', 'device-1')).rejects.toThrow('sendCaptcha')
  })

  it('sends captcha and exchanges login credentials through the laohu and usercenter endpoints', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, message: 'ok' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, message: 'ok' }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 0, message: 'ok', result: { token: 'laohu-token', userId: 'user-1' } }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 0, msg: 'ok', data: { accessToken: 'access-token', refreshToken: 'refresh-token', uid: 'uid-1' } }), { status: 200 }),
      )
    const api = new TaygedoApi({ fetch: fetchMock })

    await api.sendCaptcha('13800138000', 'device-1')
    expect(await api.loginWithCaptcha('13800138000', '123456', 'device-1')).toEqual({
      token: 'laohu-token',
      userId: 'user-1',
    })
    expect(await api.userCenterLogin('laohu-token', 'user-1', 'device-1')).toEqual({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      uid: 'uid-1',
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://user.laohu.com/m/newApi/sendPhoneCaptchaWithOutLogin',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'User-Agent': 'LaohuSDK/4.327.0 (android os 14;mobile  manufacturer Google; model Pixel 6) ',
        }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://user.laohu.com/m/newApi/checkPhoneCaptchaWithOutLogin',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'User-Agent': 'LaohuSDK/4.327.0 (android os 14;mobile  manufacturer Google; model Pixel 6) ',
        }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://user.laohu.com/openApi/sms/new/login',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'User-Agent': 'LaohuSDK/4.327.0 (android os 14;mobile  manufacturer Google; model Pixel 6) ',
        }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      'https://bbs-api.tajiduo.com/usercenter/api/login',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          deviceId: 'device-1',
          appVersion: '1.2.5',
          platform: 'android',
          ds: expect.any(String),
          uid: '0',
          'debug-uid': '3',
          Authorization: '',
          Accept: 'application/json, text/plain, */*',
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'okhttp/4.12.0',
        }),
      }),
    )

    const sendBody = new URLSearchParams(String(fetchMock.mock.calls[0]?.[1]?.body))
    const checkBody = new URLSearchParams(String(fetchMock.mock.calls[1]?.[1]?.body))
    const loginBody = new URLSearchParams(String(fetchMock.mock.calls[2]?.[1]?.body))
    for (const body of [sendBody, checkBody, loginBody]) {
      expect(body.get('appId')).toBe('10550')
      expect(body.get('channelId')).toBe('1')
      expect(body.get('deviceId')).toBe('device-1')
      expect(body.get('sdkVersion')).toBe('4.327.0')
      expect(body.get('deviceSys')).toBe('14')
      expect(body.get('deviceType')).toBe('Pixel 6')
    }
    expect(sendBody.get('adm')).toBeNull()
    expect(sendBody.get('type')).toBe('16')
    expect(sendBody.get('versionCode')).toBe('17')
    expect(sendBody.get('cellphone')).toBe('13800138000')
    expect(Number(sendBody.get('t'))).toBeLessThan(100_000_000_000)
    expect(checkBody.get('adm')).toBeNull()
    expect(checkBody.get('versionCode')).toBe('17')
    expect(checkBody.get('cellphone')).toBe('13800138000')
    expect(checkBody.get('captcha')).toBe('123456')
    expect(checkBody.get('areaCodeId')).toBeNull()
    expect(checkBody.get('type')).toBeNull()
    expect(Number(checkBody.get('t'))).toBeLessThan(100_000_000_000)
    expect(loginBody.get('adm')).toBe('')
    expect(loginBody.get('idfa')).toBe('')
    expect(loginBody.get('type')).toBe('16')
    expect(loginBody.get('version')).toBe('17')
    expect(loginBody.get('mac')).toBe('')
    expect(loginBody.get('cellphone')).not.toBe('13800138000')
    expect(Number(loginBody.get('t'))).toBeGreaterThan(100_000_000_000)
  })

  it('logs in with a password through the laohu secureLogin endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 0, message: 'ok', result: { token: 'laohu-token', userId: 'user-1' } }), { status: 200 }),
    )
    const api = new TaygedoApi({ fetch: fetchMock })

    expect(await api.loginWithPassword('13800138000', 'secret-password', 'device-1', {
      openudid: '11111111-1111-4111-8111-111111111111',
      vendorid: '22222222-2222-4222-8222-222222222222',
    })).toEqual({
      token: 'laohu-token',
      userId: 'user-1',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://user.laohu.com/openApi/secureLogin',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'User-Agent': 'LaohuSDK/4.327.0 (android os 14;mobile  manufacturer Google; model Pixel 6) ',
          'robot-auth-type': '2',
        }),
        body: expect.any(String),
      }),
    )

    const body = String(fetchMock.mock.calls[0]?.[1]?.body)
    expect(body).toContain('username=')
    expect(body).toContain('password=')
    expect(body).toContain('appId=10550')
    expect(body).toContain('channelId=1')
    expect(body).toContain('version=17')
    expect(body).toContain('sdkVersion=4.327.0')
    expect(body).toContain('deviceSys=14')
    expect(body).toContain('deviceType=Pixel+6')
    expect(body).toContain('adm=')
    expect(body).toContain('idfa=')
    expect(body).toContain('mac=')
    expect(body).not.toContain('13800138000')
    expect(body).not.toContain('secret-password')
  })

  it('identifies which login stage returned an upstream business error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 1, message: '系统错误' }), { status: 200 }),
    )
    const api = new TaygedoApi({ fetch: fetchMock })

    await expect(api.loginWithPassword('13800138000', 'secret-password', 'device-1')).rejects.toThrow(
      'loginWithPassword：系统错误',
    )
  })

  it.each([
    { code: 10, message: 'sdk token 验证失败' },
    { code: 22, message: '系统错误' },
    { code: 1, message: '其他错误' },
  ])('does not run the compatibility fallback for user center code $code / $message', async ({ code, message }) => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code, msg: message }), { status: 200 }),
    )
    const api = new TaygedoApi({ fetch: fetchMock })

    await expect(api.userCenterLogin('laohu-token', 'user-1', 'device-1')).rejects.toThrow(
      `userCenterLogin：${message}（HTTP 200，code=${code}）`,
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('falls back once to the proven 1.1.0 compatibility profile after the official profile returns code 1', async () => {
    const token = 'sensitive-laohu-token'
    const userId = '9223372036854775807'
    const deviceId = 'sensitive-device-id'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 1, msg: '系统错误' }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        msg: 'ok',
        data: { accessToken: 'access-token', refreshToken: 'refresh-token', uid: 'uid-1' },
      }), { status: 200 }))
    const logger = { info: vi.fn(), warn: vi.fn() }
    const api = new TaygedoApi({ fetch: fetchMock, logger })

    await expect(api.userCenterLogin(token, userId, deviceId)).resolves.toEqual({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      uid: 'uid-1',
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const officialBody = new URLSearchParams(String(fetchMock.mock.calls[0]?.[1]?.body))
    const compatBody = new URLSearchParams(String(fetchMock.mock.calls[1]?.[1]?.body))
    expect(officialBody.get('token')).toBe(token)
    expect(compatBody.get('token')).toBe(token)
    expect(officialBody.get('userIdentity')).toBe(userId)
    expect(compatBody.get('userIdentity')).toBe(userId)
    expect(compatBody.get('appId')).toBe('10551')

    const compatHeaders = fetchMock.mock.calls[1]?.[1]?.headers
    expect(compatHeaders).toEqual({
      authorization: '',
      appversion: '1.1.0',
      platform: 'android',
      uid: '10000000',
      deviceid: deviceId,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'okhttp/4.12.0',
    })
    expect(compatHeaders).not.toHaveProperty('ds')
    expect(compatHeaders).not.toHaveProperty('debug-uid')

    const logs = [...logger.info.mock.calls, ...logger.warn.mock.calls].flat().join('\n')
    expect(logs).toContain('profile=compat-1.1.0 HTTP=200 code=0')
    for (const secret of [token, userId, deviceId]) {
      expect(logs).not.toContain(secret)
    }
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('can route only the user center login request through a dedicated transport', async () => {
    const fetchMock = vi.fn()
    const userCenterFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 0,
      data: { accessToken: 'access', refreshToken: 'refresh', uid: '1' },
    }), { status: 200 }))
    const api = new TaygedoApi({ fetch: fetchMock, userCenterFetch })

    await expect(api.userCenterLogin('laohu-token', 'user-1', 'device-1')).resolves.toEqual({
      accessToken: 'access',
      refreshToken: 'refresh',
      uid: '1',
    })
    expect(userCenterFetch).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('routes refreshToken through the dedicated user center transport', async () => {
    const fetchMock = vi.fn()
    const userCenterFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 0,
      data: { accessToken: 'new-access', refreshToken: 'new-refresh', uid: '1' },
    }), { status: 200 }))
    const api = new TaygedoApi({ fetch: fetchMock, userCenterFetch })

    await expect(api.refreshToken('old-refresh', 'device-1', 'uid-1')).resolves.toEqual({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      uid: '1',
    })
    expect(userCenterFetch).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('preserves the official code 1 error when the compatibility profile also fails', async () => {
    const token = 'sensitive-laohu-token'
    const userId = 'sensitive-user-id'
    const deviceId = 'sensitive-device-id'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 1, msg: '系统错误' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 10, msg: `invalid ${token}` }), { status: 200 }))
    const logger = { info: vi.fn(), warn: vi.fn() }
    const api = new TaygedoApi({ fetch: fetchMock, logger })

    await expect(api.userCenterLogin(token, userId, deviceId)).rejects.toThrow(
      'userCenterLogin：系统错误（HTTP 200，code=1）',
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const logs = [...logger.info.mock.calls, ...logger.warn.mock.calls].flat().join('\n')
    expect(logs).toContain('profile=compat-1.1.0 HTTP=200 code=10')
    for (const secret of [token, userId, deviceId]) {
      expect(logs).not.toContain(secret)
    }
  })

  it.each([
    {
      name: 'network error',
      fallback: async (): Promise<Response> => { throw new Error('network failed with sensitive-laohu-token') },
    },
    {
      name: 'invalid json',
      fallback: async (): Promise<Response> => new Response('', { status: 200 }),
    },
  ])('preserves the official code 1 error when the compatibility fallback has a $name', async ({ fallback }) => {
    const token = 'sensitive-laohu-token'
    const userId = 'sensitive-user-id'
    const deviceId = 'sensitive-device-id'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 1, msg: '系统错误' }), { status: 200 }))
      .mockImplementationOnce(fallback)
    const logger = { info: vi.fn(), warn: vi.fn() }
    const api = new TaygedoApi({ fetch: fetchMock, logger })

    await expect(api.userCenterLogin(token, userId, deviceId)).rejects.toThrow(
      'userCenterLogin：系统错误（HTTP 200，code=1）',
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(logger.warn).toHaveBeenCalledTimes(1)
    const logs = [...logger.info.mock.calls, ...logger.warn.mock.calls].flat().join('\n')
    for (const secret of [token, userId, deviceId]) {
      expect(logs).not.toContain(secret)
    }
  })

  it('does not use the compatibility fallback for a non-2xx code 1 response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 1, msg: '系统错误' }), { status: 500 }),
    )
    const api = new TaygedoApi({ fetch: fetchMock })

    await expect(api.userCenterLogin('laohu-token', 'user-1', 'device-1')).rejects.toThrow(
      'userCenterLogin：系统错误（HTTP 500，code=1）',
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects a Laohu login response that omits the official userId', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 0, message: 'ok', result: { token: 'laohu-token' } }), { status: 200 }),
    )
    const api = new TaygedoApi({ fetch: fetchMock })

    await expect(api.loginWithPassword('13800138000', 'secret-password', 'device-1')).rejects.toThrow(
      'loginWithPassword 请求失败',
    )
  })

  it('preserves a Laohu long userId without JavaScript number rounding', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"code":0,"message":"ok","result":{"token":"laohu-token","userId":9223372036854775807}}', { status: 200 }),
    )
    const api = new TaygedoApi({ fetch: fetchMock })

    await expect(api.loginWithPassword('13800138000', 'secret-password', 'device-1')).resolves.toEqual({
      token: 'laohu-token',
      userId: '9223372036854775807',
    })
  })

  it('claims cloud yihuan duration through the laohu cloud endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        code: 0,
        message: 'ok',
        result: {
          perDayFirstLoginGiveDuration: '15',
          remainedDuration: '120',
        },
      }), { status: 200 }),
    )
    const api = new TaygedoApi({ fetch: fetchMock })

    await expect(api.cloudGetUserInfo('laohu-token', 'user-1', 'device-1')).resolves.toEqual({
      gave: 15,
      remained: 120,
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://user.laohu.com/cloud/game/getUserInfo',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'okhttp/3.12.1',
          Host: 'user.laohu.com',
        }),
        body: expect.any(String),
      }),
    )

    const body = new URLSearchParams(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(Object.fromEntries(body)).toEqual(expect.objectContaining({
      appId: '10597',
      channelId: '9',
      bid: 'com.pwrd.cloud.yh.laohu',
      sdkVersion: '1.34.0',
      token: 'laohu-token',
      userId: 'user-1',
      deviceId: 'device-1',
      sign: expect.any(String),
    }))
  })
})
