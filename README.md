<h1 align="center">⏳ meanwhile</h1>
<p align="center"><i>Your agent's working. Meanwhile…</i></p>
<p align="center">While your Claude Code, Codex, or Conductor agent works, meanwhile sends you somewhere worthwhile — and pulls you back the second the agent needs you.</p>
<p align="center">
  <img alt="platform: macOS" src="https://img.shields.io/badge/platform-macOS-000000?logo=apple">
  <a href="LICENSE"><img alt="license: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <img alt="PRs welcome" src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg">
</p>

<!-- TODO: record demo gif -->
![demo](docs/demo.gif)

## Why this exists

I built meanwhile while learning Italian: I kept feeding prompts to coding agents, then doomscrolling through every wait. Now meanwhile flips those loose minutes to Duolingo instead, then brings me back the moment the agent needs me. Duolingo is the shipped default URL, but you can point it anywhere worthwhile.

## The idea

You ask your coding agent for something big. Now you're waiting — and you know exactly what happens next: Twitter, Reddit, the fridge.

meanwhile turns that dead time into something worthwhile:

1. **You submit a prompt.** meanwhile quietly starts a 20-second timer.
2. **Quick answer?** The timer is cancelled before you notice anything. Fast questions never interrupt you.
3. **Still working after 20 seconds?** This is a real wait — meanwhile opens whatever site you chose (Duolingo by default). If you already have a tab open, it focuses that tab instead of making a new one.
4. **The agent finishes, or needs your permission?** You're pulled straight back to your coding app, mid-activity or not. The wait is over.

```text
you: "refactor everything"
        │
        ▼
   ⏳ 20s timer ──── agent finishes fast ──► nothing happens, you never left
        │
        ▼ still working…
   🦉 your site opens (Duolingo by default)
        │
        ▼ agent finishes / asks permission
   💻 you're pulled back to your coding app
```

A few nice touches:

- **Running 5 agents in parallel** (hi, Conductor users)? They share **one** site tab and **one** pull-back — no tab spam, no focus ping-pong.
- **Already switched back on your own?** meanwhile notices and won't steal your focus — it just tidies up.
- **No daemon, no polling, no telemetry.** It's just lifecycle hooks your agent already supports, plus a few tiny local state files. Nothing ever leaves your machine.

## Install

You need macOS and Node.js 20+.

```sh
git clone https://github.com/ztsrdev/meanwhile.git
cd meanwhile && node dist/meanwhile.mjs install
```

The installer detects Claude Code, Codex, and Conductor, and wires up whichever you confirm. Then:

- **First long prompt:** macOS shows a one-time *"wants to control Google Chrome"* dialog — click **OK**. (That's the only permission meanwhile needs. Details: [macOS permissions](docs/macos-permissions.md).)
- **Codex users:** open `codex`, type `/hooks`, approve once. Codex silently ignores un-trusted hooks, so meanwhile does nothing until you do this.

Want to try it without installing anything? Claude Code only:

```sh
claude --plugin-dir /path/to/meanwhile
```

## What works where

| Harness | Support | Notes |
| --- | --- | --- |
| Claude Code | ✅ Full | Installed as a plugin — your `settings.json` is never touched. Pulls back on finish, permission prompts, and idle waits. |
| Codex CLI | ✅ Full (minus idle detection) | Native hooks in `~/.codex/hooks.json`. Pulls back on turn end and permission requests. |
| Conductor | ✅ Automatic | Works through the Claude plugin with zero extra setup. Pull-back brings Conductor forward; meanwhile mutes its own sounds since Conductor has its own. |
| Codex *inside* Conductor | 🚧 Not yet | Planned for v0.3. |
| Linux / Windows | 🚧 Not yet | Linux planned for v0.2, Windows for v0.4. |

More detail per harness: [Claude Code](docs/claude-code.md) · [Codex](docs/codex.md) · [Conductor](docs/conductor.md)

## Settings

Everything lives in `~/.meanwhile/config.json`, managed with `meanwhile config`:

```sh
meanwhile config set delaySeconds 45
meanwhile config set url https://monkeytype.com
meanwhile config list
```

| Key | Default | What it does |
| --- | --- | --- |
| `url` | `https://www.duolingo.com/learn` | Where the wait sends you. Any URL. |
| `delaySeconds` | `20` | How long a turn must run before you're sent away. |
| `browser` | `auto` | `auto`: reuse a matching Chrome tab if Chrome is running, else the default browser. `chrome`: always Chrome. `default`: always the system opener. |
| `pullBack.enabled` | `true` | `false` turns off every pull-back (you'll just… stay on your chosen site). |
| `pullBack.multiSession` | `all-idle` | With parallel agents: `all-idle` waits until *all* are done before pulling you back; `any-finishes` returns you as soon as the one that sent you away finishes. |
| `pullBack.notification` | `true` | Show a one-line "ready / needs input" notification. |
| `pullBack.sound` | `false` | Play a sound on pull-back. |
| `conductor.suppressAlerts` | `true` | Don't double-alert on top of Conductor's own sounds. |

Need it off for one session? `MEANWHILE_DISABLE=1 claude` — no uninstall needed.

### Good sites for short waits

Sites that *end by themselves* work especially well for short waits:

- [Duolingo](https://www.duolingo.com/learn) — the shipped default, and where the Italian-learning idea began; open-ended lessons make the pull-back useful
- [Monkeytype](https://monkeytype.com) — pick a 30–120s typing test
- [Lichess Puzzle Streak](https://lichess.org/streak) — ends on your first mistake
- [AnkiWeb](https://ankiweb.net/decks) — ends when the due queue is empty
- [Busuu](https://www.busuu.com/dashboard) — another good fit for longer waits

## Commands

| Command | What it does |
| --- | --- |
| `meanwhile install` | Detect your harnesses and wire them up. |
| `meanwhile status` | Doctor: check wiring, config, live sessions, and the macOS permission. |
| `meanwhile config get/set/list` | Read and change settings (validated before saving). |
| `meanwhile uninstall [--purge]` | Remove exactly what was installed; `--purge` also deletes `~/.meanwhile`. |

(From a clone, use `node dist/meanwhile.mjs <command>`.)

## Uninstall

```sh
node dist/meanwhile.mjs uninstall
```

Removes the Claude plugin and marketplace entry, and surgically removes only meanwhile's entries from `~/.codex/hooks.json`. Nothing else is touched — meanwhile never edits `~/.claude/settings.json`, and never touches your Codex `notify` setting.

## FAQ

**Why didn't it interrupt my quick question?**
That's the 20-second timer doing its job — a fast turn cancels the handoff before it happens.

**I have 5 agents running. Why only one site tab?**
The first timer to fire claims a shared "away" marker; the rest see it and stay quiet. One tab, one pull-back.

**Why does nothing happen in Codex?**
You probably skipped the one-time trust step: run `/hooks` inside `codex` and approve. Codex silently skips untrusted hooks.

**One agent finished but I wasn't pulled back?**
By default (`all-idle`) meanwhile waits until *all* your parallel agents are done — no focus ping-pong. Prefer instant returns? `meanwhile config set pullBack.multiSession any-finishes`.

**Does it read my prompts?**
No. It only sees event names, session IDs, and working directories. Prompt text is ignored, and nothing is sent anywhere.

---

Duolingo is a trademark of Duolingo, Inc. meanwhile is not affiliated with or endorsed by Duolingo — the default URL is just a configurable preference.

[MIT License](LICENSE)
