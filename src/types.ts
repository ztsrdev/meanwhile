export type Harness = 'claude' | 'codex'
export type EventKind = 'prompt-submit' | 'stop' | 'needs-input' | 'session-end' | 'ignored'

export interface NormalizedEvent {
  harness: Harness
  kind: EventKind
  sessionId: string
  cwd: string
  stopHookActive: boolean
}

export interface PullBackConfig {
  enabled: boolean
  multiSession: 'all-idle' | 'any-finishes'
  notification: boolean
  sound: boolean
}

export interface Config {
  url: string
  delaySeconds: number
  browser: 'auto' | 'chrome' | 'default'
  pullBack: PullBackConfig
  conductor: { suppressAlerts: boolean }
}

export interface AwayState {
  owner: string
  prevApp: string | null
  since: number
}
