import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs'
import { join } from 'node:path'
import type { Harness } from '../types.js'
import { AWAY_MAX_AGE_MS } from './away.js'
import { atomicWriteFile } from './fs.js'
import { sessionDir, sessionsDir } from './paths.js'

interface PendingState {
  nonce: string
  since: number
}

export interface SessionMeta {
  harness: Harness
  cwd: string
  busySince: number | null
  updatedAt: number
}

const SESSION_ID_PATTERN = /^[A-Za-z0-9._-]+$/
export const BUSY_STALE_MS = AWAY_MAX_AGE_MS
const ONE_DAY_MS = 24 * 60 * 60 * 1000

function readPending(path: string): PendingState | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as PendingState).nonce === 'string' &&
      typeof (parsed as PendingState).since === 'number'
    ) {
      return parsed as PendingState
    }
  } catch {
    return null
  }
  return null
}

export function readMeta(id: string): SessionMeta | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(sessionDir(id), 'meta.json'), 'utf8'))
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      ((parsed as SessionMeta).harness === 'claude' || (parsed as SessionMeta).harness === 'codex') &&
      typeof (parsed as SessionMeta).cwd === 'string' &&
      ((parsed as SessionMeta).busySince === null ||
        typeof (parsed as SessionMeta).busySince === 'number') &&
      typeof (parsed as SessionMeta).updatedAt === 'number'
    ) {
      return parsed as SessionMeta
    }
  } catch {
    return null
  }
  return null
}

export function armPending(id: string, nonce: string, now: number): void {
  const directory = sessionDir(id)
  mkdirSync(directory, { recursive: true })
  rmSync(join(directory, 'fired'), { force: true })
  rmSync(join(directory, 'cancelled'), { force: true })
  atomicWriteFile(
    join(directory, 'pending'),
    JSON.stringify({ nonce, since: now }),
  )
}

export function tryTransition(
  id: string,
  from: 'pending',
  to: 'fired' | 'cancelled',
  nonce?: string,
): boolean {
  const directory = sessionDir(id)
  const source = join(directory, from)
  if (nonce !== undefined && readPending(source)?.nonce !== nonce) {
    return false
  }

  try {
    renameSync(source, join(directory, to))
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false
    }
    throw error
  }
}

export function clearOutcome(id: string): void {
  const directory = sessionDir(id)
  rmSync(join(directory, 'fired'), { force: true })
  rmSync(join(directory, 'cancelled'), { force: true })
}

export function setBusy(id: string, harness: Harness, cwd: string, now: number): void {
  atomicWriteFile(
    join(sessionDir(id), 'meta.json'),
    JSON.stringify({
      harness,
      cwd,
      busySince: now,
      updatedAt: now,
    } satisfies SessionMeta),
  )
}

export function clearBusy(id: string, now: number): void {
  const existing = readMeta(id)
  if (!existing) {
    return
  }
  atomicWriteFile(
    join(sessionDir(id), 'meta.json'),
    JSON.stringify({
      ...existing,
      busySince: null,
      updatedAt: now,
    } satisfies SessionMeta),
  )
}

export function otherSessionsBusy(
  excludeId: string,
  now: number,
  staleMs = BUSY_STALE_MS,
): boolean {
  sessionDir(excludeId)
  return listSessions().some((id) => {
    if (id === excludeId) {
      return false
    }
    const meta = readMeta(id)
    return (
      meta?.busySince !== null &&
      meta?.busySince !== undefined &&
      now - meta.busySince <= staleMs
    )
  })
}

export function removeSession(id: string): void {
  rmSync(sessionDir(id), { recursive: true, force: true })
}

export function gc(now: number, maxAgeMs = ONE_DAY_MS): void {
  try {
    for (const id of listSessions()) {
      try {
        const directory = sessionDir(id)
        const meta = readMeta(id)
        const updatedAt = meta?.updatedAt ?? statSync(directory).mtimeMs
        if (now - updatedAt > maxAgeMs) {
          rmSync(directory, { recursive: true, force: true })
        }
      } catch {
        // Another process may remove a session while GC scans it.
      }
    }
  } catch {
    // GC is opportunistic.
  }
}

export function listSessions(): string[] {
  try {
    return readdirSync(sessionsDir(), { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          SESSION_ID_PATTERN.test(entry.name) &&
          entry.name !== '.' &&
          entry.name !== '..',
      )
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
}
