import { describe, expect, it, vi } from 'vitest'
import { withRetries } from '../src/utils/retry.js'

describe('withRetries', () => {
  it('retries a failing operation until it succeeds', async () => {
    let attempts = 0

    const result = await withRetries(async () => {
      attempts++
      if (attempts < 3) {
        throw new Error('temporary failure')
      }
      return 'ok'
    }, 3)

    expect(result).toBe('ok')
    expect(attempts).toBe(3)
  })

  it('waits with backoff between failed attempts', async () => {
    vi.useFakeTimers()
    let attempts = 0

    try {
      const resultPromise = withRetries(async () => {
        attempts++
        if (attempts < 3) {
          throw new Error('temporary failure')
        }
        return 'ok'
      }, 3)

      await vi.advanceTimersByTimeAsync(999)
      expect(attempts).toBe(1)

      await vi.advanceTimersByTimeAsync(1)
      expect(attempts).toBe(2)

      await vi.advanceTimersByTimeAsync(2000)
      await expect(resultPromise).resolves.toBe('ok')
    }
    finally {
      vi.useRealTimers()
    }
  })
})
