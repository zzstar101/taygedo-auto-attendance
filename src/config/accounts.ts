import type { EncryptedPassword } from './credentials.js'

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
  tokenUpdatedAt?: string
  phone?: string
  encryptedPassword?: EncryptedPassword
  roleId?: string
  roleName?: string
}

export function parseAccountsSecret(secret: string): TaygedoAccount[] {
  const parsed = JSON.parse(secret) as unknown
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
  field: 'accessToken' | 'openudid' | 'vendorid' | 'laohuToken' | 'laohuUserId' | 'tokenUpdatedAt' | 'phone',
): void {
  const value = optionalString(account, field)
  if (value) {
    parsedAccount[field] = value
  }
}
