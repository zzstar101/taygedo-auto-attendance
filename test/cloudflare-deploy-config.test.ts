import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Cloudflare deploy button configuration', () => {
  it('only asks for the two secrets required by the Worker login flow', () => {
    const deployExample = readFileSync(join(process.cwd(), '.dev.vars.example'), 'utf8')

    expect(envKeys(deployExample)).toEqual([
      'TAYGEDO_ADMIN_TOKEN',
      'TAYGEDO_CREDENTIAL_KEY',
    ])
    expect(existsSync(join(process.cwd(), '.env.example'))).toBe(false)
  })

  it('keeps optional runtime variables outside Cloudflare deploy discovery', () => {
    const selfhostExample = readFileSync(join(process.cwd(), '.env.selfhost.example'), 'utf8')

    expect(envKeys(selfhostExample)).toContain('TAYGEDO_ACCOUNTS')
    expect(envKeys(selfhostExample)).toContain('TAYGEDO_NOTIFICATION_URLS')
    expect(envKeys(selfhostExample)).toContain('TAYGEDO_MAX_RETRIES')
  })

  it('documents how to generate both deployment secrets', () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      cloudflare?: { bindings?: Record<string, { description?: string }> }
    }

    expect(packageJson.cloudflare?.bindings?.TAYGEDO_ADMIN_TOKEN?.description).toContain('openssl rand -hex 32')
    expect(packageJson.cloudflare?.bindings?.TAYGEDO_CREDENTIAL_KEY?.description).toContain('openssl rand -hex 32')
  })
})

function envKeys(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map(line => line.match(/^([A-Z][A-Z0-9_]*)=/)?.[1])
    .filter((key): key is string => key !== undefined)
}
