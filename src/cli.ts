import { parseArgs } from 'node:util'
import { appendLog } from './engine/log.js'
import { loadConfig } from './engine/config.js'
import {
  onNeedsInput,
  onPromptSubmit,
  onSessionEnd,
  onStop,
  onTimerFire,
} from './engine/actions.js'
import { normalize } from './adapters/normalize.js'
import { getPlatform } from './platform/index.js'
import type { Harness } from './types.js'
import { runInstall } from './commands/install.js'
import { runUninstall } from './commands/uninstall.js'
import { runStatus } from './commands/status.js'
import { runConfig } from './commands/config.js'
import { VERSION } from './commands/version.js'

async function readStdin(): Promise<string> {
  let input = ''
  process.stdin.setEncoding('utf8')
  for await (const chunk of process.stdin) {
    input += chunk
  }
  return input
}

async function runHook(harnessValue: string | undefined): Promise<void> {
  try {
    if (harnessValue !== 'claude' && harnessValue !== 'codex') {
      throw new Error('hook requires --harness claude|codex')
    }
    const harness: Harness = harnessValue

    let payload: unknown
    try {
      payload = JSON.parse(await readStdin())
    } catch (error) {
      appendLog(`hook: ignored malformed JSON: ${String(error)}`)
      return
    }

    const event = normalize(harness, payload)
    if (!event || event.kind === 'ignored') {
      return
    }

    switch (event.kind) {
      case 'prompt-submit':
        onPromptSubmit(event, loadConfig())
        break
      case 'stop':
        await onStop(event, loadConfig(), getPlatform())
        break
      case 'needs-input':
        await onNeedsInput(event, loadConfig(), getPlatform())
        break
      case 'session-end':
        onSessionEnd(event)
        break
    }
  } catch (error) {
    appendLog(`hook: ${String(error)}`)
  }
}

async function runTimer(
  sessionId: string | undefined,
  nonce: string | undefined,
  delayValue: string | undefined,
): Promise<void> {
  if (!sessionId || !nonce || delayValue === undefined) {
    throw new Error('timer requires --session, --nonce, and --delay')
  }
  const delaySeconds = Number(delayValue)
  if (!Number.isFinite(delaySeconds) || delaySeconds < 0) {
    throw new Error('timer delay must be a non-negative number')
  }

  await new Promise<void>((resolve) => {
    setTimeout(resolve, delaySeconds * 1000)
  })
  await onTimerFire(sessionId, nonce, loadConfig(), getPlatform())
}

async function main(): Promise<void> {
  const rawCommand = process.argv[2]
  if (
    rawCommand === 'hook' &&
    (process.env.MEANWHILE_DISABLE === '1' ||
      process.env.MEANWHILE_DISABLE === 'true')
  ) {
    return
  }

  try {
    const { positionals, values } = parseArgs({
      args: process.argv.slice(2),
      allowPositionals: true,
      strict: true,
      options: {
        harness: { type: 'string' },
        session: { type: 'string' },
        nonce: { type: 'string' },
        delay: { type: 'string' },
        yes: { type: 'boolean', default: false },
        'claude-only': { type: 'boolean', default: false },
        'codex-only': { type: 'boolean', default: false },
        purge: { type: 'boolean', default: false },
      },
    })
    const command = positionals[0]

    if (command === 'hook') {
      await runHook(values.harness)
      return
    }
    if (command === 'timer') {
      await runTimer(values.session, values.nonce, values.delay)
      return
    }
    if (command === 'version') {
      console.log(VERSION)
      return
    }
    if (command === 'install') {
      const succeeded = await runInstall({
        yes: values.yes,
        claudeOnly: values['claude-only'],
        codexOnly: values['codex-only'],
      })
      if (!succeeded) {
        process.exitCode = 1
      }
      return
    }
    if (command === 'uninstall') {
      await runUninstall({
        purge: values.purge,
        yes: values.yes,
      })
      return
    }
    if (command === 'status') {
      await runStatus()
      process.exitCode = 0
      return
    }
    if (command === 'config') {
      runConfig(positionals.slice(1))
      return
    }

    console.error('Usage: meanwhile <hook|timer|version|install|uninstall|status|config>')
    process.exitCode = 1
  } catch (error) {
    appendLog(`${rawCommand ?? 'cli'}: ${String(error)}`)
    if (rawCommand === 'hook') {
      process.exitCode = 0
      return
    }
    console.error(`meanwhile: ${String(error)}`)
    process.exitCode = 1
  }
}

await main()
