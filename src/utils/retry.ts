export interface RetryOptions {
  baseDelayMs?: number
  maxDelayMs?: number
}

export async function withRetries<T>(
  operation: () => Promise<T>,
  maxAttempts: number,
  options: RetryOptions = {},
): Promise<T> {
  let lastError: unknown
  const attempts = Math.max(1, maxAttempts)
  const baseDelayMs = options.baseDelayMs ?? 1000
  const maxDelayMs = options.maxDelayMs ?? 30_000

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation()
    }
    catch (error) {
      lastError = error
      if (attempt < attempts) {
        await delay(Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1)))
      }
    }
  }

  throw lastError
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
