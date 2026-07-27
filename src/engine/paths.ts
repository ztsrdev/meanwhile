import os from 'node:os'
import { join } from 'node:path'

const SESSION_ID_PATTERN = /^[A-Za-z0-9._-]+$/

export function home(): string {
  return process.env.AWAITLINGO_HOME ?? join(os.homedir(), '.awaitlingo')
}

export function configPath(): string {
  return join(home(), 'config.json')
}

export function stateDir(): string {
  return join(home(), 'state')
}

export function sessionsDir(): string {
  return join(stateDir(), 'sessions')
}

export function sessionDir(id: string): string {
  if (!SESSION_ID_PATTERN.test(id) || id === '.' || id === '..') {
    throw new Error(`Invalid session id: ${id}`)
  }
  return join(sessionsDir(), id)
}

export function awayPath(): string {
  return join(stateDir(), 'away.json')
}

export function logDir(): string {
  return join(home(), 'logs')
}

export function logPath(): string {
  return join(logDir(), 'awaitlingo.log')
}
