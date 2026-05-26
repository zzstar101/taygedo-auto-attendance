import { describe, expect, it } from 'vitest'
import { loadRuntimeConfig } from '../src/config/runtime.js'

describe('loadRuntimeConfig', () => {
  it('loads defaults and notification urls from env', () => {
    expect(loadRuntimeConfig({
      TAYGEDO_ACCOUNTS: '[{"id":"main"}]',
      TAYGEDO_NOTIFICATION_URLS: ' https://example.com/a,https://example.com/b ',
      TAYGEDO_SERVERCHAN_SENDKEY: ' SCT123 ',
    })).toEqual(expect.objectContaining({
      accountsSecret: '[{"id":"main"}]',
      notificationUrls: [
        'https://example.com/a',
        'https://example.com/b',
        'https://sctapi.ftqq.com/SCT123.send',
      ],
      maxRetries: 3,
      updatedAccountsPath: 'updated-accounts.json',
      accountStore: 'env',
      stateStore: 'memory',
      accountsKey: 'TAYGEDO_ACCOUNTS',
      statePrefix: 'taygedo',
      accountPasswords: {},
      forceRun: false,
      coinTasks: true,
      sharePlatform: 'qq',
      loopSeconds: undefined,
    }))
  })

  it('loads coin task options from env', () => {
    expect(loadRuntimeConfig({
      TAYGEDO_COIN_TASKS: 'false',
      TAYGEDO_SHARE_PLATFORM: 'wb',
    })).toEqual(expect.objectContaining({
      coinTasks: false,
      sharePlatform: 'wb',
    }))
  })

  it('loads docker loop seconds from env', () => {
    expect(loadRuntimeConfig({ TAYGEDO_LOOP_SECONDS: '86400' })).toEqual(expect.objectContaining({
      loopSeconds: 86400,
    }))
  })

  it('loads the force run flag from env', () => {
    expect(loadRuntimeConfig({ TAYGEDO_FORCE_RUN: 'true' })).toEqual(expect.objectContaining({
      forceRun: true,
    }))
    expect(loadRuntimeConfig({ TAYGEDO_FORCE_RUN: '1' })).toEqual(expect.objectContaining({
      forceRun: true,
    }))
  })

  it('loads account passwords from a json map and default password env', () => {
    expect(loadRuntimeConfig({
      TAYGEDO_PASSWORDS: '{"main":"main-password","13800138000":"phone-password"}',
      TAYGEDO_LOGIN_PASSWORD: 'default-password',
      TAYGEDO_LOGIN_ACCOUNT_ID: 'alt',
      TAYGEDO_CREDENTIAL_KEY: 'credential-key',
    })).toEqual(expect.objectContaining({
      credentialKey: 'credential-key',
      accountPasswords: {
        main: 'main-password',
        '13800138000': 'phone-password',
        default: 'default-password',
        alt: 'default-password',
      },
    }))
  })

  it('loads storage settings and admin token', () => {
    expect(loadRuntimeConfig({
      TAYGEDO_MAX_RETRIES: '5',
      TAYGEDO_UPDATED_ACCOUNTS_PATH: 'out/accounts.json',
      TAYGEDO_ACCOUNT_STORE: 'cloudflare-kv',
      TAYGEDO_STATE_STORE: 'upstash',
      TAYGEDO_ACCOUNTS_KEY: 'accounts',
      TAYGEDO_STATE_PREFIX: 'prod',
      TAYGEDO_ADMIN_TOKEN: 'admin-token',
      TAYGEDO_UPSTASH_REDIS_REST_URL: 'https://redis.example.com',
      TAYGEDO_UPSTASH_REDIS_REST_TOKEN: 'redis-token',
    })).toEqual(expect.objectContaining({
      accountsSecret: undefined,
      maxRetries: 5,
      updatedAccountsPath: 'out/accounts.json',
      accountStore: 'cloudflare-kv',
      stateStore: 'upstash',
      accountsKey: 'accounts',
      statePrefix: 'prod',
      adminToken: 'admin-token',
      upstashUrl: 'https://redis.example.com',
      upstashToken: 'redis-token',
    }))
  })

  it('accepts unstorage store kinds', () => {
    expect(loadRuntimeConfig({
      TAYGEDO_ACCOUNT_STORE: 'unstorage',
      TAYGEDO_STATE_STORE: 'unstorage',
    })).toEqual(expect.objectContaining({
      accountStore: 'unstorage',
      stateStore: 'unstorage',
    }))
  })

  it('rejects invalid retry values', () => {
    expect(() => loadRuntimeConfig({ TAYGEDO_MAX_RETRIES: 'nope' })).toThrow('TAYGEDO_MAX_RETRIES 必须是正整数')
  })
})
