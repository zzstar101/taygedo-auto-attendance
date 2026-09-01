import { describe, expect, it, vi } from 'vitest'
import { buildH5Request, buildNativeRequest, buildUserCenterSessionRequest, makeDs, nonceIndexFromByte } from '../src/taygedo/protocol.js'

describe('taygedo protocol helpers', () => {
  it('builds a deterministic ds signature', () => {
    expect(makeDs({ timestamp: 1770000000, nonce: 'AbCd1234' })).toBe('1770000000,AbCd1234,98d886c4c3b3f68edbd335e706e66370')
    expect(makeDs({ timestamp: 1710000000, nonce: 'ABCDEFGH', appVersion: '1.2.2' })).toBe('1710000000,ABCDEFGH,6cf4e2edb3dc484539a2b8d90080c2db')
  })

  it('builds native requests with ds and device headers', () => {
    const nonce = vi.fn().mockReturnValue('ABCDEFGH')
    const request = buildNativeRequest({
      accessToken: 'access-token',
      uid: 'uid-1',
      deviceId: 'device-1',
      method: 'POST',
      path: '/bbs/api/post/like',
      body: { postId: 'post-1' },
      now: () => new Date('2024-03-09T16:00:00.000Z'),
      nonce,
    })

    expect(request.url).toBe('https://bbs-api.tajiduo.com/bbs/api/post/like')
    expect(request.init).toEqual(expect.objectContaining({
      method: 'POST',
      body: 'postId=post-1',
      headers: expect.objectContaining({
        Authorization: 'access-token',
        appversion: '1.2.5',
        platform: 'android',
        uid: 'uid-1',
        deviceid: 'device-1',
        ds: '1710000000,ABCDEFGH,21f5f0405f0c3e3bcc048bdc56db2439',
        'User-Agent': 'okhttp/4.12.0',
        'Content-Type': 'application/x-www-form-urlencoded',
      }),
    }))
  })

  it('builds official user center login requests with the 1.2.5 session profile', () => {
    const request = buildUserCenterSessionRequest({
      authorization: '',
      uid: '0',
      deviceId: 'device-1',
      path: '/usercenter/api/login',
      body: {
        token: 'laohu-token',
        userIdentity: 'laohu-user',
        appId: '10551',
      },
      now: () => new Date('2024-03-09T16:00:00.000Z'),
      nonce: () => 'ABCDEFGH',
    })

    expect(request).toEqual({
      url: 'https://bbs-api.tajiduo.com/usercenter/api/login',
      init: {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/plain, */*',
          Authorization: '',
          appVersion: '1.2.5',
          platform: 'android',
          uid: '0',
          'debug-uid': '3',
          deviceId: 'device-1',
          ds: '1710000000,ABCDEFGH,21f5f0405f0c3e3bcc048bdc56db2439',
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'okhttp/4.12.0',
        },
        body: 'token=laohu-token&userIdentity=laohu-user&appId=10551',
      },
    })
  })

  it('builds official refresh requests without a request body', () => {
    const request = buildUserCenterSessionRequest({
      authorization: 'refresh-token',
      uid: 'uid-1',
      deviceId: 'device-1',
      path: '/usercenter/api/refreshToken',
      now: () => new Date('2024-03-09T16:00:00.000Z'),
      nonce: () => 'ABCDEFGH',
    })

    expect(request.url).toBe('https://bbs-api.tajiduo.com/usercenter/api/refreshToken')
    expect(request.init.method).toBe('POST')
    expect(request.init).not.toHaveProperty('body')
    expect(request.init.headers).toEqual(expect.objectContaining({
      Authorization: 'refresh-token',
      uid: 'uid-1',
      deviceId: 'device-1',
      appVersion: '1.2.5',
      platform: 'android',
      'debug-uid': '3',
      ds: '1710000000,ABCDEFGH,21f5f0405f0c3e3bcc048bdc56db2439',
      'Content-Type': 'application/x-www-form-urlencoded',
    }))
  })

  it('builds h5 requests without ds headers', () => {
    const request = buildH5Request({
      accessToken: 'access-token',
      method: 'GET',
      path: '/apihub/awapi/signin/state',
      query: { gameId: '1256' },
    })

    expect(request.url).toBe('https://bbs-api.tajiduo.com/apihub/awapi/signin/state?gameId=1256')
    expect(request.init.headers).toEqual(expect.objectContaining({
      Authorization: 'access-token',
      Origin: 'https://webstatic.tajiduo.com',
      Referer: 'https://webstatic.tajiduo.com/',
    }))
    expect(request.init.headers).not.toHaveProperty('ds')
  })

  it('rejects random bytes that would bias nonce character selection', () => {
    expect(nonceIndexFromByte(247)).toBe(61)
    expect(nonceIndexFromByte(248)).toBeUndefined()
    expect(nonceIndexFromByte(255)).toBeUndefined()
  })
})
