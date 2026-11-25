import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decodeTextBuffer, readTextFile, stripBom } from '../src/utils/text.js'
import { parseAccountsSecret } from '../src/config/accounts.js'
import { FileAccountStore } from '../src/stores/account-store.js'

const ACCOUNTS_JSON = '[{"id":"main","name":"主账号","uid":"123456","deviceId":"device-1","refreshToken":"refresh-token"}]'

function utf8WithBom(text: string): Buffer {
  return Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(text, 'utf8')])
}

function utf16le(text: string): Buffer {
  // PowerShell 5.1 的 `>` / Out-File 默认就是 UTF-16LE + BOM
  return Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(text, 'utf16le')])
}

function utf16be(text: string): Buffer {
  const body = Buffer.from(text, 'utf16le')
  body.swap16()
  return Buffer.concat([Buffer.from([0xFE, 0xFF]), body])
}

describe('Windows 文本编码兼容', () => {
  it('按 BOM 解码 UTF-8 / UTF-16LE / UTF-16BE', () => {
    expect(decodeTextBuffer(utf8WithBom('账号'))).toBe('账号')
    expect(decodeTextBuffer(utf16le('账号'))).toBe('账号')
    expect(decodeTextBuffer(utf16be('账号'))).toBe('账号')
    expect(decodeTextBuffer(Buffer.from('账号', 'utf8'))).toBe('账号')
  })

  it('解析记事本保存的带 BOM 账号 JSON', () => {
    const accounts = parseAccountsSecret(`\uFEFF${ACCOUNTS_JSON}`)

    expect(accounts).toHaveLength(1)
    expect(accounts[0]?.id).toBe('main')
  })

  it('把 UTF-16 存储被当成 UTF-8 读取的情况提示出来', () => {
    expect(() => parseAccountsSecret('[\u0000{\u0000"\u0000i\u0000d\u0000')).toThrow(/UTF-16/)
  })

  it('读取 PowerShell 输出的 UTF-16LE 账号文件', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taygedo-encoding-'))
    const path = join(dir, 'accounts.json')

    try {
      await writeFile(path, utf16le(ACCOUNTS_JSON))

      const store = new FileAccountStore(path)
      const accounts = parseAccountsSecret(await store.readAccounts())

      expect(accounts).toHaveLength(1)
      expect(accounts[0]?.name).toBe('主账号')
    }
    finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('读取带 BOM 的文本文件', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taygedo-encoding-'))
    const path = join(dir, 'accounts.json')

    try {
      await writeFile(path, utf8WithBom(ACCOUNTS_JSON))

      await expect(readTextFile(path)).resolves.toBe(ACCOUNTS_JSON)
      expect(stripBom('\uFEFFabc')).toBe('abc')
      expect(stripBom('abc')).toBe('abc')
    }
    finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
