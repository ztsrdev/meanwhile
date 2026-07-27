import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CODEX_EVENTS,
  codexHookCommand,
  inspectCodexHooks,
  isMeanwhileCommand,
  mergeCodexHooks,
  removeCodexHooks,
} from '../src/commands/codex-hooks.js'
import {
  configEntries,
  configGet,
  configSet,
  runConfig,
  VALID_CONFIG_KEYS,
} from '../src/commands/config.js'
import { runInstall } from '../src/commands/install.js'
import type { CommandIO } from '../src/commands/io.js'
import { codexHooksPath, vendoredBundlePath } from '../src/commands/paths.js'
import { runStatus } from '../src/commands/status.js'
import { runUninstall } from '../src/commands/uninstall.js'
import type { DetectionReport } from '../src/detect.js'
import { configPath, logPath } from '../src/engine/paths.js'
import { createTestHome, removeTestHome } from './helpers.js'

function readHooks(): Record<string, unknown> {
  return JSON.parse(readFileSync(codexHooksPath(), 'utf8')) as Record<
    string,
    unknown
  >
}

// Codex only loads events under the top-level "hooks" wrapper key.
function readHookEvents(): Record<string, unknown> {
  return (readHooks().hooks ?? {}) as Record<string, unknown>
}

function hookCommands(groups: unknown): string[] {
  if (!Array.isArray(groups)) {
    return []
  }
  return groups.flatMap((group: unknown) => {
    if (
      typeof group !== 'object' ||
      group === null ||
      !Array.isArray((group as { hooks?: unknown }).hooks)
    ) {
      return []
    }
    return (group as { hooks: unknown[] }).hooks.flatMap((hook) =>
      typeof hook === 'object' &&
      hook !== null &&
      typeof (hook as { command?: unknown }).command === 'string'
        ? [(hook as { command: string }).command]
        : [],
    )
  })
}

function recordingIO(confirmImpl: CommandIO['confirm'] = async () => true): {
  io: CommandIO
  stdout: string[]
  stderr: string[]
} {
  const stdout: string[] = []
  const stderr: string[] = []
  return {
    stdout,
    stderr,
    io: {
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
      confirm: confirmImpl,
    },
  }
}

function detection(): DetectionReport {
  return {
    claude: {
      found: true,
      path: '/fake/bin/claude',
      version: '2.1.220',
      versionSkipped: false,
    },
    codex: {
      found: true,
      path: '/fake/bin/codex',
      version: 'codex-cli 0.144.1',
      versionSkipped: false,
    },
    conductor: {
      found: false,
      path: '/Applications/Conductor.app',
    },
  }
}

