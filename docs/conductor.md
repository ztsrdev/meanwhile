# Conductor

Conductor needs no awaitlingo-specific hook file. It launches Claude Code with:

```text
--setting-sources=user,project,local
```

That behavior was verified live. Once the awaitlingo Claude plugin is installed, Claude loads it in Conductor the same way it does elsewhere.

## Session identity

Conductor exposes `CONDUCTOR_SESSION_ID`, and the Claude hook payload uses the same value as `session_id`. awaitlingo uses that ID for its atomic session state, so parallel Conductor worktrees remain distinct while sharing one away marker.

## Pull-back behavior

When any `CONDUCTOR_` environment variable is present, awaitlingo activates `com.conductor.app` instead of the app that was frontmost before the lesson opened.

Conductor has its own banners and sounds. With the default `conductor.suppressAlerts: true`, awaitlingo suppresses its notification and sound requests under Conductor.

## Known limits

- Pull-back can activate Conductor.app, but Conductor exposes no per-workspace deep link. awaitlingo cannot select the exact originating worktree.
- Codex running inside Conductor is not supported yet. Its hook environment must be verified before wiring is added.

For a missed pull-back, run `awaitlingo status`, confirm the Claude plugin is loaded, and inspect `~/.awaitlingo/logs/awaitlingo.log`.
