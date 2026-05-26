import { describe, expect, it, vi } from 'vitest'
import { sendNotification } from '../src/notify.js'

describe('sendNotification', () => {
  it('posts title and content to every notification url', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }))

    await sendNotification({
      urls: ['https://example.com/a', 'https://example.com/b'],
      title: '塔吉多每日签到',
      content: '签到完成',
      fetch: fetchMock,
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://example.com/a',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ title: '塔吉多每日签到', content: '签到完成' }),
      }),
    )
  })

  it('posts Server Chan notifications as url encoded title and desp fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }))

    await sendNotification({
      urls: ['https://sctapi.ftqq.com/SCT123.send'],
      title: '塔吉多每日签到',
      content: '签到完成',
      fetch: fetchMock,
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://sctapi.ftqq.com/SCT123.send',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        },
        body: new URLSearchParams({
          title: '塔吉多每日签到',
          desp: '签到完成',
        }).toString(),
      }),
    )
  })

  it('returns failed notification urls while continuing later sends', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('bad', { status: 500 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))

    const errors = await sendNotification({
      urls: ['https://example.com/a', 'https://example.com/b'],
      title: '塔吉多每日签到',
      content: '签到完成',
      fetch: fetchMock,
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(errors).toEqual([{
      url: 'https://example.com/a',
      error: 'HTTP 状态码 500',
    }])
  })
})
