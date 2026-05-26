import { describe, expect, it } from 'vitest'
import { decryptPassword, encryptPassword, generateCredentialKey } from '../src/config/credentials.js'

describe('credential encryption', () => {
  it('encrypts passwords without storing plaintext and decrypts with the same key', () => {
    const key = generateCredentialKey()
    const encrypted = encryptPassword('secret-password', key)

    expect(JSON.stringify(encrypted)).not.toContain('secret-password')
    expect(decryptPassword(encrypted, key)).toBe('secret-password')
  })

  it('rejects decrypting with a different key', () => {
    const encrypted = encryptPassword('secret-password', generateCredentialKey())

    expect(() => decryptPassword(encrypted, generateCredentialKey())).toThrow('存储密码解密失败，请检查 TAYGEDO_CREDENTIAL_KEY')
  })
})
