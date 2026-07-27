import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ensureFreshBundle } from './helpers.js'

const root = process.cwd()
const bundlePath = join(root, 'dist', 'meanwhile.mjs')

describe('built hook entrypoint', () => {
  beforeAll(() => {
    ensureFreshBundle()
  })

  afterAll(() => {
    expect(existsSync(bundlePath)).toBe(true)
  })

  it('exits silently and quickly after creating prompt state', async () => {
    const home = join(
      tmpdir(),
      `meanwhile-hook-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    )
    mkdirSync(home, { recursive: true })
    writeFileSync(
      join(home, 'config.json'),
      JSON.stringify({
        delaySeconds: 0,
      }),
      'utf8',
    )
    const payload = {
      session_id: 'hook-session',
      turn_id: 'turn-123',
      cwd: '/workspace',
      hook_event_name: 'UserPromptSubmit',
      prompt: 'Please implement this',
    }

    const startedAt = performance.now()
    const result = spawnSync(
      process.execPath,
      [bundlePath, 'hook', '--harness', 'codex'],
      {
        cwd: root,
        input: JSON.stringify(payload),
        encoding: 'utf8',
        timeout: 2_000,
        env: {
          ...process.env,
          MEANWHILE_HOME: home,
          MEANWHILE_DRYRUN: '1',
        },
      },
    )
    const elapsedMs = performance.now() - startedAt

    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
    expect(elapsedMs).toBeLessThan(2_000)

    const sessionDirectory = join(home, 'state', 'sessions', 'hook-session')
    expect(existsSync(sessionDirectory)).toBe(true)
    expect(
      JSON.parse(readFileSync(join(sessionDirectory, 'meta.json'), 'utf8')),
    ).toMatchObject({
      harness: 'codex',
      cwd: '/workspace',
    })
    expect(
      existsSync(join(sessionDirectory, 'pending')) ||
        existsSync(join(sessionDirectory, 'fired')),
    ).toBe(true)

    await new Promise((resolve) => setTimeout(resolve, 150))
    rmSync(home, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 20,
    })
  })

  it('exits silently without creating session state when disabled', () => {
    const home = join(
      tmpdir(),
      `meanwhile-disabled-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    )
    const payload = {
      session_id: 'disabled-hook-session',
      turn_id: 'turn-disabled',
      cwd: '/workspace',
      hook_event_name: 'UserPromptSubmit',
      prompt: 'This hook is disabled',
    }

    const result = spawnSync(
      process.execPath,
      [bundlePath, 'hook', '--harness', 'codex'],
      {
        cwd: root,
        input: JSON.stringify(payload),
        encoding: 'utf8',
        timeout: 2_000,
        env: {
          ...process.env,
          MEANWHILE_HOME: home,
          MEANWHILE_DISABLE: '1',
        },
      },
    )

    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('')
    expect(
      existsSync(join(home, 'state', 'sessions', 'disabled-hook-session')),
    ).toBe(false)

    rmSync(home, { recursive: true, force: true })
  })
})
