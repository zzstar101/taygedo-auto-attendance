import { describe, expect, it, vi } from 'vitest'
import { TaygedoApi } from '../src/taygedo/api.js'

describe('TaygedoApi', () => {
  it('refreshes tokens using the stored refreshToken and device id', async () => {
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

    const result = await api.refreshToken('old-refresh', 'device-1')

    expect(result).toEqual({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://bbs-api.tajiduo.com/usercenter/api/refreshToken',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'old-refresh',
          deviceid: 'device-1',
          appversion: '1.1.0',
        }),
      }),
    )
  })

  it('reports which endpoint returned invalid json', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 200 }))
    const api = new TaygedoApi({ fetch: fetchMock })

    await expect(api.refreshToken('old-refresh', 'device-1')).rejects.toThrow(
      'refreshToken 返回了无效 JSON（HTTP 200，响应为空）',
    )
  })

  it('classifies an empty HTTP 402 refresh response as a rejected refresh token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 402 }))
    const api = new TaygedoApi({ fetch: fetchMock })

    await expect(api.refreshToken('old-refresh', 'device-1')).rejects.toThrow(
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
          authorization: 'access-token',
          uid: 'uid-1',
          deviceid: 'device-1',
        }),
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
          appversion: '1.2.2',
          platform: 'ios',
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
    await expect(api.checkCaptcha('13800138000', '123456', 'device-1')).resolves.toBeUndefined()
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
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://user.laohu.com/m/newApi/checkPhoneCaptchaWithOutLogin',
      expect.objectContaining({
        method: 'POST',
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://user.laohu.com/openApi/sms/new/login',
      expect.objectContaining({
        method: 'POST',
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      'https://bbs-api.tajiduo.com/usercenter/api/login',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          deviceid: 'device-1',
          appversion: '1.1.0',
        }),
      }),
    )
  })

  it('logs in with a password through the laohu secureLogin endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 0, message: 'ok', result: { token: 'laohu-token', userId: 'user-1' } }), { status: 200 }),
    )
    const api = new TaygedoApi({ fetch: fetchMock })

    expect(await api.loginWithPassword('13800138000', 'secret-password', 'device-1')).toEqual({
      token: 'laohu-token',
      userId: 'user-1',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://user.laohu.com/openApi/secureLogin',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          platform: 'android',
          'Content-Type': 'application/x-www-form-urlencoded',
        }),
        body: expect.any(String),
      }),
    )

    const body = String(fetchMock.mock.calls[0]?.[1]?.body)
    expect(body).toContain('username=')
    expect(body).toContain('password=')
    expect(body).not.toContain('13800138000')
    expect(body).not.toContain('secret-password')
  })
})
