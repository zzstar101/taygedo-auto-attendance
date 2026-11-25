import { mkdir, open, rm, stat } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface FileLockOptions {
  /** 等锁的总时长，超时抛错。 */
  timeoutMs?: number
  /** 锁文件超过这个时长没有更新，视为残留锁（进程崩了没删）。 */
  staleMs?: number
}

/**
 * 跨进程的互斥锁（`O_EXCL` 创建锁文件）。
 *
 * 账号文件是「读 → 合并 → 写」三步，只用原子写解决不了并发：两个实例可能都读到
 * 同一份旧内容，后写的一方会把前一方刚刷新的 token 覆盖回旧值。把这三步整体放进
 * 锁里，第二个实例必须等第一个写完再读。
 */
export async function withFileLock<T>(
  lockPath: string,
  task: () => Promise<T>,
  options: FileLockOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 15_000
  const staleMs = options.staleMs ?? 60_000
  await mkdir(dirname(lockPath), { recursive: true })
  const deadline = Date.now() + timeoutMs

  for (;;) {
    try {
      const handle = await open(lockPath, 'wx')
      await handle.close()
      break
    }
    catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error
      }
      if (await isStaleLock(lockPath, staleMs)) {
        await rm(lockPath, { force: true }).catch(() => undefined)
        continue
      }
      if (Date.now() >= deadline) {
        throw new Error(`等待账号文件锁超时（${lockPath}），请确认没有卡住的进程`)
      }
      await delay(20 + Math.floor(Math.random() * 30))
    }
  }

  try {
    return await task()
  }
  finally {
    await rm(lockPath, { force: true }).catch(() => undefined)
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST'
}

async function isStaleLock(lockPath: string, staleMs: number): Promise<boolean> {
  try {
    const info = await stat(lockPath)
    return Date.now() - info.mtimeMs > staleMs
  }
  catch {
    // 锁刚被别的进程释放了，直接重试抢锁。
    return true
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
