import { spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Harness } from '../../src/types.js'
import { ensureFreshBundle } from '../helpers.js'

const root = process.cwd()
const bundlePath = join(root, 'dist', 'meanwhile.mjs')
const fixtureRoot = join(root, 'test', 'fixtures')
const awayUrl = 'https://example.test/away'
const claudeSession = '550e8400-e29b-41d4-a716-446655440000'
const codexSession = '019f2755-2cf7-72f3-947b-60ef7c45047a'

interface CommandResult {
  code: number | null
  stdout: string
  stderr: string
  elapsedMs: number
}

interface PendingState {
  nonce: string
  since: number
}

interface AwayState {
  owner: string
  prevApp: string | null
  since: number
}

interface DryRunAction {
  action: string
  command?: string
  args?: unknown[]
  bundleId?: string
  body?: string
}

function loadFixture(harness: Harness, name: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(fixtureRoot, harness, name), 'utf8'),
  ) as Record<string, unknown>
}

function sessionDirectory(home: string, sessionId: string): string {
  return join(home, 'state', 'sessions', sessionId)
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function readLog(home: string): string {
  const path = join(home, 'logs', 'meanwhile.log')
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}

function dryRunActions(log: string): DryRunAction[] {
  const marker = ' dryrun: '
  return log.split('\n').flatMap((line) => {
    const index = line.indexOf(marker)
    if (index === -1) {
      return []
    }
    const jsonStart = line.indexOf('{', index + marker.length)
    if (jsonStart === -1) {
      return []
    }
    try {
      return [JSON.parse(line.slice(jsonStart)) as DryRunAction]
    } catch {
      return []
    }
  })
}

function openActions(log: string): DryRunAction[] {
  return dryRunActions(log).filter((record) => {
    if (record.action !== 'execFile' || !Array.isArray(record.args)) {
      return false
    }
    const includesAwayUrl = record.args.some(
      (arg) => typeof arg === 'string' && arg.includes(awayUrl),
    )
    if (!includesAwayUrl) {
      return false
    }
    if (record.command === 'open' || record.command === 'xdg-open') {
      return true
    }
    return (
      record.command === 'cmd' &&
      record.args[0] === '/c' &&
      record.args[1] === 'start' &&
      record.args[2] === ''
    )
  })
}

function activationActions(log: string, bundleId: string): DryRunAction[] {
  return dryRunActions(log).filter(
    (record) =>
      (record.action === 'activateApp' && record.bundleId === bundleId) ||
      (record.action === 'execFile' &&
        record.command === 'osascript' &&
        record.args?.some(
          (arg) =>
            typeof arg === 'string' &&
            arg.includes(`tell application id "${bundleId}" to activate`),
        )),
  )
}

function notificationActions(log: string, body?: string): DryRunAction[] {
  return dryRunActions(log).filter(
    (record) =>
      ((record.action === 'notify' &&
        (body === undefined || record.body === body)) ||
        (record.action === 'execFile' &&
          (record.command === 'notify-send' ||
            (record.command === 'osascript' &&
              record.args?.some(
                (arg) =>
                  typeof arg === 'string' &&
                  arg.includes('display notification '),
              ))) &&
          (body === undefined ||
            record.args?.includes(body) ||
            record.args?.some(
              (arg) => typeof arg === 'string' && arg.includes(body),
            )))),
  )
}

function soundActions(log: string): DryRunAction[] {
  return dryRunActions(log).filter(
    (record) =>
      record.action === 'playSound' ||
      (record.action === 'execFile' && record.command === 'afplay'),
  )
}

function childEnvironment(
  home: string,
  extra: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (key.startsWith('CONDUCTOR_')) {
      delete env[key]
    }
  }
  return {
    ...env,
    MEANWHILE_HOME: home,
    MEANWHILE_DRYRUN: '1',
    ...extra,
  }
}