describe('Codex hook installation', () => {
  let testHome: string
  let codexHome: string

  beforeEach(() => {
    testHome = createTestHome()
    delete process.env.MEANWHILE_DRYRUN
    codexHome = join(testHome, 'codex')
    process.env.CODEX_HOME = codexHome
  })

  afterEach(() => {
    delete process.env.CODEX_HOME
    removeTestHome(testHome)
  })

  it('creates all four first-class hooks without async keys', () => {
    mergeCodexHooks()
    const hooks = readHookEvents()

    for (const event of CODEX_EVENTS) {
      expect(hookCommands(hooks[event])).toEqual([
        codexHookCommand(vendoredBundlePath()),
      ])
      expect(JSON.stringify(hooks[event])).not.toContain('"async"')
      expect(JSON.stringify(hooks[event])).toContain('"timeout":10')
    }
  })

  it('recognizes a pre-rename Codex hook command for cleanup', () => {
    expect(
      isMeanwhileCommand('node /legacy/awaitlingo.mjs hook --harness codex'),
    ).toBe(true)
  })

  it('writes events under the "hooks" wrapper key only', () => {
    mergeCodexHooks()
    expect(Object.keys(readHooks())).toEqual(['hooks'])
  })

  it('merges with foreign hooks and preserves their values', () => {
    mkdirSync(codexHome, { recursive: true })
    const foreignGroup = {
      matcher: 'tool',
      custom: { untouched: ['yes', 7] },
      hooks: [
        {
          type: 'command',
          command: '/usr/local/bin/foreign-hook --flag',
          timeout: 37,
          extra: true,
        },
      ],
    }
    writeFileSync(
      codexHooksPath(),
      JSON.stringify({
        UserPromptSubmit: [foreignGroup],
        ForeignEvent: [{ hooks: [{ type: 'prompt', prompt: 'keep me' }] }],
      }),
      'utf8',
    )

    const result = mergeCodexHooks()
    const hooks = readHookEvents()

    expect((hooks.UserPromptSubmit as unknown[])[0]).toEqual(foreignGroup)
    expect(hooks.ForeignEvent).toEqual([
      { hooks: [{ type: 'prompt', prompt: 'keep me' }] },
    ])
    // Legacy top-level entries are migrated under the wrapper, not left behind.
    expect(Object.keys(readHooks())).toEqual(['hooks'])
    expect(result.backupPath).not.toBeNull()
    expect(readFileSync(result.backupPath!, 'utf8')).toContain('foreign-hook')
  })

  it('replaces its own entries on reinstall without duplicates', () => {
    mergeCodexHooks()
    mergeCodexHooks()
    const hooks = readHookEvents()

    for (const event of CODEX_EVENTS) {
      expect(
        hookCommands(hooks[event]).filter((command) =>
          command.includes('meanwhile.mjs'),
        ),
      ).toHaveLength(1)
    }
  })

  it('does not report old async Codex hooks as functional', () => {
    mergeCodexHooks()
    const root = readHooks()
    const events = root.hooks as Record<string, unknown>
    const firstGroup = (events.UserPromptSubmit as Array<{
      hooks: Array<Record<string, unknown>>
    }>)[0]
    firstGroup!.hooks[0]!.async = true
    writeFileSync(codexHooksPath(), JSON.stringify(root), 'utf8')

    expect(inspectCodexHooks()).toMatchObject({
      present: false,
      events: ['Stop', 'PermissionRequest', 'SessionEnd'],
    })
  })

  it('uninstalls only meanwhile hook commands and creates a backup', () => {
    mkdirSync(codexHome, { recursive: true })
    const ours = {
      type: 'command',
      command: codexHookCommand(vendoredBundlePath()),
      timeout: 10,
    }
    const foreign = {
      type: 'command',
      command: '/usr/bin/foreign',
      timeout: 5,
    }
    writeFileSync(
      codexHooksPath(),
      JSON.stringify({
        Stop: [{ matcher: 'mixed', hooks: [ours, foreign] }],
        ForeignEvent: [{ hooks: [foreign] }],
      }),
      'utf8',
    )

    const result = removeCodexHooks()
    const hooks = readHooks()

    expect(hookCommands(hooks.Stop)).toEqual(['/usr/bin/foreign'])
    expect(hookCommands(hooks.ForeignEvent)).toEqual(['/usr/bin/foreign'])
    expect(result.changed).toBe(true)
    expect(result.backupPath).not.toBeNull()
    expect(readFileSync(result.backupPath!, 'utf8')).toContain(
      'meanwhile.mjs',
    )
  })

  it('uninstalls hooks installed from a different meanwhile home', () => {
    process.env.MEANWHILE_HOME = join(testHome, 'custom-meanwhile-home')
    const installedBundle = vendoredBundlePath()
    mergeCodexHooks(undefined, installedBundle)
    expect(hookCommands(readHookEvents().Stop)).toEqual([
      codexHookCommand(installedBundle),
    ])

    process.env.MEANWHILE_HOME = join(testHome, 'default-meanwhile-home')
    const result = removeCodexHooks()

    expect(result.changed).toBe(true)
    expect(hookCommands(readHookEvents().Stop)).toEqual([])
  })

  it('flags a legacy unwrapped layout via inspect', () => {
    mkdirSync(codexHome, { recursive: true })
    const legacy: Record<string, unknown> = {}
    for (const event of CODEX_EVENTS) {
      legacy[event] = [
        {
          hooks: [
            {
              type: 'command',
              command: codexHookCommand(vendoredBundlePath()),
              timeout: 10,
            },
          ],
        },
      ]
    }
    writeFileSync(codexHooksPath(), JSON.stringify(legacy), 'utf8')

    const report = inspectCodexHooks()
    expect(report.present).toBe(false)
    expect(report.error).toContain('legacy unwrapped hooks layout')

    // A re-install repairs it in place.
    mergeCodexHooks()
    expect(inspectCodexHooks().present).toBe(true)
    expect(
      hookCommands(readHookEvents().Stop).filter((command) =>
        command.includes('meanwhile.mjs'),
      ),
    ).toHaveLength(1)
  })
})

describe('config commands', () => {
  let testHome: string

  beforeEach(() => {
    testHome = createTestHome()
    delete process.env.MEANWHILE_DRYRUN
  })

  afterEach(() => {
    removeTestHome(testHome)
  })

  it('round-trips get, set, and list with scalar coercion', () => {
    expect(configSet('delaySeconds', '45.5')).toBe(45.5)
    expect(configSet('pullBack.enabled', 'false')).toBe(false)
    expect(configSet('url', 'https://example.test/learn')).toBe(
      'https://example.test/learn',
    )

    expect(configGet('delaySeconds')).toBe(45.5)
    expect(configGet('pullBack.enabled')).toBe(false)
    expect(Object.fromEntries(configEntries())).toMatchObject({
      delaySeconds: 45.5,
      'pullBack.enabled': false,
      url: 'https://example.test/learn',
    })

    const output = recordingIO()
    runConfig(['list'], output.io)
    expect(output.stdout).toHaveLength(VALID_CONFIG_KEYS.length)
    expect(output.stdout).toContain('pullBack.enabled=false')
  })

  it('rejects unknown paths with every valid key in the error', () => {
    expect(() => configGet('pullBack.unknown')).toThrow(
      new RegExp(VALID_CONFIG_KEYS.join('.*')),
    )
  })

  it('rejects negative delay values at set time', () => {
    expect(() => configSet('delaySeconds', '-5')).toThrow(
      /non-negative finite number/,
    )
  })

  it('rejects invalid enum values and lists the allowed values', () => {
    expect(() => configSet('browser', 'chr0me')).toThrow(
      /auto\|chrome\|default/,
    )
    expect(() => configSet('pullBack.multiSession', 'banana')).toThrow(
      /all-idle\|any-finishes/,
    )
  })

  it('falls back for a negative delay in a hand-edited config', () => {
    writeFileSync(configPath(), JSON.stringify({ delaySeconds: -5 }), 'utf8')

    expect(configGet('delaySeconds')).toBe(20)
  })
})

