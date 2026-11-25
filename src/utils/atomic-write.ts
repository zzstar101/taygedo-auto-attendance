import { randomBytes } from 'node:crypto'
import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface AtomicWriteOptions {
  /** 目标文件权限（POSIX）。传了就先在临时文件上收紧再替换。 */
  mode?: number
}

/**
 * 先写同目录临时文件再 rename 覆盖，避免半个文件被读走。
 *
 * 对敏感文件还多一层意义：`writeFile` 的 `mode` 只在新建文件时生效，
 * 覆盖已有文件不会收紧权限；而「先写完再 chmod」的窗口期里，新凭据其实
 * 已经以旧权限（可能是 0666）落盘了。改成「临时文件 + 收紧权限 + 原子替换」
 * 之后，只要替换成功，文件一定已经是 0600。
 */
export async function writeFileAtomically(
  path: string,
  payload: string,
  options: AtomicWriteOptions = {},
): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tempPath = `${path}.${process.pid}-${randomBytes(6).toString('hex')}.tmp`
  await writeFile(tempPath, payload, { encoding: 'utf8', mode: options.mode })
  try {
    if (options.mode !== undefined) {
      // Windows 上 chmod 只切换只读标记，偶发失败也不该让写入失败。
      await chmod(tempPath, options.mode).catch((error: unknown) => {
        if (process.platform !== 'win32') {
          throw error
        }
      })
    }
    await rename(tempPath, path)
  }
  catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }
}

/** 写敏感文件（账号 / 密钥）：内容只会在权限已收紧的临时文件里出现。 */
export async function writeSecretFile(path: string, payload: string): Promise<void> {
  await writeFileAtomically(path, payload, { mode: 0o600 })
}
