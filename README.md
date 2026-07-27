<h1 align="center">⏳ awaitlingo</h1>
<p align="center"><i>Learn a language in the <code>await</code>.</i></p>
<p align="center">While your Claude Code, Codex, or Conductor agent works, awaitlingo opens a quick language lesson—and pulls you back the second it needs you.</p>
<p align="center">
  <img alt="platform: macOS" src="https://img.shields.io/badge/platform-macOS-000000?logo=apple">
  <a href="LICENSE"><img alt="license: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <img alt="PRs welcome" src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg">
</p>

<!-- TODO: record demo gif -->
![demo](docs/demo.gif)

## How it works

1. You submit a prompt. A local lifecycle hook marks that agent session busy.
2. A 20-second confirmation timer starts. Quick turns stop it before you are interrupted.
3. Still working? The timer records one shared “away” state.
4. awaitlingo focuses the configured lesson. With default `auto`, it reuses a Chrome tab for the same origin.
5. The agent finishes or asks for input. The pending timer is cancelled.
6. Your coding app comes forward again, with a ready or needs-input reason.

If you've already switched back to non-browser work on your own, awaitlingo won't steal focus; it just tidies up and notifies you if configured.

```text
prompt ── 20s ──► still busy? ── yes ──► lesson
   └──── quick stop: stay put       ready/input ──► coding app
```

There is no daemon, polling, telemetry, or awaitlingo network service. The browser makes the normal request for your configured URL; awaitlingo itself uses local lifecycle hooks and atomic state files. Parallel agents share one lesson handoff and one eventual pull-back.

## Quickstart

macOS and Node.js 20 or newer are required.

```sh
git clone https://github.com/ztsrdev/awaitlingo.git
cd awaitlingo && node dist/awaitlingo.mjs install
```

For a zero-install Claude Code trial:

```sh
claude --plugin-dir /path/to/awaitlingo
```

Submit a prompt that runs longer than 20 seconds. On the first handoff, macOS shows an Automation consent dialog for each app pair involved, such as “wants to control Google Chrome” or System Events. Click **OK**. See [macOS permissions](docs/macos-permissions.md).

Codex users must also run `codex`, type `/hooks`, and approve the installed hooks once. Until they are trusted, Codex silently skips them and awaitlingo does nothing.

## Harness support

| Harness | Support | Wiring and pull-back behavior |
| --- | --- | --- |
| Claude Code | Full | Plugin hooks arm on prompt submit and pull back on stop, permission prompts, or idle prompts. |
| Codex CLI | Full, except idle detection | Hooks live in `~/.codex/hooks.json`. Pull-back happens at turn end or on a permission request. |
| Conductor | Automatic through the Claude plugin | Session-aware across parallel worktrees. Pull-back activates Conductor.app. awaitlingo notifications and sounds are muted by default because Conductor has its own. |
| Codex inside Conductor | Not yet supported | Planned for v0.3 after its hook lifecycle is verified. |
| Linux / Windows | Not yet supported | Linux is planned for v0.2; Windows for v0.4. |

More detail: [Claude Code](docs/claude-code.md), [Codex](docs/codex.md), and [Conductor](docs/conductor.md).

## Configuration

Configuration is stored at `~/.awaitlingo/config.json`.

| Key | Default | Accepted values / behavior |
| --- | --- | --- |
| `url` | `https://www.duolingo.com/learn` | Any URL string. |
| `delaySeconds` | `20` | Non-negative finite number of seconds before the lesson opens. `config set` rejects negatives; a negative value in a hand-edited file falls back to the default. |
| `browser` | `auto` | `auto` reuses a running Chrome tab for the same origin, then falls back to the default browser; `chrome` prefers Chrome but falls back on Automation failure; `default` always uses the system URL opener. |
| `pullBack.enabled` | `true` | Enables pull-back on turn completion and needs-input events. Set to `false` to disable every pull-back. |
| `pullBack.multiSession` | `all-idle` | `all-idle` waits for every tracked session; `any-finishes` returns when the away-owning session finishes. |
| `pullBack.notification` | `true` | Shows a one-line ready/needs-input macOS notification. |
| `pullBack.sound` | `false` | Plays the macOS Glass sound on pull-back. |
| `conductor.suppressAlerts` | `true` | Suppresses awaitlingo notification and sound requests under Conductor. |
| `AWAITLINGO_DISABLE` | unset | Set the environment variable to `1` or `true` to disable hook handling without uninstalling. |

