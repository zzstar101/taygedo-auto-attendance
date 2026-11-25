import { readFile } from 'node:fs/promises'

/**
 * 把配置文件内容解码成字符串。
 *
 * Windows 上用户经常用记事本 / VS Code（UTF-8 with BOM）或 PowerShell 5.1
 * （`>`、`Out-File` 默认写 UTF-16LE）保存 `accounts.json`，`JSON.parse`
 * 遇到这些文件只会抛 `Unexpected token`，很难自查。这里按 BOM 自动识别编码，
 * 避免"文件看着没错但解析不了"。
 */
export function decodeTextBuffer(buffer: Buffer): string {
  if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
    return buffer.subarray(3).toString('utf8')
  }
  if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
    return buffer.subarray(2).toString('utf16le')
  }
  if (buffer.length >= 2 && buffer[0] === 0xFE && buffer[1] === 0xFF) {
    const body = Buffer.from(buffer.subarray(2))
    body.swap16()
    return body.toString('utf16le')
  }
  return buffer.toString('utf8')
}

/** 读取文本文件并去掉 BOM，供账号/密钥等 JSON 配置使用。 */
export async function readTextFile(path: string): Promise<string> {
  return decodeTextBuffer(await readFile(path))
}

/** 去掉字符串开头的 BOM（环境变量里也可能带）。 */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text
}
