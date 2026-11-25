import type { EncryptedPassword } from './credentials.js'
import { stripBom } from '../utils/text.js'

export interface TaygedoAccount {
  id: string
  name: string
  uid: string
  deviceId: string
  openudid?: string
  vendorid?: string
  refreshToken: string
  accessToken?: string
  laohuToken?: string
  laohuUserId?: string
  cloudToken?: string
  cloudUserId?: string
  tokenUpdatedAt?: string
  phone?: string
  encryptedPassword?: EncryptedPassword
  roleId?: string
  roleName?: string
}

export function parseAccountsSecret(secret: string): TaygedoAccount[] {
  // Windows 下用记事本或 PowerShell 保存的账号文件常带 BOM，JSON.parse 会直接报
  // `Unexpected token`，这里先清掉 BOM 再做解析。
  const parsed = parseJson(stripBom(secret).trim()) as unknown
  if (!Array.isArray(parsed)) {
    throw new Error('TAYGEDO_ACCOUNTS 必须是 JSON 数组')
  }

  const ids = new Set<string>()
  return parsed.map((account, index) => {
    if (!isRecord(account)) {
      throw new Error(`第 ${index} 个账号必须是对象`)
    }

    const id = requireString(account, 'id', index)
    if (ids.has(id)) {
      throw new Error(`账号 id 重复：${id}`)
    }
    ids.add(id)

    const parsedAccount: TaygedoAccount = {
      id,
      name: requireString(account, 'name', index, id),
      uid: requireString(account, 'uid', index, id),
      deviceId: requireString(account, 'deviceId', index, id),
      refreshToken: requireString(account, 'refreshToken', index, id),
    }

    assignOptionalString(parsedAccount, account, 'accessToken')
    assignOptionalString(parsedAccount, account, 'openudid')
    assignOptionalString(parsedAccount, account, 'vendorid')
    assignOptionalString(parsedAccount, account, 'laohuToken')
    assignOptionalString(parsedAccount, account, 'laohuUserId')
    assignOptionalString(parsedAccount, account, 'cloudToken')
    assignOptionalString(parsedAccount, account, 'cloudUserId')
    assignOptionalString(parsedAccount, account, 'tokenUpdatedAt')
    assignOptionalString(parsedAccount, account, 'phone')
    assignOptionalEncryptedPassword(parsedAccount, account, index, id)

    const roleId = optionalString(account, 'roleId')
    const roleName = optionalString(account, 'roleName')
    if (roleId) {
      parsedAccount.roleId = roleId
    }
    if (roleName) {
      parsedAccount.roleName = roleName
    }

    return parsedAccount
  })
}

function assignOptionalEncryptedPassword(
  parsedAccount: TaygedoAccount,
  account: Record<string, unknown>,
  index: number,
  id = String(account.id ?? index),
): void {
  const field = 'encryptedPassword'
  const value = account[field]
  if (value === undefined) {
    return
  }
  if (!isRecord(value)) {
    throw new Error(`账号 ${id} 的可选字段 ${field} 必须是对象`)
  }
  const encryptedPassword = {
    v: value.v,
    alg: value.alg,
    kdf: value.kdf,
    salt: value.salt,
    iv: value.iv,
    tag: value.tag,
    data: value.data,
  }
  if (
    (encryptedPassword.v !== 1 && encryptedPassword.v !== 2)
    || encryptedPassword.alg !== 'AES-256-GCM'
    || typeof encryptedPassword.iv !== 'string'
    || typeof encryptedPassword.tag !== 'string'
    || typeof encryptedPassword.data !== 'string'
    || !encryptedPassword.iv
    || !encryptedPassword.tag
    || !encryptedPassword.data
    || (encryptedPassword.v === 2 && (encryptedPassword.kdf !== 'scrypt' || typeof encryptedPassword.salt !== 'string' || !encryptedPassword.salt))
  ) {
    throw new Error(`账号 ${id} 的可选字段 ${field} 格式无效`)
  }
  parsedAccount.encryptedPassword = encryptedPassword.v === 1
    ? {
        v: 1,
        alg: 'AES-256-GCM',
        iv: encryptedPassword.iv,
        tag: encryptedPassword.tag,
        data: encryptedPassword.data,
      }
    : {
        v: 2,
        alg: 'AES-256-GCM',
        kdf: 'scrypt',
        salt: encryptedPassword.salt as string,
        iv: encryptedPassword.iv,
        tag: encryptedPassword.tag,
        data: encryptedPassword.data,
      }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  }
  catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    // 文件里出现 \u0000 基本可以确定是 UTF-16 存储被当成 UTF-8 读了。
    const hint = text.includes('\u0000')
      ? '；文件看起来是 UTF-16 编码，请另存为 UTF-8（或直接用本工具写入）'
      : ''
    throw new Error(`TAYGEDO_ACCOUNTS 不是合法的 JSON：${reason}${hint}`)
  }
}

function requireString(
  account: Record<string, unknown>,
  field: keyof TaygedoAccount,
  index: number,
  id = String(account.id ?? index),
): string {
  const value = account[field]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`账号 ${id} 缺少必填字段 ${field}`)
  }
  return value
}

function optionalString(account: Record<string, unknown>, field: keyof TaygedoAccount): string | undefined {
  const value = account[field]
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`可选字段 ${field} 如提供则必须是非空字符串`)
  }
  return value
}

function assignOptionalString(
  parsedAccount: TaygedoAccount,
  account: Record<string, unknown>,
  field: 'accessToken' | 'openudid' | 'vendorid' | 'laohuToken' | 'laohuUserId' | 'cloudToken' | 'cloudUserId' | 'tokenUpdatedAt' | 'phone',
): void {
  const value = optionalString(account, field)
  if (value) {
    parsedAccount[field] = value
  }
}