```sh
awaitlingo config set delaySeconds 45
awaitlingo config set pullBack.multiSession any-finishes
awaitlingo config get url
awaitlingo config list
```

### Presets

Short waits work best with activities that end by themselves: a timed Monkeytype test, Lichess Puzzle Streak ending on the first mistake, or an AnkiWeb due queue that empties. Duolingo and Busuu fit longer waits.

```sh
awaitlingo config set url https://monkeytype.com
awaitlingo config set url https://lichess.org/streak
awaitlingo config set url https://ankiweb.net/decks
awaitlingo config set url https://www.duolingo.com/learn
awaitlingo config set url https://www.busuu.com/dashboard
```

Choose a 30–120 second timed mode in Monkeytype before relying on it to stop.

## macOS permissions

awaitlingo needs one macOS permission category: **Automation**. macOS grants it once per controlling-app/target-app pair. The prompt may say that your terminal or host app wants to control System Events or another app. Accessibility is not required; awaitlingo never sends keystrokes.

If tab focus or pull-back silently stops working, check **System Settings → Privacy & Security → Automation**. `awaitlingo status` diagnoses the local installation and permission path. See the [permission walkthrough](docs/macos-permissions.md).

## Commands

| Command | Purpose |
| --- | --- |
| `awaitlingo install` | Install the Claude plugin and Codex hooks, and vendor the runnable bundle. |
| `awaitlingo uninstall [--purge]` | Remove only awaitlingo integration entries; `--purge` also removes local state and configuration. |
| `awaitlingo status` | Run the installation and macOS-permission doctor. On non-macOS hosts, the Automation probe reports “not applicable.” |
| `awaitlingo config get <key>` | Print one configuration value. |
| `awaitlingo config set <key> <value>` | Validate and save one configuration value. |
| `awaitlingo config list` | Print the effective configuration. |

## Uninstall

From a clone:

```sh
node dist/awaitlingo.mjs uninstall
```

If installed through npm:

```sh
awaitlingo uninstall
```

This removes the Claude plugin and marketplace entry, then surgically removes only awaitlingo entries from `~/.codex/hooks.json`. Add `--purge` to also delete `~/.awaitlingo`. Nothing else is touched. awaitlingo never edits `~/.claude/settings.json`.

## FAQ

### Why does it not interrupt quick questions?

The 20-second timer is confirmation, not a delay after completion. A quick stop cancels the pending handoff.

### Why do five parallel agents produce one lesson handoff?

The first timer creates a shared away marker. Later timers see it and do not open the URL again. On separate handoffs, the default `auto` mode searches a running Chrome instance by URL origin and focuses that tab before opening another.

### Why did nothing happen in Codex?

Run `/hooks` inside Codex and trust the installed hooks. Codex silently skips untrusted hooks.

### Why does one of several finishing agents not pull me back?

`pullBack.multiSession` defaults to `all-idle`, so ordinary completion waits until every tracked session is idle. Set `awaitlingo config set pullBack.multiSession any-finishes` to return when the session that opened the lesson finishes.

### How can I temporarily disable awaitlingo?

Set `AWAITLINGO_DISABLE=1` (or `true`) before launching your coding harness. Hooks then exit silently without creating session state; unset it to resume. To keep lesson handoffs but disable every return pull-back, set `pullBack.enabled` to `false`.

### Does awaitlingo read my prompts?

No. It consumes event names, session IDs, working directories, and lifecycle flags. Prompt text is ignored, and nothing is sent to an awaitlingo service.

---

Duolingo is a trademark of Duolingo, Inc. awaitlingo is not affiliated with or endorsed by Duolingo; the default URL is simply a configurable preference.

[MIT License](LICENSE)
