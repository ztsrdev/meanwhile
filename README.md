<h1 align="center">⏳ meanwhile</h1>
<p align="center"><i>Your agent's working. Meanwhile…</i></p>
<p align="center">meanwhile opens Duolingo (or any site you choose) while your Claude Code, Codex, or Conductor agent works, and pulls you back the moment the agent needs you.</p>
<p align="center">
  <img alt="platform: macOS" src="https://img.shields.io/badge/platform-macOS-000000?logo=apple">
  <a href="LICENSE"><img alt="license: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <img alt="PRs welcome" src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg">
</p>

<!-- TODO: record a demo gif and add it here -->

## Why this exists

I built meanwhile while learning Italian. I kept handing prompts to coding agents and doomscrolling through every wait. Those minutes go to Duolingo now, and meanwhile brings me back when the agent needs me. Duolingo is the default because it is what I use; any URL works.

## How it works

1. You submit a prompt. meanwhile starts a 20-second timer.
2. If the agent answers quickly, the timer is cancelled and nothing happens. Short questions never interrupt you.
3. If the agent is still working after 20 seconds, meanwhile opens your chosen site. When that site is already open in a Chrome tab, it focuses the tab instead of opening a duplicate.
4. When the agent finishes or asks for permission, meanwhile brings your coding app back to the front.

```text
you: "refactor everything"
        │
        ▼
   20-second timer ── agent finishes fast ──► nothing happens, you never left
        │
        ▼ still working
   your site opens (Duolingo by default)
        │
        ▼ agent finishes or asks permission
   you're back in your coding app
```

Some details that matter in practice:

- Parallel agents share one tab and one pull-back. Five Conductor worktrees will not open five Duolingo tabs.
- If you switched back to work on your own, meanwhile leaves your focus alone and cleans up quietly.
- There is no daemon, no polling, and no telemetry. The whole mechanism is lifecycle hooks plus a few small state files in `~/.meanwhile`. Nothing leaves your machine.

## Install

You need macOS and Node.js 20 or newer.

```sh
git clone https://github.com/ztsrdev/meanwhile.git
cd meanwhile && node dist/meanwhile.mjs install
```

The installer detects Claude Code, Codex, and Conductor, and wires up the ones you confirm. Two one-time steps remain:

- On your first long prompt, macOS asks whether your terminal may control Google Chrome. Click OK. This is the only permission meanwhile needs; see [macOS permissions](docs/macos-permissions.md).
- Codex users: open `codex`, type `/hooks`, and approve the entries once. Codex skips hooks it has not been told to trust, so meanwhile stays inert until then.

To try it in Claude Code without installing anything:

```sh
claude --plugin-dir /path/to/meanwhile
```

## What works where

| Harness | Support | Notes |
| --- | --- | --- |
| Claude Code | Yes | Installed as a plugin; your `settings.json` is never edited. Pulls back on finish, permission prompts, and idle waits. |
| Codex CLI | Yes, minus idle detection | Native hooks in `~/.codex/hooks.json`. Pulls back on turn end and permission requests. |
| Conductor | Yes, automatic | Works through the Claude plugin with no extra setup. Pull-back brings Conductor forward, and meanwhile mutes its own alerts since Conductor has sounds of its own. |
| Codex inside Conductor | Not yet | Planned for v0.3. |
| Linux / Windows | Not yet | Linux is planned for v0.2, Windows for v0.4. |

Per-harness detail: [Claude Code](docs/claude-code.md) · [Codex](docs/codex.md) · [Conductor](docs/conductor.md)

## Settings

Settings live in `~/.meanwhile/config.json` and are managed with `meanwhile config`:

```sh
meanwhile config set delaySeconds 45
meanwhile config set url https://monkeytype.com
meanwhile config list
```

| Key | Default | What it does |
| --- | --- | --- |
| `url` | `https://www.duolingo.com/learn` | Where the wait sends you. |
| `delaySeconds` | `20` | How long a turn must run before you are sent away. |
| `browser` | `auto` | `auto` reuses a matching Chrome tab when Chrome is running and falls back to the default browser. `chrome` always targets Chrome. `default` always uses the system opener. |
| `pullBack.enabled` | `true` | `false` turns off every pull-back. The site still opens. |
| `pullBack.multiSession` | `all-idle` | With parallel agents, `all-idle` waits until all of them are done before pulling you back. `any-finishes` returns you as soon as the session that sent you away finishes. |
| `pullBack.notification` | `true` | Show a one-line ready or needs-input notification. |
| `pullBack.sound` | `false` | Play a sound on pull-back. |
| `conductor.suppressAlerts` | `true` | Skip meanwhile's own notification and sound under Conductor. |

To disable meanwhile for a single session, run `MEANWHILE_DISABLE=1 claude`. No uninstall needed.

### Good sites for the wait

Sites that end by themselves suit short waits best:

- [Duolingo](https://www.duolingo.com/learn): the default, and where the Italian idea began. Lessons are open-ended, which is exactly what the pull-back is for.
- [Monkeytype](https://monkeytype.com): pick a 30 to 120 second typing test.
- [Lichess Puzzle Streak](https://lichess.org/streak): ends on your first mistake.
- [AnkiWeb](https://ankiweb.net/decks): ends when the due queue is empty.
- [Busuu](https://www.busuu.com/dashboard): another good fit for longer waits.

## Commands

| Command | What it does |
| --- | --- |
| `meanwhile install` | Detect your harnesses and wire them up. |
| `meanwhile status` | Check wiring, config, live sessions, and the macOS permission. |
| `meanwhile config get/set/list` | Read and change settings. Values are validated before saving. |
| `meanwhile uninstall [--purge]` | Remove exactly what was installed. `--purge` also deletes `~/.meanwhile`. |

From a clone, prefix each command with `node dist/meanwhile.mjs`.

## Uninstall

```sh
node dist/meanwhile.mjs uninstall
```

This removes the Claude plugin and marketplace entry, and removes only meanwhile's own entries from `~/.codex/hooks.json`. meanwhile never edits `~/.claude/settings.json` and never touches your Codex `notify` setting.

## FAQ

**Why didn't it interrupt my quick question?**
A turn shorter than `delaySeconds` cancels the timer before anything happens. That is the point of the delay.

**I run five agents at once. Why only one tab?**
The first timer to fire claims a shared away marker. The others see the marker and stay quiet.

**Nothing happens in Codex.**
Run `/hooks` inside `codex` and approve the meanwhile entries. Codex skips untrusted hooks without an error message.

**One agent finished but I wasn't pulled back.**
The default `all-idle` policy waits until every tracked session is idle, so agents finishing at different times don't fight over your focus. Set `pullBack.multiSession` to `any-finishes` to return sooner.

**Does it read my prompts?**
No. The hooks receive event names, session IDs, and working directories. Prompt text is ignored, and nothing is sent anywhere.

---

Duolingo is a trademark of Duolingo, Inc. meanwhile is not affiliated with or endorsed by Duolingo. The default URL is a configurable preference.

[MIT License](LICENSE)
