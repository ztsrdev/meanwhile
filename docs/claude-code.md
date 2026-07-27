# Claude Code

The awaitlingo plugin connects four Claude Code lifecycle events to the bundled CLI.

## Hook wiring

Every command hook runs:

```sh
node "${CLAUDE_PLUGIN_ROOT}/dist/awaitlingo.mjs" hook --harness claude
```

| Event | `hooks.json` semantics | Effect |
| --- | --- | --- |
| `UserPromptSubmit` | Command hook with `async: true`; no matcher | Mark the session busy and arm the detached confirmation timer without delaying prompt submission. |
| `Stop` | Command hook with `async: true`; no matcher | Cancel a pending timer, mark the session idle, and apply the configured pull-back policy. |
| `Notification` | Command hook with `async: true`; matcher `permission_prompt\|idle_prompt` | Pull back immediately because Claude needs attention. Other notifications are ignored. |
| `SessionEnd` | Synchronous command hook; no matcher | Remove the session's local state. |

Every command has a 10-second hook timeout. The hook receives JSON on stdin. awaitlingo reads lifecycle metadata, not the `prompt` field. Hook failures are logged and return successfully so they cannot block Claude.

Claude may set `stop_hook_active: true` when a Stop hook causes another Stop. awaitlingo clears the session's pending/busy state but does not pull back for that recursive event.

## Try without installing

From a built checkout:

```sh
claude --plugin-dir /path/to/awaitlingo
```

This loads the plugin for that Claude launch only. The normal installer registers the plugin and also prepares Codex support.

## Troubleshooting

1. Run `awaitlingo status`.
2. Confirm the prompt lasted longer than `delaySeconds`.
3. Check `~/.awaitlingo/logs/awaitlingo.log` for ignored payloads or hook errors.
4. Re-run with `claude --plugin-dir /path/to/awaitlingo` to separate plugin discovery from engine behavior.
5. If the lesson opens but pull-back fails, check **System Settings → Privacy & Security → Automation**.

There is no background daemon to restart. Each prompt hook arms its own detached timer, coordinated through atomic files under `~/.awaitlingo/state/`.
