import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

interface PluginManifest {
  name: string
  version: string
}

interface CommandHook {
  command: string
  async?: boolean
}

interface HookGroup {
  matcher?: string
  hooks: CommandHook[]
}

interface HooksManifest {
  hooks: Record<string, HookGroup[]>
}

interface MarketplaceManifest {
  name: string
  plugins: Array<{
    name: string
    source: string | { source: string }
  }>
}

const root = process.cwd()
const pluginPath = join(root, '.claude-plugin', 'plugin.json')
const marketplacePath = join(root, '.claude-plugin', 'marketplace.json')
const hooksPath = join(root, 'hooks', 'hooks.json')
const packagePath = join(root, 'package.json')

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'))
}

describe('Claude Code plugin schema', () => {
  it('parses every plugin JSON file', () => {
    for (const path of [pluginPath, marketplacePath, hooksPath]) {
      expect(() => readJson(path)).not.toThrow()
    }
  })

  it('keeps the plugin identity aligned with package.json', () => {
    const plugin = readJson(pluginPath) as PluginManifest
    const packageJson = readJson(packagePath) as PluginManifest
    const marketplace = readJson(marketplacePath) as MarketplaceManifest

    expect(plugin.version).toBe(packageJson.version)
    expect(plugin.name).toBe('meanwhile')
    expect(marketplace.name).toBe('meanwhile')
    expect(marketplace.plugins.map((entry) => entry.name)).toEqual([
      'meanwhile',
    ])
  })

  it('points every hook at the bundled entrypoint', () => {
    const manifest = readJson(hooksPath) as HooksManifest
    const commands = Object.values(manifest.hooks).flatMap((groups) =>
      groups.flatMap((group) => group.hooks),
    )

    expect(commands.length).toBeGreaterThan(0)
    for (const command of commands) {
      expect(command.command).toContain(
        '${CLAUDE_PLUGIN_ROOT}/dist/meanwhile.mjs',
      )
    }
    expect(existsSync(join(root, 'dist', 'meanwhile.mjs'))).toBe(true)
  })

  it('uses only the supported events and required hook options', () => {
    const manifest = readJson(hooksPath) as HooksManifest
    const supportedEvents = new Set([
      'UserPromptSubmit',
      'Stop',
      'Notification',
      'SessionEnd',
    ])

    for (const eventName of Object.keys(manifest.hooks)) {
      expect(supportedEvents.has(eventName)).toBe(true)
    }

    expect(
      manifest.hooks.Notification?.some(
        (group) => group.matcher === 'permission_prompt|idle_prompt',
      ),
    ).toBe(true)
    expect(
      manifest.hooks.UserPromptSubmit?.flatMap((group) => group.hooks).every(
        (hook) => hook.async === true,
      ),
    ).toBe(true)
  })

  it('resolves the marketplace plugin source to this plugin', () => {
    const marketplace = readJson(marketplacePath) as MarketplaceManifest
    expect(marketplace.plugins).toHaveLength(1)

    const configuredSource = marketplace.plugins[0]?.source
    const source =
      typeof configuredSource === 'string'
        ? configuredSource
        : configuredSource?.source

    expect(source).toBeDefined()
    expect(
      existsSync(
        join(resolve(root, source as string), '.claude-plugin', 'plugin.json'),
      ),
    ).toBe(true)
  })
})
