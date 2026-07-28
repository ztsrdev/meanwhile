# Conductor

Conductor needs no meanwhile-specific hook file. It launches Claude Code with:

```text
--setting-sources=user,project,local
```

That behavior was verified live. Once the meanwhile Claude plugin is installed, Claude loads it in Conductor the same way it does elsewhere.

## Session identity

Conductor exposes `CONDUCTOR_SESSION_ID`, and the Claude hook payload uses the same value as `session_id`. meanwhile uses that ID for its atomic session state, so parallel Conductor worktrees remain distinct while sharing one away marker.

## Pull-back behavior

When any `CONDUCTOR_` environment variable is present, meanwhile activates `com.conductor.app` instead of the app that was frontmost before the site opened.

Conductor has its own banners and sounds. With the default `conductor.suppressAlerts: true`, meanwhile suppresses its notification and sound requests under Conductor.

## Codex inside Conductor

Codex works inside Conductor as of meanwhile v0.2. Conductor's inline `--config hooks={PreToolUse=[...]}` checkpoint hook merges with the user-level event hooks in `~/.codex/hooks.json`; it does not replace them. The prompt timer, site opening, and pull-back all ran during the live test with codex-cli 0.144.1. Conductor can run its bundled Codex or the user's `codex_executable_path` from `~/.conductor/settings.toml`; both read the same user-level hooks.

Hook trust also lives in the shared `~/.codex` directory. Approving the hooks once with `/hooks` in any Codex session covers Conductor sessions. meanwhile keys state by the Codex hook's `session_id`, and any `CONDUCTOR_` environment variable routes pull-back to `com.conductor.app`.

## Known limits

- Pull-back can activate Conductor.app, but Conductor exposes no per-workspace deep link. meanwhile cannot select the exact originating worktree.

For a missed pull-back, run `meanwhile status`, confirm the Claude plugin is loaded, and inspect `~/.meanwhile/logs/meanwhile.log`.
