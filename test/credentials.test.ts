import { describe, expect, it } from 'vitest'
import { decryptPassword, encryptPassword, generateCredentialKey } from '../src/config/credentials.js'

describe('credential encryption', () => {
  it('encrypts passwords without storing plaintext and decrypts with the same key', () => {
    const key = generateCredentialKey()
    const encrypted = encryptPassword('secret-password', key)

    expect(JSON.stringify(encrypted)).not.toContain('secret-password')
    expect(encrypted).toEqual(expect.objectContaining({
      v: 2,
      kdf: 'scrypt',
      salt: expect.any(String),
    }))
    expect(decryptPassword(encrypted, key)).toBe('secret-password')
  })

  it('keeps decrypting legacy v1 passwords for migration compatibility', () => {
    const legacyEncrypted = {
      v: 1 as const,
      alg: 'AES-256-GCM' as const,
      iv: 'ABEiM0RVZneImaq7',
      tag: 'Icyyd1dyb6ktv0j9BBblvQ',
      data: 'lLYHdXhogX6IK3lxJDLA',
    }

    expect(decryptPassword(legacyEncrypted, 'legacy-key')).toBe('secret-password')
  })

  it('rejects decrypting with a different key', () => {
    const encrypted = encryptPassword('secret-password', generateCredentialKey())

    expect(() => decryptPassword(encrypted, generateCredentialKey())).toThrow('存储密码解密失败，请检查 TAYGEDO_CREDENTIAL_KEY')
  })
})