function runBundle(
  home: string,
  args: string[],
  input = '',
  extraEnv: NodeJS.ProcessEnv = {},
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now()
    const child = spawn(process.execPath, [bundlePath, ...args], {
      cwd: root,
      env: childEnvironment(home, extraEnv),
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, 4_000)

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => {
      clearTimeout(timeout)
      if (timedOut) {
        reject(new Error(`meanwhile ${args.join(' ')} exceeded 4 seconds`))
        return
      }
      resolve({
        code,
        stdout,
        stderr,
        elapsedMs: performance.now() - startedAt,
      })
    })
    child.stdin.end(input)
  })
}

async function runHook(
  home: string,
  harness: Harness,
  payload: Record<string, unknown> | string,
  extraEnv: NodeJS.ProcessEnv = {},
): Promise<CommandResult> {
  const input = typeof payload === 'string' ? payload : JSON.stringify(payload)
  return runBundle(home, ['hook', '--harness', harness], input, extraEnv)
}

async function runFixture(
  home: string,
  harness: Harness,
  name: string,
  extraEnv: NodeJS.ProcessEnv = {},
): Promise<CommandResult> {
  return runHook(home, harness, loadFixture(harness, name), extraEnv)
}

async function firePending(home: string, sessionId: string): Promise<CommandResult> {
  const pending = readJson<PendingState>(
    join(sessionDirectory(home, sessionId), 'pending'),
  )
  return runBundle(
    home,
    [
      'timer',
      '--session',
      sessionId,
      '--nonce',
      pending.nonce,
      '--delay',
      '0',
    ],
  )
}

function expectSilentSuccess(result: CommandResult): void {
  expect(result.code, result.stderr).toBe(0)
  expect(result.stdout).toBe('')
}

function expectSessionSettled(home: string, sessionId: string): void {
  const directory = sessionDirectory(home, sessionId)
  expect(
    readJson<{ busySince: number | null }>(
      join(directory, 'meta.json'),
    ).busySince,
  ).toBeNull()
  expect(existsSync(join(directory, 'pending'))).toBe(false)
  expect(existsSync(join(directory, 'fired'))).toBe(false)
  expect(existsSync(join(directory, 'cancelled'))).toBe(false)
}

function expectPulledBack(
  log: string,
  home: string,
  target: string,
  settledSessionIds: readonly string[],
): void {
  if (process.platform === 'darwin') {
    expect(activationActions(log, target)).toHaveLength(1)
    return
  }

  expect(existsSync(join(home, 'state', 'away.json'))).toBe(false)
  for (const sessionId of settledSessionIds) {
    expectSessionSettled(home, sessionId)
  }
}

function expectNotificationAction(log: string, body: string): void {
  if (process.platform === 'win32') {
    expect(notificationActions(log, body)).toHaveLength(0)
    return
  }
  expect(notificationActions(log, body)).toHaveLength(1)
}

