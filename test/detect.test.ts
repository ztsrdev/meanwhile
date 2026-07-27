import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { detectEnvironment } from '../src/detect.js'
import type { ProcessRunner } from '../src/commands/process.js'
import { createTestHome, removeTestHome } from './helpers.js'

describe('integration detection', () => {
  let testHome: string
  let previousPath: string | undefined

  beforeEach(() => {
    testHome = createTestHome()
    previousPath = process.env.PATH
  })

  afterEach(() => {
    if (previousPath === undefined) {
      delete process.env.PATH
    } else {
      process.env.PATH = previousPath
    }
    removeTestHome(testHome)
  })

  it('reports CLI paths, version strings, and Conductor', async () => {
    const conductorPath = join(testHome, 'Conductor.app')
    mkdirSync(conductorPath)
    const runner = vi.fn<ProcessRunner>(async (command) => ({
      stdout: command.endsWith('claude') ? '2.1.220\n' : 'codex-cli 0.144.1\n',
      stderr: '',
      exitCode: 0,
      skipped: false,
    }))

    const report = await detectEnvironment({
      runner,
      find: (name) => join(testHome, 'bin', name),
      conductorPath,
    })

    expect(report.claude).toMatchObject({
      found: true,
      version: '2.1.220',
    })
    expect(report.codex).toMatchObject({
      found: true,
      version: 'codex-cli 0.144.1',
    })
    expect(report.conductor.found).toBe(true)
    expect(runner).toHaveBeenCalledTimes(2)
  })

  it('does not invoke missing CLIs', async () => {
    const runner = vi.fn<ProcessRunner>()
    const report = await detectEnvironment({
      runner,
      find: () => null,
      conductorPath: join(testHome, 'missing.app'),
    })

    expect(report.claude.found).toBe(false)
    expect(report.codex.found).toBe(false)
    expect(report.conductor.found).toBe(false)
    expect(runner).not.toHaveBeenCalled()
  })

  it('logs version probes and skips execution in dry-run mode', async () => {
    const binaryDirectory = join(testHome, 'bin')
    mkdirSync(binaryDirectory)
    for (const name of ['claude', 'codex']) {
      const executable = join(binaryDirectory, name)
      writeFileSync(executable, '#!/bin/sh\nexit 99\n', 'utf8')
      chmodSync(executable, 0o755)
    }
    process.env.PATH = binaryDirectory

    const report = await detectEnvironment({
      conductorPath: join(testHome, 'missing.app'),
    })

    expect(report.claude).toMatchObject({
      found: true,
      version: null,
      versionSkipped: true,
    })
    expect(report.codex).toMatchObject({
      found: true,
      version: null,
      versionSkipped: true,
    })
  })
})
