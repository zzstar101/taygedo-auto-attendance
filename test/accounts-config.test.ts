import { describe, expect, it } from 'vitest'
import { parseAccountsSecret } from '../src/config/accounts.js'

describe('parseAccountsSecret', () => {
  it('parses a JSON secret into account records', () => {
    const accounts = parseAccountsSecret(
      JSON.stringify([
        {
          id: 'main',
          name: '主账号',
          uid: '123456',
          deviceId: 'abcdef1234567890',
          openudid: 'OPENUDID-1',
          vendorid: 'VENDORID-1',
          refreshToken: 'refresh-token',
          accessToken: 'access-token',
          laohuToken: 'laohu-token',
          laohuUserId: 'laohu-user',
          tokenUpdatedAt: '2026-05-07T08:00:00+08:00',
          phone: '13800138000',
          encryptedPassword: {
            v: 2,
            alg: 'AES-256-GCM',
            kdf: 'scrypt',
            salt: 'salt',
            iv: 'iv',
            tag: 'tag',
            data: 'data',
          },
          roleId: 'role-1',
          roleName: '角色一',
        },
      ]),
    )

    expect(accounts).toEqual([
      {
        id: 'main',
        name: '主账号',
        uid: '123456',
        deviceId: 'abcdef1234567890',
        openudid: 'OPENUDID-1',
        vendorid: 'VENDORID-1',
        refreshToken: 'refresh-token',
        accessToken: 'access-token',
        laohuToken: 'laohu-token',
        laohuUserId: 'laohu-user',
        tokenUpdatedAt: '2026-05-07T08:00:00+08:00',
        phone: '13800138000',
        encryptedPassword: {
          v: 2,
          alg: 'AES-256-GCM',
          kdf: 'scrypt',
          salt: 'salt',
          iv: 'iv',
          tag: 'tag',
          data: 'data',
        },
        roleId: 'role-1',
        roleName: '角色一',
      },
    ])
  })

  it('rejects an account missing required fields', () => {
    expect(() =>
      parseAccountsSecret(
        JSON.stringify([
          {
            id: 'main',
            name: '主账号',
            uid: '123456',
            deviceId: 'abcdef1234567890',
          },
        ]),
      ),
    ).toThrow('账号 main 缺少必填字段 refreshToken')
  })

  it('rejects duplicate account ids', () => {
    expect(() =>
      parseAccountsSecret(
        JSON.stringify([
          {
            id: 'main',
            name: '主账号',
            uid: '123456',
            deviceId: 'device-a',
            refreshToken: 'refresh-a',
          },
          {
            id: 'main',
            name: '备用账号',
            uid: '654321',
            deviceId: 'device-b',
            refreshToken: 'refresh-b',
          },
        ]),
      ),
    ).toThrow('账号 id 重复：main')
  })

  it('rejects empty optional session fields', () => {
    expect(() =>
      parseAccountsSecret(
        JSON.stringify([
          {
            id: 'main',
            name: '主账号',
            uid: '123456',
            deviceId: 'device-a',
            refreshToken: 'refresh-a',
            accessToken: '',
          },
        ]),
      ),
    ).toThrow('可选字段 accessToken 如提供则必须是非空字符串')
  })

  it('drops legacy plaintext password fields from parsed accounts', () => {
    const accounts = parseAccountsSecret(
      JSON.stringify([
        {
          id: 'main',
          name: '主账号',
          uid: '123456',
          deviceId: 'device-a',
          refreshToken: 'refresh-a',
          password: 'secret-password',
          passwordUpdatedAt: '2026-05-08T00:00:00.000Z',
        },
      ]),
    )

    expect(JSON.stringify(accounts)).not.toContain('secret-password')
    expect(accounts[0]).not.toHaveProperty('password')
    expect(accounts[0]).not.toHaveProperty('passwordUpdatedAt')
  })
})
