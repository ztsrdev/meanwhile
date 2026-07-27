import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'
import type { AwayState } from '../types.js'
import { atomicWriteFile } from './fs.js'
import { awayPath } from './paths.js'

export const AWAY_MAX_AGE_MS = 30 * 60 * 1000

export function writeAway(state: AwayState): void {
  atomicWriteFile(awayPath(), JSON.stringify(state))
}

function exclusiveWrite(path: string, state: AwayState): boolean {
  try {
    writeFileSync(path, JSON.stringify(state), {
      encoding: 'utf8',
      flag: 'wx',
    })
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return false
    }
    throw error
  }
}

export function createAway(state: AwayState): boolean {
  const path = awayPath()
  const replacementLock = `${path}.replace-lock`
  mkdirSync(dirname(path), { recursive: true })
  if (exclusiveWrite(path, state)) {
    return true
  }

  try {
    writeFileSync(replacementLock, '', {
      encoding: 'utf8',
      flag: 'wx',
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return false
    }
    throw error
  }

  try {
    if (readAway(state.since) !== null) {
      return false
    }
    if (existsSync(path)) {
      try {
        unlinkSync(path)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error
        }
      }
    }
    return exclusiveWrite(path, state)
  } finally {
    try {
      unlinkSync(replacementLock)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }
  }
}

export function readAway(
  now: number,
  maxAgeMs = AWAY_MAX_AGE_MS,
): AwayState | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(awayPath(), 'utf8'))
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as AwayState).owner !== 'string' ||
      ((parsed as AwayState).prevApp !== null &&
        typeof (parsed as AwayState).prevApp !== 'string') ||
      typeof (parsed as AwayState).since !== 'number' ||
      !Number.isFinite((parsed as AwayState).since) ||
      now - (parsed as AwayState).since > maxAgeMs
    ) {
      return null
    }
    return parsed as AwayState
  } catch {
    return null
  }
}

export function touchAway(now: number): void {
  const current = readAway(now)
  if (current) {
    writeAway({ ...current, since: now })
  }
}

export function clearAway(owner: string): void {
  const current = readAway(Date.now(), Number.POSITIVE_INFINITY)
  if (current?.owner !== owner) {
    return
  }
  try {
    unlinkSync(awayPath())
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }
}
