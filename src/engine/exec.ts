import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { isDryRun } from './env.js'
import { appendLog } from './log.js'

const execFileAsync = promisify(execFile)

export interface ExecResult {
  stdout: string
  stderr: string
  exitCode: number
  skipped: boolean
}

export interface DryRunDescription {
  action: string
  summary: string
  details?: Record<string, unknown>
}

export interface ExecOptions {
  timeoutMs: number
  dryRunDescription?: DryRunDescription
}

function displayArgument(argument: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(argument)
    ? argument
    : JSON.stringify(argument)
}

export function displayCommand(
  command: string,
  args: readonly string[],
): string {
  return [command, ...args].map(displayArgument).join(' ')
}

function oneLine(value: string): string {
  return value.replaceAll('\r', '\\r').replaceAll('\n', '\\n')
}

function logDryRun(
  command: string,
  args: readonly string[],
  description?: DryRunDescription,
): void {
  if (!description) {
    appendLog(`dryrun: exec ${displayCommand(command, args)}`)
    return
  }
  appendLog(
    `dryrun: ${oneLine(description.summary)} ${JSON.stringify({
      action: description.action,
      command,
      args,
      ...description.details,
    })}`,
  )
}

export async function execute(
  command: string,
  args: readonly string[],
  options: ExecOptions,
): Promise<ExecResult> {
  const dryRun = isDryRun()
  if (dryRun) {
    logDryRun(command, args, options.dryRunDescription)
  }

  if (process.env.MEANWHILE_TEST_FAIL_EXEC === '1') {
    return {
      stdout: '',
      stderr: `forced execFile failure for ${command}`,
      exitCode: 1,
      skipped: false,
    }
  }
  if (dryRun) {
    return { stdout: '', stderr: '', exitCode: 0, skipped: true }
  }

  try {
    const { stdout, stderr } = await execFileAsync(command, [...args], {
      encoding: 'utf8',
      timeout: options.timeoutMs,
      maxBuffer: 1024 * 1024,
    })
    return {
      stdout,
      stderr,
      exitCode: 0,
      skipped: false,
    }
  } catch (error) {
    const failure = error as Error & {
      code?: number | string
      stdout?: string
      stderr?: string
    }
    return {
      stdout: typeof failure.stdout === 'string' ? failure.stdout : '',
      stderr:
        typeof failure.stderr === 'string'
          ? failure.stderr
          : failure.message,
      exitCode: typeof failure.code === 'number' ? failure.code : 1,
      skipped: false,
    }
  }
}
