# Codex CLI

`awaitlingo install` adds only awaitlingo-owned entries to `~/.codex/hooks.json`.

## Hooks written

| PascalCase event | Effect |
| --- | --- |
| `UserPromptSubmit` | Mark the session busy and arm the confirmation timer. |
| `Stop` | Treat turn end as completion and apply the pull-back policy. |
| `PermissionRequest` | Pull back immediately because Codex needs approval. |
| `SessionEnd` | Remove the session's local state. |

Entries live under the file's top-level `"hooks"` key — Codex ignores event
groups placed at the root (verified against codex-cli 0.144.1). Each event
receives one command hook equivalent to:

```json
{"hooks": {"Stop": [{"hooks": [{"type": "command", "command": "node ~/.awaitlingo/bin/awaitlingo.mjs hook --harness codex", "timeout": 10}]}]}}
```

The real command contains the absolute home path. There is no `async` field: Codex 0.144.1 silently skips hooks marked async. Re-running `awaitlingo install` repairs a file whose events ended up at the root (for example, one written by an early awaitlingo build).

## Trust the hooks once

After installation:

1. Start `codex`.
2. Type `/hooks`.
3. Review and approve the awaitlingo hooks.

Until this approval, Codex silently no-ops the entries. If Claude works but Codex does nothing, check trust first.

## What the installer leaves alone

awaitlingo does not edit `~/.codex/config.toml`. It does not replace or wrap your `notify` setting. Uninstall removes only entries identified as awaitlingo's.

The runnable bundle is copied into `~/.awaitlingo/bin/` so an installation survives changes to a repository checkout and to nvm/npx package locations.

## Lifecycle limitation

Codex exposes turn end and permission requests, but not Claude's idle notification signal. awaitlingo therefore pulls back on `Stop` or `PermissionRequest`; it cannot distinguish every form of waiting-for-input state.

Run `awaitlingo status` to inspect the entries, bundle, and local permission path. Hook errors are written to `~/.awaitlingo/logs/awaitlingo.log`.
