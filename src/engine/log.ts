import { appendFileSync, mkdirSync } from 'node:fs'
import { logDir, logPath } from './paths.js'

export function appendLog(msg: string): void {
  try {
    mkdirSync(logDir(), { recursive: true })
    appendFileSync(logPath(), `${new Date().toISOString()} ${msg}\n`, 'utf8')
  } catch {
    // Logging must never interfere with a hook.
  }
}
