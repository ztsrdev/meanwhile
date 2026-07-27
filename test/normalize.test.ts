import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { normalize } from '../src/adapters/normalize.js'
import { createTestHome, removeTestHome } from './helpers.js'

describe('hook event normalization', () => {
  let testHome: string

  beforeEach(() => {
    testHome = createTestHome()
  })

  afterEach(() => {
    removeTestHome(testHome)
  })

  it('normalizes a realistic Claude prompt payload using the prompt field', () => {
    expect(
      normalize('claude', {
        session_id: 'claude-session',
        cwd: '/workspace',
        hook_event_name: 'UserPromptSubmit',
        prompt: 'Implement the feature',
      }),
    ).toEqual({
      harness: 'claude',
      kind: 'prompt-submit',
      sessionId: 'claude-session',
      cwd: '/workspace',
      stopHookActive: false,
    })
  })

  it('copies the Claude recursive Stop flag', () => {
    expect(
      normalize('claude', {
        session_id: 'claude-session',
        cwd: '/workspace',
        hook_event_name: 'Stop',
        stop_hook_active: true,
      }),
    ).toMatchObject({ kind: 'stop', stopHookActive: true })
  })

  it.each(['permission_prompt', 'idle_prompt'])(
    'maps Claude Notification %s to needs-input',
    (notificationType) => {
      expect(
        normalize('claude', {
          session_id: 'claude-session',
          cwd: '/workspace',
          hook_event_name: 'Notification',
          notification_type: notificationType,
          message: 'Input needed',
        }),
      ).toMatchObject({
        kind: 'needs-input',
        stopHookActive: false,
      })
    },
  )

  it('ignores non-blocking Claude notifications', () => {
    expect(
      normalize('claude', {
        session_id: 'claude-session',
        cwd: '/workspace',
        hook_event_name: 'Notification',
        notification_type: 'auth_success',
        message: 'Signed in',
      }),
    ).toMatchObject({ kind: 'ignored' })
  })

  it('normalizes a realistic Codex PermissionRequest payload', () => {
    expect(
      normalize('codex', {
        session_id: 'codex-session',
        turn_id: 'turn-123',
        cwd: '/workspace',
        hook_event_name: 'PermissionRequest',
      }),
    ).toEqual({
      harness: 'codex',
      kind: 'needs-input',
      sessionId: 'codex-session',
      cwd: '/workspace',
      stopHookActive: false,
    })
  })

  it('normalizes Codex Stop and SessionEnd payloads', () => {
    expect(
      normalize('codex', {
        session_id: 'codex-session',
        turn_id: 'turn-123',
        cwd: '/workspace',
        hook_event_name: 'Stop',
        stop_hook_active: true,
      }),
    ).toMatchObject({ kind: 'stop', stopHookActive: false })

    expect(
      normalize('codex', {
        session_id: 'codex-session',
        turn_id: 'turn-123',
        cwd: '/workspace',
        hook_event_name: 'SessionEnd',
      }),
    ).toMatchObject({ kind: 'session-end' })
  })

  it('maps unknown events to ignored', () => {
    expect(
      normalize('codex', {
        session_id: 'codex-session',
        cwd: '/workspace',
        hook_event_name: 'ToolCompleted',
      }),
    ).toMatchObject({ kind: 'ignored' })
  })

  it('returns null for missing session ids and malformed payloads', () => {
    expect(normalize('claude', { hook_event_name: 'Stop' })).toBeNull()
    expect(normalize('claude', '{not-json')).toBeNull()
    expect(normalize('codex', null)).toBeNull()
  })
})
