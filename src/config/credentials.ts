import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export type EncryptedPassword = LegacyEncryptedPassword | ScryptEncryptedPassword

export interface LegacyEncryptedPassword {
  v: 1
  alg: 'AES-256-GCM'
  iv: string
  tag: string
  data: string
}

export interface ScryptEncryptedPassword {
  v: 2
  alg: 'AES-256-GCM'
  kdf: 'scrypt'
  salt: string
  iv: string
  tag: string
  data: string
}

export function generateCredentialKey(): string {
  return randomBytes(32).toString('base64url')
}

export async function loadOrCreateCredentialKey(path: string): Promise<string> {
  try {
    const stored = (await readFile(path, 'utf8')).trim()
    if (stored) {
      return stored
    }
  }
  catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      throw error
    }
  }
  const key = generateCredentialKey()
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${key}\n`, { encoding: 'utf8', mode: 0o600 })
  return key
}

export function encryptPassword(password: string, credentialKey: string): EncryptedPassword {
  const salt = randomBytes(16)
  const key = deriveScryptKey(credentialKey, salt)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()])
  return {
    v: 2,
    alg: 'AES-256-GCM',
    kdf: 'scrypt',
    salt: salt.toString('base64url'),
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    data: encrypted.toString('base64url'),
  }
}

export function decryptPassword(encryptedPassword: EncryptedPassword, credentialKey: string): string {
  try {
    if (encryptedPassword.alg !== 'AES-256-GCM') {
      throw new Error('不支持的加密密码格式')
    }
    const key = encryptedPassword.v === 1
      ? deriveLegacyKey(credentialKey)
      : deriveScryptKey(credentialKey, Buffer.from(encryptedPassword.salt, 'base64url'))
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(encryptedPassword.iv, 'base64url'),
    )
    decipher.setAuthTag(Buffer.from(encryptedPassword.tag, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedPassword.data, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  }
  catch {
    throw new Error('存储密码解密失败，请检查 TAYGEDO_CREDENTIAL_KEY')
  }
}

function deriveLegacyKey(credentialKey: string): Buffer {
  return createHash('sha256').update(credentialKey, 'utf8').digest()
}

function deriveScryptKey(credentialKey: string, salt: Buffer): Buffer {
  return scryptSync(credentialKey, salt, 32, { N: 16384, r: 8, p: 1 })
}