async function waitFor(
  predicate: () => boolean,
  description: string,
  timeoutMs = 3_000,
): Promise<void> {
  const deadline = performance.now() + timeoutMs
  while (performance.now() < deadline) {
    if (predicate()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`Timed out waiting for ${description}`)
}

function writePreviousApp(home: string, bundleId = 'com.example.editor'): void {
  const path = join(home, 'state', 'away.json')
  const away = readJson<AwayState>(path)
  writeFileSync(path, JSON.stringify({ ...away, prevApp: bundleId }), 'utf8')
}

let testHome: string | undefined

function createHome(
  delaySeconds: number,
  multiSession: 'all-idle' | 'any-finishes' = 'all-idle',
  sound = false,
): string {
  testHome = mkdtempSync(join(tmpdir(), 'meanwhile-integration-'))
  writeFileSync(
    join(testHome, 'config.json'),
    JSON.stringify({
      url: awayUrl,
      delaySeconds,
      browser: 'auto',
      pullBack: {
        enabled: true,
        multiSession,
        notification: true,
        sound,
      },
      conductor: {
        suppressAlerts: true,
      },
    }),
    'utf8',
  )
  return testHome
}

beforeAll(() => {
  ensureFreshBundle()
}, 20_000)

afterEach(() => {
  if (testHome) {
    rmSync(testHome, { recursive: true, force: true })
    testHome = undefined
  }
})

describe('built bundle lifecycle', () => {
  it('cancels a quick turn and makes the timer lose the pending-state race', async () => {
    const home = createHome(1)
    expectSilentSuccess(
      await runFixture(home, 'claude', 'user-prompt-submit.json'),
    )
    const pending = readJson<PendingState>(
      join(sessionDirectory(home, claudeSession), 'pending'),
    )

    expectSilentSuccess(await runFixture(home, 'claude', 'stop.json'))

    const directory = sessionDirectory(home, claudeSession)
    expect(existsSync(join(directory, 'pending'))).toBe(false)
    expect(readJson<PendingState>(join(directory, 'cancelled'))).toEqual(pending)
    expect(readJson<{ busySince: number | null }>(join(directory, 'meta.json')).busySince)
      .toBeNull()

    const losingTimer = await runBundle(home, [
      'timer',
      '--session',
      claudeSession,
      '--nonce',
      pending.nonce,
      '--delay',
      '0',
    ])
    expectSilentSuccess(losingTimer)
    expect(existsSync(join(home, 'state', 'away.json'))).toBe(false)
    expect(openActions(readLog(home))).toHaveLength(0)
  })

  it('opens for a long turn, then pulls back and clears away/busy state', async () => {
    const home = createHome(0)
    expectSilentSuccess(
      await runFixture(home, 'claude', 'user-prompt-submit.json'),
    )
    const directory = sessionDirectory(home, claudeSession)

    await waitFor(
      () =>
        existsSync(join(directory, 'fired')) &&
        existsSync(join(home, 'state', 'away.json')) &&
        openActions(readLog(home)).length === 1,
      'the detached timer to fire and open the away URL',
    )
    expect(readJson<AwayState>(join(home, 'state', 'away.json')).owner)
      .toBe(claudeSession)
    writePreviousApp(home)

    expectSilentSuccess(await runFixture(home, 'claude', 'stop.json'))

    const log = readLog(home)
    expectPulledBack(log, home, 'com.example.editor', [claudeSession])
    expectNotificationAction(log, 'Your coding agent is ready.')
    expect(existsSync(join(home, 'state', 'away.json'))).toBe(false)
    expect(existsSync(join(directory, 'fired'))).toBe(false)
    expect(readJson<{ busySince: number | null }>(join(directory, 'meta.json')).busySince)
      .toBeNull()
  })

  it('waits for the last busy session under the all-idle ping-pong policy', async () => {
    const home = createHome(2)
    expectSilentSuccess(
      await runFixture(home, 'claude', 'user-prompt-submit.json'),
    )
    expectSilentSuccess(await firePending(home, claudeSession))
    writePreviousApp(home)
    expectSilentSuccess(
      await runFixture(home, 'codex', 'user-prompt-submit.json'),
    )

    expectSilentSuccess(await runFixture(home, 'claude', 'stop.json'))
    let log = readLog(home)
    expect(activationActions(log, 'com.example.editor')).toHaveLength(0)
    expect(notificationActions(log, 'Your coding agent is ready.'))
      .toHaveLength(0)
    expect(readJson<AwayState>(join(home, 'state', 'away.json')).owner)
      .toBe(claudeSession)

    expectSilentSuccess(await runFixture(home, 'codex', 'stop.json'))
    log = readLog(home)
    expectPulledBack(log, home, 'com.example.editor', [
      claudeSession,
      codexSession,
    ])
    expectNotificationAction(log, 'Your coding agent is ready.')
    expect(existsSync(join(home, 'state', 'away.json'))).toBe(false)
    expect(
      readJson<{ busySince: number | null }>(
        join(sessionDirectory(home, claudeSession), 'meta.json'),
      ).busySince,
    ).toBeNull()
    expect(
      readJson<{ busySince: number | null }>(
        join(sessionDirectory(home, codexSession), 'meta.json'),
      ).busySince,
    ).toBeNull()
  })

  it('pulls back on the first completion under any-finishes', async () => {
    const home = createHome(2, 'any-finishes')
    expectSilentSuccess(
      await runFixture(home, 'claude', 'user-prompt-submit.json'),
    )
    expectSilentSuccess(await firePending(home, claudeSession))
    writePreviousApp(home)
    expectSilentSuccess(
      await runFixture(home, 'codex', 'user-prompt-submit.json'),
    )

    expectSilentSuccess(await runFixture(home, 'claude', 'stop.json'))

    const log = readLog(home)
    expectPulledBack(log, home, 'com.example.editor', [claudeSession])
    expectNotificationAction(log, 'Your coding agent is ready.')
    expect(existsSync(join(home, 'state', 'away.json'))).toBe(false)
    expect(
      readJson<{ busySince: number | null }>(
        join(sessionDirectory(home, codexSession), 'meta.json'),
      ).busySince,
    ).not.toBeNull()
  })

  it('lets needs-input pull back immediately while another session is busy', async () => {
    const home = createHome(2)
    expectSilentSuccess(
      await runFixture(home, 'claude', 'user-prompt-submit.json'),
    )
    expectSilentSuccess(await firePending(home, claudeSession))
    writePreviousApp(home)
    expectSilentSuccess(
      await runFixture(home, 'codex', 'user-prompt-submit.json'),
    )

    expectSilentSuccess(
      await runFixture(home, 'claude', 'notification-permission.json'),
    )

    const log = readLog(home)
    expectPulledBack(log, home, 'com.example.editor', [claudeSession])
    expectNotificationAction(log, 'Your coding agent needs input.')
    expect(existsSync(join(home, 'state', 'away.json'))).toBe(false)
    expect(
      readJson<{ busySince: number | null }>(
        join(sessionDirectory(home, codexSession), 'meta.json'),
      ).busySince,
    ).not.toBeNull()
  })

  it('refreshes the original away owner when a second session timer fires', async () => {
    const home = createHome(2)
    expectSilentSuccess(
      await runFixture(home, 'claude', 'user-prompt-submit.json'),
    )
    expectSilentSuccess(await firePending(home, claudeSession))
    const firstAway = readJson<AwayState>(join(home, 'state', 'away.json'))
    await new Promise((resolve) => setTimeout(resolve, 20))

    expectSilentSuccess(
      await runFixture(home, 'codex', 'user-prompt-submit.json'),
    )
    expectSilentSuccess(await firePending(home, codexSession))

    const refreshedAway = readJson<AwayState>(join(home, 'state', 'away.json'))
    expect(refreshedAway.owner).toBe(claudeSession)
    expect(refreshedAway.since).toBeGreaterThan(firstAway.since)
    expect(
      existsSync(join(sessionDirectory(home, codexSession), 'fired')),
    ).toBe(true)
    expect(openActions(readLog(home))).toHaveLength(1)
  })

  it('ignores malformed, unknown, and non-input notification payloads', async () => {
    const home = createHome(1)
    const malformed = await runHook(home, 'claude', '{"session_id":')
    expectSilentSuccess(malformed)
    expect(readLog(home)).toContain('hook: ignored malformed JSON:')

    const unknown = loadFixture('claude', 'user-prompt-submit.json')
    unknown.hook_event_name = 'FutureHookEvent'
    expectSilentSuccess(await runHook(home, 'claude', unknown))
    expectSilentSuccess(
      await runFixture(home, 'claude', 'notification-other.json'),
    )

    expect(existsSync(join(home, 'state', 'sessions'))).toBe(false)
    expect(openActions(readLog(home))).toHaveLength(0)
  })

  it('logs a detached timer failure for a negative delay', async () => {
    const home = createHome(1)

    const parseFailure = await runBundle(home, [
      'timer',
      '--session',
      claudeSession,
      '--nonce',
      'negative-delay',
      '--delay',
      '-5',
    ])
    expect(parseFailure.code).toBe(1)
    expect(readLog(home)).toContain(
      'timer: TypeError [ERR_PARSE_ARGS_INVALID_OPTION_VALUE]',
    )

    const validationFailure = await runBundle(home, [
      'timer',
      '--session',
      claudeSession,
      '--nonce',
      'negative-delay',
      '--delay=-5',
    ])

    expect(validationFailure.code).toBe(1)
    expect(validationFailure.stderr).toContain(
      'timer delay must be a non-negative number',
    )
    expect(readLog(home)).toContain(
      'timer: Error: timer delay must be a non-negative number',
    )
  })

  it('does not pull back for an active recursive Stop hook', async () => {
    const home = createHome(2, 'any-finishes')
    expectSilentSuccess(
      await runFixture(home, 'claude', 'user-prompt-submit.json'),
    )
    expectSilentSuccess(await firePending(home, claudeSession))
    writePreviousApp(home)

    expectSilentSuccess(
      await runFixture(home, 'claude', 'stop-hook-active.json'),
    )

    const log = readLog(home)
    expect(activationActions(log, 'com.example.editor')).toHaveLength(0)
    expect(notificationActions(log)).toHaveLength(0)
    expect(readJson<AwayState>(join(home, 'state', 'away.json')).owner)
      .toBe(claudeSession)
  })

  it('returns from the hook entrypoint in under two seconds', async () => {
    const home = createHome(1)
    const result = await runFixture(home, 'codex', 'user-prompt-submit.json')
    expectSilentSuccess(result)
    expect(result.elapsedMs).toBeLessThan(2_000)

    const directory = sessionDirectory(home, codexSession)
    expect(existsSync(join(directory, 'meta.json'))).toBe(true)
    expect(
      existsSync(join(directory, 'pending')) ||
        existsSync(join(directory, 'fired')),
    ).toBe(true)
    expectSilentSuccess(await runFixture(home, 'codex', 'stop.json'))
  })

  it('targets Conductor and suppresses notification and sound actions', async () => {
    const home = createHome(0, 'any-finishes', true)
    const conductorEnv = {
      CONDUCTOR_SESSION_ID: claudeSession,
      CONDUCTOR_IS_LOCAL: '1',
    }
    expectSilentSuccess(
      await runFixture(
        home,
        'claude',
        'user-prompt-submit.json',
        conductorEnv,
      ),
    )
    await waitFor(
      () => existsSync(join(home, 'state', 'away.json')),
      'Conductor session away state',
    )

    expectSilentSuccess(
      await runFixture(home, 'claude', 'stop.json', conductorEnv),
    )

    const log = readLog(home)
    expectPulledBack(log, home, 'com.conductor.app', [claudeSession])
    expect(notificationActions(log)).toHaveLength(0)
    expect(soundActions(log)).toHaveLength(0)
    expect(existsSync(join(home, 'state', 'away.json'))).toBe(false)
  })

  it('removes session state on SessionEnd', async () => {
    const home = createHome(1)
    expectSilentSuccess(
      await runFixture(home, 'codex', 'user-prompt-submit.json'),
    )
    expect(existsSync(sessionDirectory(home, codexSession))).toBe(true)

    expectSilentSuccess(
      await runFixture(home, 'codex', 'session-end.json'),
    )
    expect(existsSync(sessionDirectory(home, codexSession))).toBe(false)
  })

  it('handles SessionEnd without loading a corrupt config', async () => {
    const home = createHome(1)
    const directory = sessionDirectory(home, codexSession)
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'meta.json'), '{}', 'utf8')
    writeFileSync(join(home, 'config.json'), '{not-json', 'utf8')

    expectSilentSuccess(
      await runFixture(home, 'codex', 'session-end.json'),
    )

    expect(existsSync(directory)).toBe(false)
    expect(readLog(home)).not.toContain('ignored corrupt configuration')
  })
})
