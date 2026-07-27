import type { Harness, NormalizedEvent } from '../types.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function normalize(harness: Harness, payload: unknown): NormalizedEvent | null {
  try {
    if (!isRecord(payload) || typeof payload.session_id !== 'string' || !payload.session_id) {
      return null
    }

    const hookEventName =
      typeof payload.hook_event_name === 'string' ? payload.hook_event_name : ''
    const notificationType =
      typeof payload.notification_type === 'string' ? payload.notification_type : undefined

    let kind: NormalizedEvent['kind']
    switch (hookEventName) {
      case 'UserPromptSubmit':
        kind = 'prompt-submit'
        break
      case 'Stop':
        kind = 'stop'
        break
      case 'Notification':
        kind =
          notificationType === 'permission_prompt' || notificationType === 'idle_prompt'
            ? 'needs-input'
            : 'ignored'
        break
      case 'PermissionRequest':
        kind = 'needs-input'
        break
      case 'SessionEnd':
        kind = 'session-end'
        break
      default:
        kind = 'ignored'
    }

    return {
      harness,
      kind,
      sessionId: payload.session_id,
      cwd: typeof payload.cwd === 'string' ? payload.cwd : '',
      stopHookActive:
        harness === 'claude' &&
        hookEventName === 'Stop' &&
        payload.stop_hook_active === true,
    }
  } catch {
    return null
  }
}
