import { describe, expect, it, vi } from 'vitest'
import { buildH5Request, buildNativeRequest, makeDs, nonceIndexFromByte } from '../src/taygedo/protocol.js'

describe('taygedo protocol helpers', () => {
  it('builds a deterministic ds signature', () => {
    expect(makeDs({ timestamp: 1710000000, nonce: 'ABCDEFGH' })).toBe('1710000000,ABCDEFGH,6cf4e2edb3dc484539a2b8d90080c2db')
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
        appversion: '1.2.2',
        platform: 'ios',
        uid: 'uid-1',
        deviceid: 'device-1',
        ds: '1710000000,ABCDEFGH,6cf4e2edb3dc484539a2b8d90080c2db',
        'Content-Type': 'application/x-www-form-urlencoded',
      }),
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
