import { randomBytes } from 'node:crypto'
import { chmod, lstat, mkdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface AtomicWriteOptions {
  /** 目标文件的权限位（POSIX）。 */
  mode?: number
  /**
   * 目标文件已存在时沿用它的权限位。
   *
   * 状态文件用这个：老实现是原地 `writeFile`，已有 `0600` 会保持 `0600`；
   * 换成「临时文件 + rename」后如果不带原权限，`umask 022` 会把它放大成 `0644`，
   * 而 `last-run.json` 里可能带着完整的 Webhook URL / SendKey。
   */
  preserveMode?: boolean
}

/**
 * 先写同目录临时文件再 rename 覆盖，避免半个文件被读走。
 *
 * 对敏感文件还多一层意义：`writeFile` 的 `mode` 只在新建文件时生效，覆盖已有文件
 * 不收紧权限；而「写完再 chmod」的窗口期里，新凭据其实已经以旧权限（可能是 0666）
 * 落盘了。改成「临时文件 + 收紧权限 + 原子替换」后，只要替换成功，文件一定已经是 0600。
 */
export async function writeFileAtomically(
  path: string,
  payload: string,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const target = await resolveWriteTarget(path)
  const mode = options.mode ?? (options.preserveMode ? await existingMode(target) : undefined)
  await mkdir(dirname(target), { recursive: true })
  const tempPath = `${target}.${process.pid}-${randomBytes(6).toString('hex')}.tmp`
  await writeFile(tempPath, payload, { encoding: 'utf8', mode })
  try {
    if (mode !== undefined) {
      // umask 会削掉权限位，显式补一次；Windows 上 chmod 只切只读位，失败也不该阻断写入。
      await chmod(tempPath, mode).catch((error: unknown) => {
        if (process.platform !== 'win32') {
          throw error
        }
      })
    }
    await rename(tempPath, target)
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

/**
 * 符号链接要写到它指向的真实文件。
 *
 * `rename` 替换的是目录项本身：直接把临时文件改名到链接路径，链接会变成普通文件，
 * 共享账号文件的其它定时任务继续读旧内容。
 */
async function resolveWriteTarget(path: string): Promise<string> {
  try {
    const info = await lstat(path)
    if (!info.isSymbolicLink()) {
      return path
    }
    return await realpath(path)
  }
  catch {
    // 文件还不存在（或链接断了）：按普通新建处理。
    return path
  }
}

async function existingMode(path: string): Promise<number | undefined> {
  try {
    return (await stat(path)).mode & 0o777
  }
  catch {
    return undefined
  }
}