describe('top-level commands', () => {
  let testHome: string
  let previousPath: string | undefined

  beforeEach(() => {
    testHome = createTestHome()
    process.env.CODEX_HOME = join(testHome, 'codex')
    previousPath = process.env.PATH
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (previousPath === undefined) {
      delete process.env.PATH
    } else {
      process.env.PATH = previousPath
    }
    delete process.env.CODEX_HOME
    removeTestHome(testHome)
  })

  it('install --yes bypasses every prompt', async () => {
    const confirm = vi.fn(async () => {
      throw new Error('prompt should not be called')
    })
    const output = recordingIO(confirm)

    await expect(
      runInstall({
        yes: true,
        claudeOnly: false,
        codexOnly: false,
        detection: detection(),
        repoRoot: process.cwd(),
        io: output.io,
      }),
    ).resolves.toBe(true)
    expect(confirm).not.toHaveBeenCalled()
  })

  it('dry-run install does not create Codex hooks or config', async () => {
    const output = recordingIO()

    await runInstall({
      yes: true,
      claudeOnly: false,
      codexOnly: false,
      detection: detection(),
      repoRoot: process.cwd(),
      io: output.io,
    })

    expect(existsSync(codexHooksPath())).toBe(false)
    expect(existsSync(configPath())).toBe(false)
    expect(existsSync(vendoredBundlePath())).toBe(false)
    expect(
      output.stdout.some((line) =>
        line.includes('(dry-run) would write Codex hooks'),
      ),
    ).toBe(true)
    expect(output.stdout).toContain(
      `✓ (dry-run) would write default config to ${configPath()}`,
    )
  })

  it('dry-run uninstall does not modify Codex hooks or purged config', async () => {
    mkdirSync(process.env.CODEX_HOME!, { recursive: true })
    const originalHooks = JSON.stringify({
      Stop: [
        {
          hooks: [
            {
              type: 'command',
              command: codexHookCommand(vendoredBundlePath()),
              timeout: 10,
            },
          ],
        },
      ],
    })
    const originalConfig = '{"delaySeconds":45}\n'
    writeFileSync(codexHooksPath(), originalHooks, 'utf8')
    writeFileSync(configPath(), originalConfig, 'utf8')
    const output = recordingIO()

    await runUninstall({
      purge: true,
      yes: true,
      io: output.io,
    })

    expect(readFileSync(codexHooksPath(), 'utf8')).toBe(originalHooks)
    expect(readFileSync(configPath(), 'utf8')).toBe(originalConfig)
    expect(
      output.stdout.some((line) =>
        line.includes(`(dry-run) would write ${codexHooksPath()}`),
      ),
    ).toBe(true)
  })

  it('--codex-only never invokes Claude', async () => {
    const output = recordingIO()

    await runInstall({
      yes: true,
      claudeOnly: false,
      codexOnly: true,
      detection: detection(),
      repoRoot: process.cwd(),
      io: output.io,
    })

    const log = readFileSync(logPath(), 'utf8')
    expect(log).not.toContain('/fake/bin/claude')
    expect(log).not.toContain('plugin marketplace')
    expect(log).toContain('dryrun: would copy')
  })

  it('status completes on an empty machine', async () => {
    const emptyPath = join(testHome, 'empty-path')
    mkdirSync(emptyPath)
    process.env.PATH = emptyPath
    const output = recordingIO()

    await expect(runStatus({ io: output.io })).resolves.toBeUndefined()
    expect(output.stdout).toContain(
      '✗ Claude: CLI not found; plugin status unavailable',
    )
    expect(output.stdout.some((line) => line.startsWith('Codex: ✗'))).toBe(
      true,
    )
    expect(output.stdout).toContain(
      process.platform === 'darwin'
        ? '⚠ Automation probe: skipped (dry-run)'
        : 'Automation probe: not applicable (macOS only)',
    )
  })

  it('reports the Automation probe as not applicable off macOS', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    const output = recordingIO()

    await runStatus({
      io: output.io,
      runner: async () => ({
        stdout: '',
        stderr: '',
        exitCode: 0,
        skipped: true,
      }),
    })

    expect(output.stdout).toContain(
      'Automation probe: not applicable (macOS only)',
    )
  })
})
