#!/usr/bin/env node

// src/cli.ts
import { parseArgs } from "node:util";

// src/engine/log.ts
import { appendFileSync, mkdirSync } from "node:fs";

// src/engine/paths.ts
import os from "node:os";
import { join } from "node:path";
var SESSION_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
function home() {
  return process.env.AWAITLINGO_HOME ?? join(os.homedir(), ".awaitlingo");
}
function configPath() {
  return join(home(), "config.json");
}
function stateDir() {
  return join(home(), "state");
}
function sessionsDir() {
  return join(stateDir(), "sessions");
}
function sessionDir(id) {
  if (!SESSION_ID_PATTERN.test(id) || id === "." || id === "..") {
    throw new Error(`Invalid session id: ${id}`);
  }
  return join(sessionsDir(), id);
}
function awayPath() {
  return join(stateDir(), "away.json");
}
function logDir() {
  return join(home(), "logs");
}
function logPath() {
  return join(logDir(), "awaitlingo.log");
}

// src/engine/log.ts
function appendLog(msg) {
  try {
    mkdirSync(logDir(), { recursive: true });
    appendFileSync(logPath(), `${(/* @__PURE__ */ new Date()).toISOString()} ${msg}
`, "utf8");
  } catch {
  }
}

// src/engine/config.ts
import { readFileSync } from "node:fs";

// src/engine/env.ts
function isDryRun() {
  return process.env.AWAITLINGO_DRYRUN === "1";
}
function underConductor() {
  return Object.keys(process.env).some((key) => key.startsWith("CONDUCTOR_"));
}

// src/engine/fs.ts
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  mkdirSync as mkdirSync2,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, join as join2 } from "node:path";
function atomicWriteFile(path, contents, mode) {
  mkdirSync2(dirname(path), { recursive: true });
  const temporary = join2(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`
  );
  try {
    writeFileSync(temporary, contents);
    if (mode !== void 0) {
      chmodSync(temporary, mode);
    }
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

// src/engine/config.ts
var DEFAULT_CONFIG = {
  url: "https://www.duolingo.com/learn",
  delaySeconds: 20,
  browser: "auto",
  pullBack: {
    enabled: true,
    multiSession: "all-idle",
    notification: true,
    sound: false
  },
  conductor: {
    suppressAlerts: true
  }
};
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
var CONFIG_RULES = {
  url: {
    isValid: (value) => typeof value === "string",
    expected: "a string"
  },
  delaySeconds: {
    isValid: (value) => typeof value === "number" && Number.isFinite(value) && value >= 0,
    expected: "a non-negative finite number"
  },
  browser: {
    isValid: (value) => value === "auto" || value === "chrome" || value === "default",
    expected: "auto|chrome|default"
  },
  "pullBack.enabled": {
    isValid: (value) => typeof value === "boolean",
    expected: "a boolean"
  },
  "pullBack.multiSession": {
    isValid: (value) => value === "all-idle" || value === "any-finishes",
    expected: "all-idle|any-finishes"
  },
  "pullBack.notification": {
    isValid: (value) => typeof value === "boolean",
    expected: "a boolean"
  },
  "pullBack.sound": {
    isValid: (value) => typeof value === "boolean",
    expected: "a boolean"
  },
  "conductor.suppressAlerts": {
    isValid: (value) => typeof value === "boolean",
    expected: "a boolean"
  }
};
function validateConfigValue(path, value) {
  const rule = CONFIG_RULES[path];
  if (!rule) {
    return "a known configuration value";
  }
  return rule.isValid(value) ? null : rule.expected;
}
function validOrDefault(path, value, fallback) {
  return validateConfigValue(path, value) === null ? value : fallback;
}
function mergeConfig(value) {
  const pullBack2 = isRecord(value.pullBack) ? value.pullBack : {};
  const conductor = isRecord(value.conductor) ? value.conductor : {};
  return {
    url: validOrDefault("url", value.url, DEFAULT_CONFIG.url),
    delaySeconds: validOrDefault(
      "delaySeconds",
      value.delaySeconds,
      DEFAULT_CONFIG.delaySeconds
    ),
    browser: validOrDefault("browser", value.browser, DEFAULT_CONFIG.browser),
    pullBack: {
      enabled: validOrDefault(
        "pullBack.enabled",
        pullBack2.enabled,
        DEFAULT_CONFIG.pullBack.enabled
      ),
      multiSession: validOrDefault(
        "pullBack.multiSession",
        pullBack2.multiSession,
        DEFAULT_CONFIG.pullBack.multiSession
      ),
      notification: validOrDefault(
        "pullBack.notification",
        pullBack2.notification,
        DEFAULT_CONFIG.pullBack.notification
      ),
      sound: validOrDefault(
        "pullBack.sound",
        pullBack2.sound,
        DEFAULT_CONFIG.pullBack.sound
      )
    },
    conductor: {
      suppressAlerts: validOrDefault(
        "conductor.suppressAlerts",
        conductor.suppressAlerts,
        DEFAULT_CONFIG.conductor.suppressAlerts
      )
    }
  };
}
function loadConfig() {
  try {
    const parsed = JSON.parse(readFileSync(configPath(), "utf8"));
    if (!isRecord(parsed)) {
      throw new Error("configuration root must be an object");
    }
    return mergeConfig(parsed);
  } catch (error) {
    const code = error.code;
    if (code !== "ENOENT") {
      appendLog(`config: ignored corrupt configuration: ${String(error)}`);
    }
    return mergeConfig({});
  }
}
function saveConfig(config) {
  const path = configPath();
  if (isDryRun()) {
    appendLog(`dryrun: would write config ${path}`);
    return false;
  }
  atomicWriteFile(path, `${JSON.stringify(config, null, 2)}
`);
  return true;
}

// src/engine/actions.ts
import { randomUUID as randomUUID2 } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync as readFileSync4 } from "node:fs";
import { join as join4 } from "node:path";

// src/constants.ts
var CHROME_BUNDLE_ID = "com.google.Chrome";
var CONDUCTOR_BUNDLE_ID = "com.conductor.app";
var BROWSER_BUNDLE_IDS = /* @__PURE__ */ new Set([
  CHROME_BUNDLE_ID,
  "com.apple.Safari",
  "org.mozilla.firefox",
  "com.microsoft.edgemac",
  "company.thebrowser.Browser",
  "com.brave.Browser",
  "com.vivaldi.Vivaldi"
]);

// src/engine/away.ts
import {
  existsSync,
  mkdirSync as mkdirSync3,
  readFileSync as readFileSync2,
  unlinkSync,
  writeFileSync as writeFileSync2
} from "node:fs";
import { dirname as dirname2 } from "node:path";
var AWAY_MAX_AGE_MS = 30 * 60 * 1e3;
function writeAway(state) {
  atomicWriteFile(awayPath(), JSON.stringify(state));
}
function exclusiveWrite(path, state) {
  try {
    writeFileSync2(path, JSON.stringify(state), {
      encoding: "utf8",
      flag: "wx"
    });
    return true;
  } catch (error) {
    if (error.code === "EEXIST") {
      return false;
    }
    throw error;
  }
}
function createAway(state) {
  const path = awayPath();
  const replacementLock = `${path}.replace-lock`;
  mkdirSync3(dirname2(path), { recursive: true });
  if (exclusiveWrite(path, state)) {
    return true;
  }
  try {
    writeFileSync2(replacementLock, "", {
      encoding: "utf8",
      flag: "wx"
    });
  } catch (error) {
    if (error.code === "EEXIST") {
      return false;
    }
    throw error;
  }
  try {
    if (readAway(state.since) !== null) {
      return false;
    }
    if (existsSync(path)) {
      try {
        unlinkSync(path);
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
      }
    }
    return exclusiveWrite(path, state);
  } finally {
    try {
      unlinkSync(replacementLock);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }
}
function readAway(now, maxAgeMs = AWAY_MAX_AGE_MS) {
  try {
    const parsed = JSON.parse(readFileSync2(awayPath(), "utf8"));
    if (typeof parsed !== "object" || parsed === null || typeof parsed.owner !== "string" || parsed.prevApp !== null && typeof parsed.prevApp !== "string" || typeof parsed.since !== "number" || !Number.isFinite(parsed.since) || now - parsed.since > maxAgeMs) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
function touchAway(now) {
  const current = readAway(now);
  if (current) {
    writeAway({ ...current, since: now });
  }
}
function clearAway(owner) {
  const current = readAway(Date.now(), Number.POSITIVE_INFINITY);
  if (current?.owner !== owner) {
    return;
  }
  try {
    unlinkSync(awayPath());
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

// src/engine/state.ts
import {
  mkdirSync as mkdirSync4,
  readFileSync as readFileSync3,
  readdirSync,
  renameSync as renameSync2,
  rmSync as rmSync2,
  statSync
} from "node:fs";
import { join as join3 } from "node:path";
var SESSION_ID_PATTERN2 = /^[A-Za-z0-9._-]+$/;
var BUSY_STALE_MS = AWAY_MAX_AGE_MS;
var ONE_DAY_MS = 24 * 60 * 60 * 1e3;
function readPending(path) {
  try {
    const parsed = JSON.parse(readFileSync3(path, "utf8"));
    if (typeof parsed === "object" && parsed !== null && typeof parsed.nonce === "string" && typeof parsed.since === "number") {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}
function readMeta(id) {
  try {
    const parsed = JSON.parse(readFileSync3(join3(sessionDir(id), "meta.json"), "utf8"));
    if (typeof parsed === "object" && parsed !== null && (parsed.harness === "claude" || parsed.harness === "codex") && typeof parsed.cwd === "string" && (parsed.busySince === null || typeof parsed.busySince === "number") && typeof parsed.updatedAt === "number") {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}
function armPending(id, nonce, now) {
  const directory = sessionDir(id);
  mkdirSync4(directory, { recursive: true });
  rmSync2(join3(directory, "fired"), { force: true });
  rmSync2(join3(directory, "cancelled"), { force: true });
  atomicWriteFile(
    join3(directory, "pending"),
    JSON.stringify({ nonce, since: now })
  );
}
function tryTransition(id, from, to, nonce) {
  const directory = sessionDir(id);
  const source = join3(directory, from);
  if (nonce !== void 0 && readPending(source)?.nonce !== nonce) {
    return false;
  }
  try {
    renameSync2(source, join3(directory, to));
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
function clearOutcome(id) {
  const directory = sessionDir(id);
  rmSync2(join3(directory, "fired"), { force: true });
  rmSync2(join3(directory, "cancelled"), { force: true });
}
function setBusy(id, harness, cwd, now) {
  atomicWriteFile(
    join3(sessionDir(id), "meta.json"),
    JSON.stringify({
      harness,
      cwd,
      busySince: now,
      updatedAt: now
    })
  );
}
function clearBusy(id, now) {
  const existing = readMeta(id);
  if (!existing) {
    return;
  }
  atomicWriteFile(
    join3(sessionDir(id), "meta.json"),
    JSON.stringify({
      ...existing,
      busySince: null,
      updatedAt: now
    })
  );
}
function otherSessionsBusy(excludeId, now, staleMs = BUSY_STALE_MS) {
  sessionDir(excludeId);
  return listSessions().some((id) => {
    if (id === excludeId) {
      return false;
    }
    const meta = readMeta(id);
    return meta?.busySince !== null && meta?.busySince !== void 0 && now - meta.busySince <= staleMs;
  });
}
function removeSession(id) {
  rmSync2(sessionDir(id), { recursive: true, force: true });
}
function gc(now, maxAgeMs = ONE_DAY_MS) {
  try {
    for (const id of listSessions()) {
      try {
        const directory = sessionDir(id);
        const meta = readMeta(id);
        const updatedAt = meta?.updatedAt ?? statSync(directory).mtimeMs;
        if (now - updatedAt > maxAgeMs) {
          rmSync2(directory, { recursive: true, force: true });
        }
      } catch {
      }
    }
  } catch {
  }
}
function listSessions() {
  try {
    return readdirSync(sessionsDir(), { withFileTypes: true }).filter(
      (entry) => entry.isDirectory() && SESSION_ID_PATTERN2.test(entry.name) && entry.name !== "." && entry.name !== ".."
    ).map((entry) => entry.name).sort();
  } catch {
    return [];
  }
}

// src/engine/actions.ts
var GC_INTERVAL_MS = 10 * 60 * 1e3;
function gcIfDue(now) {
  const path = join4(stateDir(), "last-gc");
  try {
    const lastGc = Number(readFileSync4(path, "utf8").trim());
    if (Number.isFinite(lastGc) && now >= lastGc && now - lastGc < GC_INTERVAL_MS) {
      return;
    }
  } catch {
  }
  atomicWriteFile(path, `${now}
`);
  gc(now);
}
async function pullBack(away, cfg, platform, body) {
  const conductor = underConductor();
  const target = conductor ? CONDUCTOR_BUNDLE_ID : away.prevApp;
  if (target) {
    const frontmost = await platform.frontmostBundleId();
    const userAlreadyReturned = frontmost !== null && frontmost !== target && !BROWSER_BUNDLE_IDS.has(frontmost);
    if (!userAlreadyReturned && frontmost !== target) {
      await platform.activateApp(target);
    }
  }
  const suppressAlerts = conductor && cfg.conductor.suppressAlerts;
  if (!suppressAlerts) {
    const alerts = [];
    if (cfg.pullBack.notification) {
      alerts.push(platform.notify("awaitlingo", body));
    }
    if (cfg.pullBack.sound) {
      alerts.push(platform.playSound());
    }
    await Promise.all(alerts);
  }
}
async function settleAway(away, ev, cfg, platform, body) {
  if (cfg.pullBack.enabled) {
    await pullBack(away, cfg, platform, body);
  }
  clearAway(away.owner);
  clearOutcome(away.owner);
  if (away.owner !== ev.sessionId) {
    clearOutcome(ev.sessionId);
  }
}
function onPromptSubmit(ev, cfg, deps = {}) {
  const now = (deps.now ?? Date.now)();
  const nonce = (deps.nonce ?? randomUUID2)();
  const selfPath = deps.selfPath ?? process.argv[1];
  if (!selfPath) {
    throw new Error("Unable to resolve the awaitlingo entry script");
  }
  gcIfDue(now);
  setBusy(ev.sessionId, ev.harness, ev.cwd, now);
  armPending(ev.sessionId, nonce, now);
  const spawnTimer = deps.spawn ?? spawn;
  spawnTimer(
    process.execPath,
    [
      selfPath,
      "timer",
      "--session",
      ev.sessionId,
      "--nonce",
      nonce,
      "--delay",
      String(cfg.delaySeconds)
    ],
    { detached: true, stdio: "ignore" }
  ).unref();
}
async function onTimerFire(sessionId, nonce, cfg, platform) {
  if (!tryTransition(sessionId, "pending", "fired", nonce)) {
    return;
  }
  const now = Date.now();
  if (readAway(now)) {
    touchAway(now);
    return;
  }
  if (!createAway({ owner: sessionId, prevApp: null, since: now })) {
    touchAway(now);
    return;
  }
  const prevApp = await platform.frontmostBundleId();
  await platform.openOrFocusUrl(cfg.url, cfg.browser);
  const claimed = readAway(Date.now(), Number.POSITIVE_INFINITY);
  if (claimed?.owner === sessionId) {
    writeAway({ ...claimed, prevApp });
  }
}
async function onStop(ev, cfg, platform) {
  const now = Date.now();
  clearBusy(ev.sessionId, now);
  tryTransition(ev.sessionId, "pending", "cancelled");
  if (ev.stopHookActive) {
    return;
  }
  const away = readAway(now);
  if (!away || !cfg.pullBack.enabled) {
    return;
  }
  const anotherSessionIsBusy = otherSessionsBusy(ev.sessionId, now);
  const ownsAway = away.owner === ev.sessionId;
  const completesDeferredAllIdle = cfg.pullBack.multiSession === "all-idle" && !anotherSessionIsBusy;
  if (!ownsAway && !completesDeferredAllIdle) {
    return;
  }
  if (cfg.pullBack.multiSession === "all-idle" && anotherSessionIsBusy) {
    return;
  }
  await settleAway(
    away,
    ev,
    cfg,
    platform,
    "Your coding agent is ready."
  );
}
async function onNeedsInput(ev, cfg, platform) {
  const now = Date.now();
  clearBusy(ev.sessionId, now);
  tryTransition(ev.sessionId, "pending", "cancelled");
  const away = readAway(now);
  if (!away) {
    return;
  }
  await settleAway(
    away,
    ev,
    cfg,
    platform,
    "Your coding agent needs input."
  );
}
function onSessionEnd(ev) {
  removeSession(ev.sessionId);
  gc(Date.now());
}

// src/adapters/normalize.ts
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function normalize(harness, payload) {
  try {
    if (!isRecord2(payload) || typeof payload.session_id !== "string" || !payload.session_id) {
      return null;
    }
    const hookEventName = typeof payload.hook_event_name === "string" ? payload.hook_event_name : "";
    const notificationType = typeof payload.notification_type === "string" ? payload.notification_type : void 0;
    let kind;
    switch (hookEventName) {
      case "UserPromptSubmit":
        kind = "prompt-submit";
        break;
      case "Stop":
        kind = "stop";
        break;
      case "Notification":
        kind = notificationType === "permission_prompt" || notificationType === "idle_prompt" ? "needs-input" : "ignored";
        break;
      case "PermissionRequest":
        kind = "needs-input";
        break;
      case "SessionEnd":
        kind = "session-end";
        break;
      default:
        kind = "ignored";
    }
    return {
      harness,
      kind,
      sessionId: payload.session_id,
      cwd: typeof payload.cwd === "string" ? payload.cwd : "",
      stopHookActive: harness === "claude" && hookEventName === "Stop" && payload.stop_hook_active === true
    };
  } catch {
    return null;
  }
}

// src/engine/exec.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
var execFileAsync = promisify(execFile);
function displayArgument(argument) {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(argument) ? argument : JSON.stringify(argument);
}
function displayCommand(command, args) {
  return [command, ...args].map(displayArgument).join(" ");
}
function oneLine(value) {
  return value.replaceAll("\r", "\\r").replaceAll("\n", "\\n");
}
function logDryRun(command, args, description) {
  if (!description) {
    appendLog(`dryrun: exec ${displayCommand(command, args)}`);
    return;
  }
  appendLog(
    `dryrun: ${oneLine(description.summary)} ${JSON.stringify({
      action: description.action,
      command,
      args,
      ...description.details
    })}`
  );
}
async function execute(command, args, options) {
  const dryRun = isDryRun();
  if (dryRun) {
    logDryRun(command, args, options.dryRunDescription);
  }
  if (process.env.AWAITLINGO_TEST_FAIL_EXEC === "1") {
    return {
      stdout: "",
      stderr: `forced execFile failure for ${command}`,
      exitCode: 1,
      skipped: false
    };
  }
  if (dryRun) {
    return { stdout: "", stderr: "", exitCode: 0, skipped: true };
  }
  try {
    const { stdout, stderr } = await execFileAsync(command, [...args], {
      encoding: "utf8",
      timeout: options.timeoutMs,
      maxBuffer: 1024 * 1024
    });
    return {
      stdout,
      stderr,
      exitCode: 0,
      skipped: false
    };
  } catch (error) {
    const failure = error;
    return {
      stdout: typeof failure.stdout === "string" ? failure.stdout : "",
      stderr: typeof failure.stderr === "string" ? failure.stderr : failure.message,
      exitCode: typeof failure.code === "number" ? failure.code : 1,
      skipped: false
    };
  }
}

// src/platform/index.ts
var EXEC_TIMEOUT_MS = 5e3;
var CHROME_RUNNING_SCRIPT = 'application "Google Chrome" is running';
var FRONTMOST_APP_SCRIPT = 'tell application "System Events" to get bundle identifier of (first application process whose frontmost is true)';
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function logFailure(action, error) {
  appendLog(`platform: ${action} failed: ${errorMessage(error)}`);
}
async function invoke(command, args, dryRunDescription) {
  const description = dryRunDescription ?? {
    action: "execFile",
    summary: [command, ...args].join(" ")
  };
  const result = await execute(command, args, {
    timeoutMs: EXEC_TIMEOUT_MS,
    dryRunDescription: description
  });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || `exit ${result.exitCode}`);
  }
  return result.stdout;
}
function escapeAppleScript(value) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}
function originOf(value) {
  try {
    const origin = new URL(value).origin;
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}
function buildTabFocusScript(origin) {
  const escapedOrigin = escapeAppleScript(origin);
  return [
    'tell application "Google Chrome"',
    "  repeat with w in windows",
    "    set tabCount to count of tabs of w",
    "    repeat with i from 1 to tabCount",
    "      set tabUrl to URL of tab i of w",
    `      if tabUrl is "${escapedOrigin}" or tabUrl starts with "${escapedOrigin}/" then`,
    "        set active tab index of w to i",
    "        set index of w to 1",
    "        activate",
    '        return "focused"',
    "      end if",
    "    end repeat",
    "  end repeat",
    "end tell",
    'return "not-found"'
  ].join("\n");
}
async function openDefault(url) {
  try {
    await invoke("open", [url]);
  } catch (error) {
    logFailure("opening URL with the default browser", error);
  }
}
async function openChrome(url) {
  try {
    await invoke("open", ["-b", CHROME_BUNDLE_ID, url]);
  } catch (error) {
    logFailure("opening URL with Google Chrome", error);
    await openDefault(url);
  }
}
var DarwinPlatform = class {
  async frontmostBundleId() {
    try {
      const output = await invoke("osascript", ["-e", FRONTMOST_APP_SCRIPT]);
      return output.trim() || null;
    } catch (error) {
      logFailure("reading the frontmost application", error);
      return null;
    }
  }
  async openOrFocusUrl(url, browser) {
    if (browser === "default") {
      await openDefault(url);
      return;
    }
    const origin = originOf(url);
    if (origin === null) {
      appendLog("platform: URL has no parseable origin; using the default browser");
      await openDefault(url);
      return;
    }
    let chromeRunning;
    try {
      const output = await invoke("osascript", ["-e", CHROME_RUNNING_SCRIPT]);
      chromeRunning = output.trim().toLowerCase() === "true";
    } catch (error) {
      logFailure("checking whether Google Chrome is running", error);
      await openDefault(url);
      return;
    }
    if (!chromeRunning) {
      if (browser === "chrome") {
        await openChrome(url);
      } else {
        await openDefault(url);
      }
      return;
    }
    try {
      const output = await invoke("osascript", ["-e", buildTabFocusScript(origin)]);
      if (output.trim().toLowerCase() === "focused") {
        return;
      }
    } catch (error) {
      logFailure("focusing an existing Google Chrome tab", error);
      await openDefault(url);
      return;
    }
    if (browser === "chrome") {
      await openChrome(url);
    } else {
      await openDefault(url);
    }
  }
  async activateApp(bundleId) {
    try {
      await invoke("osascript", [
        "-e",
        `tell application id "${escapeAppleScript(bundleId)}" to activate`
      ]);
    } catch (error) {
      logFailure(`activating application ${bundleId}`, error);
    }
  }
  async notify(title, body) {
    try {
      await invoke(
        "osascript",
        [
          "-e",
          `display notification "${escapeAppleScript(body)}" with title "${escapeAppleScript(title)}"`
        ],
        {
          action: "notify",
          summary: `notify ${title}: ${body}`,
          details: { title, body }
        }
      );
    } catch (error) {
      logFailure("showing a notification", error);
    }
  }
  async playSound() {
    try {
      await invoke("afplay", ["/System/Library/Sounds/Glass.aiff"], {
        action: "playSound",
        summary: "playSound"
      });
    } catch (error) {
      logFailure("playing the notification sound", error);
    }
  }
};
var NonDarwinPlatform = class {
  async frontmostBundleId() {
    if (isDryRun()) {
      appendLog(
        `dryrun: frontmostBundleId ${JSON.stringify({
          action: "frontmostBundleId",
          result: null,
          platform: process.platform
        })}`
      );
    }
    return null;
  }
  async openOrFocusUrl(url, _browser) {
    try {
      await invoke("xdg-open", [url]);
    } catch (error) {
      logFailure("opening URL with xdg-open", error);
    }
  }
  async activateApp(bundleId) {
    if (isDryRun()) {
      appendLog(
        `dryrun: activateApp ${JSON.stringify({
          action: "activateApp",
          bundleId,
          outcome: "no-op",
          platform: process.platform
        })}`
      );
      return;
    }
    appendLog(`platform: activateApp is unavailable on ${process.platform}`);
  }
  async notify(title, body) {
    try {
      await invoke("notify-send", [title, body], {
        action: "notify",
        summary: `notify ${title}: ${body}`,
        details: { title, body }
      });
    } catch (error) {
      logFailure("showing a notification with notify-send", error);
    }
  }
  async playSound() {
    if (isDryRun()) {
      appendLog(
        `dryrun: playSound ${JSON.stringify({
          action: "playSound",
          outcome: "no-op",
          platform: process.platform
        })}`
      );
      return;
    }
    appendLog(`platform: playSound is unavailable on ${process.platform}`);
  }
};
function getPlatform() {
  return process.platform === "darwin" ? new DarwinPlatform() : new NonDarwinPlatform();
}
async function probeAutomation() {
  if (process.platform !== "darwin") {
    return "not-applicable";
  }
  const result = await execute("osascript", ["-e", FRONTMOST_APP_SCRIPT], {
    timeoutMs: EXEC_TIMEOUT_MS
  });
  if (result.skipped) {
    return "skipped";
  }
  if (result.exitCode === 0) {
    return "granted";
  }
  return /not authorized|-1743/i.test(result.stderr) ? "denied" : "inconclusive";
}

// src/commands/install.ts
import {
  existsSync as existsSync4,
  readFileSync as readFileSync7
} from "node:fs";
import { join as join7 } from "node:path";

// src/detect.ts
import { existsSync as existsSync2 } from "node:fs";

// src/commands/paths.ts
import { accessSync, constants, readFileSync as readFileSync5 } from "node:fs";
import os2 from "node:os";
import { delimiter, dirname as dirname3, join as join5, resolve } from "node:path";
import { fileURLToPath } from "node:url";
function codexHome() {
  return process.env.CODEX_HOME ?? join5(os2.homedir(), ".codex");
}
function codexHooksPath() {
  return join5(codexHome(), "hooks.json");
}
function vendoredBundlePath() {
  return join5(home(), "bin", "awaitlingo.mjs");
}
function backupRoot() {
  return join5(home(), "backup");
}
function isAwaitlingoRoot(directory) {
  try {
    const parsed = JSON.parse(
      readFileSync5(join5(directory, "package.json"), "utf8")
    );
    return typeof parsed === "object" && parsed !== null && parsed.name === "awaitlingo";
  } catch {
    return false;
  }
}
function resolveRepoRoot(moduleUrl = import.meta.url) {
  let directory = dirname3(fileURLToPath(moduleUrl));
  for (let depth = 0; depth < 4; depth += 1) {
    if (isAwaitlingoRoot(directory)) {
      return directory;
    }
    const parent = dirname3(directory);
    if (parent === directory) {
      break;
    }
    directory = parent;
  }
  throw new Error(
    `Unable to resolve the awaitlingo repository root from ${fileURLToPath(moduleUrl)}`
  );
}
function findExecutable(name, pathValue = process.env.PATH) {
  if (name.includes("/")) {
    const candidate = resolve(name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      return null;
    }
  }
  for (const directory of (pathValue ?? "").split(delimiter)) {
    if (!directory) {
      continue;
    }
    const candidate = join5(directory, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
    }
  }
  return null;
}

// src/commands/process.ts
var runExternal = async (command, args) => {
  return execute(command, args, { timeoutMs: 1e4 });
};

// src/detect.ts
async function detectCli(name, enabled, runner, find) {
  if (!enabled) {
    return {
      found: false,
      path: null,
      version: null,
      versionSkipped: true
    };
  }
  const executable = find(name);
  if (!executable) {
    return {
      found: false,
      path: null,
      version: null,
      versionSkipped: false
    };
  }
  let result;
  try {
    result = await runner(executable, ["--version"]);
  } catch {
    result = {
      stdout: "",
      stderr: "",
      exitCode: 1,
      skipped: false
    };
  }
  const output = `${result.stdout}
${result.stderr}`.trim();
  return {
    found: true,
    path: executable,
    version: result.exitCode === 0 && output ? output.split(/\r?\n/, 1)[0] : null,
    versionSkipped: result.skipped
  };
}
async function detectEnvironment(options = {}) {
  const runner = options.runner ?? runExternal;
  const find = options.find ?? findExecutable;
  const conductorPath = options.conductorPath ?? "/Applications/Conductor.app";
  const [claude, codex] = await Promise.all([
    detectCli("claude", options.probeClaude !== false, runner, find),
    detectCli("codex", options.probeCodex !== false, runner, find)
  ]);
  return {
    claude,
    codex,
    conductor: {
      found: existsSync2(conductorPath),
      path: conductorPath
    }
  };
}
function describeCliDetection(label, detection, intentionallySkipped = false) {
  if (intentionallySkipped) {
    return `- ${label}: skipped by selection`;
  }
  if (!detection.found) {
    return `- ${label}: not found`;
  }
  if (detection.version) {
    return `- ${label}: ${detection.version} (${detection.path})`;
  }
  if (detection.versionSkipped) {
    return `- ${label}: found at ${detection.path} (version skipped in dry-run)`;
  }
  return `- ${label}: found at ${detection.path} (version unavailable)`;
}

// src/commands/codex-hooks.ts
import {
  copyFileSync,
  existsSync as existsSync3,
  mkdirSync as mkdirSync5,
  readFileSync as readFileSync6
} from "node:fs";
import { dirname as dirname4, join as join6 } from "node:path";
var CODEX_EVENTS = [
  "UserPromptSubmit",
  "Stop",
  "PermissionRequest",
  "SessionEnd"
];
function isRecord3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function readHooks(path) {
  try {
    const parsed = JSON.parse(readFileSync6(path, "utf8"));
    if (!isRecord3(parsed)) {
      throw new Error("hooks root must be an object");
    }
    return parsed;
  } catch (error) {
    if (error.code === "ENOENT") {
      return {};
    }
    throw new Error(`Cannot read Codex hooks at ${path}: ${String(error)}`);
  }
}
function looksLikeHookGroups(value) {
  return Array.isArray(value) && value.length > 0 && value.every((group) => isRecord3(group) && Array.isArray(group.hooks));
}
function shellArgument(value) {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}
function codexHookCommand(bundlePath = vendoredBundlePath()) {
  return `node ${shellArgument(bundlePath)} hook --harness codex`;
}
function isAwaitlingoCommand(command, bundlePath = vendoredBundlePath()) {
  if (typeof command !== "string") {
    return false;
  }
  const normalized = command.replaceAll("\\", "/");
  const normalizedBundle = bundlePath.replaceAll("\\", "/");
  return normalized.includes(normalizedBundle) || normalized.includes(".awaitlingo/bin/awaitlingo.mjs") || normalized.includes("awaitlingo.mjs") && normalized.includes("hook --harness codex");
}
function filterAwaitlingoHooks(groups, bundlePath) {
  if (!Array.isArray(groups)) {
    return { groups, found: false };
  }
  let found = false;
  const filteredGroups = [];
  for (const group of groups) {
    if (!isRecord3(group) || !Array.isArray(group.hooks)) {
      filteredGroups.push(group);
      continue;
    }
    const hooks = group.hooks.filter((hook) => {
      const ours = isRecord3(hook) && isAwaitlingoCommand(hook.command, bundlePath);
      found ||= ours;
      return !ours;
    });
    if (hooks.length > 0) {
      filteredGroups.push({ ...group, hooks });
    }
  }
  return { groups: filteredGroups, found };
}
function backupCodexHooks(sourcePath = codexHooksPath(), timestamp = /* @__PURE__ */ new Date()) {
  if (!existsSync3(sourcePath)) {
    return null;
  }
  const destination = join6(
    backupRoot(),
    timestamp.toISOString(),
    "hooks.json"
  );
  if (isDryRun()) {
    appendLog(`dryrun: would copy ${sourcePath} to ${destination}`);
    return destination;
  }
  mkdirSync5(dirname4(destination), { recursive: true });
  copyFileSync(sourcePath, destination);
  return destination;
}
function mergeCodexHooks(path = codexHooksPath(), bundlePath = vendoredBundlePath()) {
  const backupPath = backupCodexHooks(path);
  const root = readHooks(path);
  const container = isRecord3(root.hooks) ? root.hooks : {};
  for (const key of Object.keys(root)) {
    if (key === "hooks" || !looksLikeHookGroups(root[key])) {
      continue;
    }
    const existing = Array.isArray(container[key]) ? container[key] : [];
    container[key] = [...existing, ...root[key]];
    delete root[key];
  }
  const command = codexHookCommand(bundlePath);
  for (const event of CODEX_EVENTS) {
    const filtered = filterAwaitlingoHooks(container[event], bundlePath);
    const groups = Array.isArray(filtered.groups) ? filtered.groups : [];
    container[event] = [
      ...groups,
      {
        hooks: [
          {
            type: "command",
            command,
            timeout: 10
          }
        ]
      }
    ];
  }
  root.hooks = container;
  if (isDryRun()) {
    appendLog(`dryrun: would write Codex hooks ${path}`);
  } else {
    atomicWriteFile(path, `${JSON.stringify(root, null, 2)}
`);
  }
  return { path, backupPath, changed: true };
}
function removeCodexHooks(path = codexHooksPath(), bundlePath = vendoredBundlePath()) {
  if (!existsSync3(path)) {
    return { path, backupPath: null, changed: false };
  }
  const backupPath = backupCodexHooks(path);
  const root = readHooks(path);
  let changed = false;
  const scopes = [root];
  if (isRecord3(root.hooks)) {
    scopes.push(root.hooks);
  }
  for (const scope of scopes) {
    for (const event of Object.keys(scope)) {
      if (scope === root && event === "hooks") {
        continue;
      }
      const filtered = filterAwaitlingoHooks(scope[event], bundlePath);
      if (filtered.found) {
        scope[event] = filtered.groups;
        changed = true;
      }
    }
  }
  if (changed) {
    if (isDryRun()) {
      appendLog(`dryrun: would write Codex hooks ${path}`);
    } else {
      atomicWriteFile(path, `${JSON.stringify(root, null, 2)}
`);
    }
  }
  return { path, backupPath, changed };
}
function inspectCodexHooks(path = codexHooksPath(), bundlePath = vendoredBundlePath()) {
  if (!existsSync3(path)) {
    return { present: false, events: [] };
  }
  try {
    const root = readHooks(path);
    const legacyLayout = CODEX_EVENTS.some(
      (event) => looksLikeHookGroups(root[event])
    );
    const hooks = isRecord3(root.hooks) ? root.hooks : {};
    const events = CODEX_EVENTS.filter((event) => {
      const groups = hooks[event];
      return Array.isArray(groups) && groups.some(
        (group) => isRecord3(group) && Array.isArray(group.hooks) && group.hooks.some(
          (hook) => isRecord3(hook) && hook.type === "command" && hook.command === codexHookCommand(bundlePath) && hook.timeout === 10 && !Object.hasOwn(hook, "async")
        )
      );
    });
    const present = events.length === CODEX_EVENTS.length;
    if (!present && legacyLayout) {
      return {
        present,
        events,
        error: "legacy unwrapped hooks layout detected (Codex ignores it); run `awaitlingo install` to repair"
      };
    }
    return { present, events };
  } catch (error) {
    return { present: false, events: [], error: String(error) };
  }
}

// src/commands/io.ts
import { createInterface } from "node:readline/promises";
var consoleIO = {
  stdout(message) {
    console.log(message);
  },
  stderr(message) {
    console.error(message);
  },
  async confirm(question, defaultYes) {
    const readline = createInterface({
      input: process.stdin,
      output: process.stdout
    });
    try {
      const answer = (await readline.question(question)).trim().toLowerCase();
      if (!answer) {
        return defaultYes;
      }
      return answer === "y" || answer === "yes";
    } finally {
      readline.close();
    }
  }
};

// src/commands/install.ts
function idempotentClaudeSuccess(result) {
  if (result.exitCode === 0) {
    return true;
  }
  return /already\s+(?:exists|added|installed)|already.*(?:marketplace|plugin)/i.test(
    `${result.stdout}
${result.stderr}`
  );
}
async function installClaude(executable, repoRoot, runner, io) {
  const marketplace = await runner(executable, [
    "plugin",
    "marketplace",
    "add",
    repoRoot
  ]);
  if (!idempotentClaudeSuccess(marketplace)) {
    io.stderr(
      `\u2717 Claude marketplace add failed: ${marketplace.stderr.trim() || `exit ${marketplace.exitCode}`}`
    );
    return false;
  }
  const plugin = await runner(executable, [
    "plugin",
    "install",
    "awaitlingo@awaitlingo"
  ]);
  if (!idempotentClaudeSuccess(plugin)) {
    io.stderr(
      `\u2717 Claude plugin install failed: ${plugin.stderr.trim() || `exit ${plugin.exitCode}`}`
    );
    return false;
  }
  io.stdout(
    marketplace.skipped || plugin.skipped ? "\u2713 Claude Code wiring planned (dry-run)" : "\u2713 Claude Code plugin installed"
  );
  return true;
}
function vendorBundle(repoRoot, destination = vendoredBundlePath()) {
  const source = join7(repoRoot, "dist", "awaitlingo.mjs");
  if (isDryRun()) {
    appendLog(`dryrun: would copy ${source} to ${destination}`);
    return;
  }
  if (!existsSync4(source)) {
    throw new Error(
      `Built bundle not found at ${source}; run npm run build before installing`
    );
  }
  atomicWriteFile(destination, readFileSync7(source), 493);
}
function ensureDefaultConfig() {
  if (!existsSync4(configPath())) {
    return saveConfig(DEFAULT_CONFIG) ? "written" : "planned";
  }
  return "existing";
}
async function runInstall(options) {
  if (options.claudeOnly && options.codexOnly) {
    throw new Error("--claude-only and --codex-only cannot be used together");
  }
  const io = options.io ?? consoleIO;
  const runner = options.runner ?? runExternal;
  const detection = options.detection ?? await detectEnvironment({
    probeClaude: !options.codexOnly,
    probeCodex: !options.claudeOnly,
    runner
  });
  io.stdout("Detected integrations:");
  io.stdout(
    describeCliDetection(
      "Claude Code",
      detection.claude,
      options.codexOnly
    )
  );
  io.stdout(
    describeCliDetection("Codex CLI", detection.codex, options.claudeOnly)
  );
  io.stdout(
    detection.conductor.found ? `- Conductor: found at ${detection.conductor.path}` : `- Conductor: not found at ${detection.conductor.path}`
  );
  const repoRoot = options.repoRoot ?? resolveRepoRoot();
  let succeeded = true;
  if (!options.codexOnly && detection.claude.found && detection.claude.path) {
    const confirmed = options.yes || await io.confirm("Wire up Claude Code? [Y/n] ", true);
    if (confirmed) {
      succeeded = await installClaude(
        detection.claude.path,
        repoRoot,
        runner,
        io
      ) && succeeded;
    } else {
      io.stdout("- Claude Code skipped");
    }
  }
  if (!options.claudeOnly && detection.codex.found) {
    const confirmed = options.yes || await io.confirm("Wire up Codex CLI? [Y/n] ", true);
    if (confirmed) {
      try {
        const destination = vendoredBundlePath();
        vendorBundle(repoRoot, destination);
        const mutation = mergeCodexHooks(void 0, destination);
        io.stdout(
          isDryRun() ? `\u2713 (dry-run) would write Codex hooks to ${mutation.path} and copy the bundle to ${destination}` : `\u2713 Codex hooks installed at ${mutation.path}`
        );
      } catch (error) {
        io.stderr(`\u2717 Codex install failed: ${String(error)}`);
        succeeded = false;
      }
    } else {
      io.stdout("- Codex CLI skipped");
    }
  }
  const configResult = ensureDefaultConfig();
  io.stdout(
    configResult === "planned" ? `\u2713 (dry-run) would write default config to ${configPath()}` : `\u2713 Config ready at ${configPath()}`
  );
  io.stdout("");
  io.stdout("Next steps:");
  if (!options.claudeOnly) {
    io.stdout(
      "\u26A0 Open Codex and run /hooks once to review and trust the installed hooks."
    );
  }
  io.stdout(
    "\u26A0 macOS may show a one-time \u201Cwants to control Google Chrome\u201D Automation dialog; approve it for browser switching."
  );
  io.stdout("Run `awaitlingo status` to verify the installation.");
  return succeeded;
}

// src/commands/uninstall.ts
import { rmSync as rmSync3 } from "node:fs";
import os3 from "node:os";
import { resolve as resolve2 } from "node:path";
function processFailure(label, result, io) {
  if (result.exitCode === 0) {
    io.stdout(
      result.skipped ? `\u2713 ${label} planned (dry-run)` : `\u2713 ${label}`
    );
  } else {
    io.stderr(
      `\u26A0 ${label} failed; continuing: ${result.stderr.trim() || `exit ${result.exitCode}`}`
    );
  }
}
function purgeHome(target) {
  const resolved = resolve2(target);
  if (resolved === "/" || resolved === resolve2(os3.homedir())) {
    throw new Error(`Refusing to purge unsafe awaitlingo home: ${resolved}`);
  }
  if (isDryRun()) {
    appendLog(`dryrun: remove ${resolved}`);
    return;
  }
  rmSync3(resolved, { recursive: true, force: true });
}
async function runUninstall(options) {
  const io = options.io ?? consoleIO;
  const runner = options.runner ?? runExternal;
  const detection = await detectEnvironment({
    probeCodex: false,
    runner
  });
  if (detection.claude.found && detection.claude.path) {
    const plugin = await runner(detection.claude.path, [
      "plugin",
      "uninstall",
      "awaitlingo"
    ]);
    processFailure("Claude plugin uninstall", plugin, io);
    const marketplace = await runner(detection.claude.path, [
      "plugin",
      "marketplace",
      "remove",
      "awaitlingo"
    ]);
    processFailure("Claude marketplace removal", marketplace, io);
  } else {
    io.stdout("- Claude CLI not found; plugin removal skipped");
  }
  try {
    const mutation = removeCodexHooks();
    if (mutation.changed) {
      io.stdout(
        isDryRun() ? `\u2713 (dry-run) would write ${mutation.path} without awaitlingo entries` : `\u2713 Removed awaitlingo entries from ${mutation.path}`
      );
    } else {
      io.stdout(`- No awaitlingo Codex hooks found at ${mutation.path}`);
    }
    if (mutation.backupPath) {
      io.stdout(
        isDryRun() ? `\u2713 (dry-run) would write a Codex hooks backup to ${mutation.backupPath}` : `\u2713 Backed up Codex hooks to ${mutation.backupPath}`
      );
    }
  } catch (error) {
    io.stderr(`\u26A0 Codex hook removal failed; continuing: ${String(error)}`);
  }
  if (options.purge) {
    const confirmed = options.yes || await io.confirm(
      `Delete all awaitlingo config and state at ${home()}? [y/N] `,
      false
    );
    if (confirmed) {
      purgeHome(home());
      io.stdout(
        isDryRun() ? `\u2713 Purge planned for ${home()} (dry-run)` : `\u2713 Deleted ${home()}`
      );
    } else {
      io.stdout("- Config and state retained");
    }
  } else {
    io.stdout(`- Config and state retained at ${home()}`);
  }
}

// src/commands/status.ts
import { existsSync as existsSync5 } from "node:fs";

// src/commands/version.ts
var VERSION = "0.1.0";

// src/commands/status.ts
function formatAge(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1e3));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  return `${Math.floor(hours / 24)}d`;
}
async function reportClaude(executable, runner, io) {
  if (!executable) {
    io.stdout("\u2717 Claude: CLI not found; plugin status unavailable");
    return;
  }
  const result = await runner(executable, ["plugin", "list"]);
  if (result.skipped) {
    io.stdout("\u26A0 Claude: CLI found; plugin check skipped (dry-run)");
  } else if (result.exitCode !== 0) {
    io.stdout("\u26A0 Claude: CLI found; `claude plugin list` failed");
  } else if (/awaitlingo/i.test(`${result.stdout}
${result.stderr}`)) {
    io.stdout("\u2713 Claude: CLI found; awaitlingo plugin installed");
  } else {
    io.stdout("\u2717 Claude: CLI found; awaitlingo plugin not installed");
  }
}
async function reportCodex(executable, runner, io) {
  const cli = executable ? "\u2713 CLI found" : "\u2717 CLI not found";
  const inspection = inspectCodexHooks();
  const hooks = inspection.present ? `\u2713 all four hooks present in ${codexHooksPath()}` : inspection.error ? `\u2717 hooks unreadable: ${inspection.error}` : `\u2717 hooks incomplete (${inspection.events.length}/4) in ${codexHooksPath()}`;
  const bundlePath = vendoredBundlePath();
  const bundleExists = existsSync5(bundlePath);
  const bundle = bundleExists ? `\u2713 bundle present at ${bundlePath}` : `\u2717 bundle missing at ${bundlePath}`;
  io.stdout(`Codex: ${cli}; ${hooks}; ${bundle}`);
  if (bundleExists) {
    const result = await runner(process.execPath, [bundlePath, "version"]);
    if (result.skipped) {
      io.stdout(
        `\u26A0 Codex bundle version: comparison with CLI ${VERSION} skipped (dry-run)`
      );
    } else if (result.exitCode !== 0) {
      io.stdout("\u26A0 Codex bundle version: unable to read vendored version");
    } else {
      const vendoredVersion = result.stdout.trim().split(/\r?\n/, 1)[0];
      if (vendoredVersion === VERSION) {
        io.stdout(`\u2713 Codex bundle version matches CLI ${VERSION}`);
      } else {
        io.stdout(
          `\u26A0 Codex bundle version skew: installed ${vendoredVersion || "unknown"}, CLI ${VERSION}`
        );
      }
    }
  }
  io.stdout(
    "\u26A0 Codex hook trust cannot be verified externally; open Codex and run /hooks once."
  );
}
async function reportAutomationProbe(io) {
  if (process.platform !== "darwin") {
    io.stdout("Automation probe: not applicable (macOS only)");
    return;
  }
  const result = await probeAutomation();
  switch (result) {
    case "granted":
      io.stdout("\u2713 Automation probe: granted");
      break;
    case "denied":
      io.stdout("\u2717 Automation probe: denied");
      break;
    case "skipped":
      io.stdout("\u26A0 Automation probe: skipped (dry-run)");
      break;
    case "inconclusive":
      io.stdout("\u26A0 Automation probe: inconclusive");
      break;
    case "not-applicable":
      io.stdout("Automation probe: not applicable (macOS only)");
      break;
  }
}
async function runStatus(options = {}) {
  const io = options.io ?? consoleIO;
  const runner = options.runner ?? runExternal;
  const now = options.now ?? Date.now();
  try {
    const detection = await detectEnvironment({ runner });
    await reportClaude(detection.claude.path, runner, io);
    await reportCodex(detection.codex.path, runner, io);
    io.stdout(
      detection.conductor.found ? `\u2713 Conductor: app found; ${underConductor() ? "running inside a Conductor workspace" : "current environment is outside a Conductor workspace"}` : `\u2717 Conductor: app not found; ${underConductor() ? "CONDUCTOR_* environment detected" : "no CONDUCTOR_* environment detected"}`
    );
    const config = loadConfig();
    io.stdout(`Config: ${configPath()}`);
    io.stdout(`  url=${config.url}`);
    io.stdout(`  delaySeconds=${config.delaySeconds}`);
    io.stdout(`  browser=${config.browser}`);
    io.stdout(
      `  pullBack.enabled=${config.pullBack.enabled}, multiSession=${config.pullBack.multiSession}, notification=${config.pullBack.notification}, sound=${config.pullBack.sound}`
    );
    io.stdout(
      `  conductor.suppressAlerts=${config.conductor.suppressAlerts}`
    );
    const sessions = listSessions();
    if (sessions.length === 0) {
      io.stdout("\u2713 State: no live sessions");
    } else {
      io.stdout(`State: ${sessions.length} live session(s)`);
      for (const id of sessions) {
        const meta = readMeta(id);
        if (!meta) {
          io.stdout(`  \u26A0 ${id}: metadata unavailable`);
          continue;
        }
        const state = meta.busySince === null ? "idle" : "busy";
        io.stdout(
          `  ${id}: ${state}, ${meta.harness}, age ${formatAge(now - meta.updatedAt)}`
        );
      }
    }
    const away = readAway(now);
    if (away) {
      io.stdout(
        `\u26A0 Away marker: owner ${away.owner}, age ${formatAge(now - away.since)}`
      );
    } else {
      io.stdout("\u2713 Away marker: none");
    }
    await reportAutomationProbe(io);
  } catch (error) {
    io.stdout(`\u26A0 Status report incomplete: ${String(error)}`);
  }
}

// src/commands/config.ts
function isRecord4(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function leafPaths(value, prefix = "") {
  if (!isRecord4(value)) {
    return [prefix];
  }
  return Object.entries(value).flatMap(
    ([key, child]) => leafPaths(child, prefix ? `${prefix}.${key}` : key)
  );
}
var VALID_CONFIG_KEYS = leafPaths(DEFAULT_CONFIG).sort();
function assertValidPath(path) {
  if (!VALID_CONFIG_KEYS.includes(path)) {
    throw new Error(
      `Unknown config path "${path}". Valid keys: ${VALID_CONFIG_KEYS.join(", ")}`
    );
  }
}
function getPath(root, path) {
  let current = root;
  for (const part of path.split(".")) {
    if (!isRecord4(current)) {
      return void 0;
    }
    current = current[part];
  }
  return current;
}
function setPath(root, path, value) {
  const parts = path.split(".");
  let current = root;
  for (const part of parts.slice(0, -1)) {
    const child = current[part];
    if (!isRecord4(child)) {
      throw new Error(`Cannot set config path "${path}"`);
    }
    current = child;
  }
  const leaf = parts.at(-1);
  if (!leaf) {
    throw new Error(`Cannot set config path "${path}"`);
  }
  current[leaf] = value;
}
function coerceConfigValue(value) {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (value.trim() !== "" && /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(value)) {
    const number = Number(value);
    if (Number.isFinite(number)) {
      return number;
    }
  }
  return value;
}
function formatValue(value) {
  return typeof value === "string" ? value : JSON.stringify(value);
}
function configGet(path) {
  assertValidPath(path);
  return getPath(loadConfig(), path);
}
function configSet(path, rawValue) {
  assertValidPath(path);
  const value = coerceConfigValue(rawValue);
  const expected = validateConfigValue(path, value);
  if (expected !== null) {
    throw new Error(
      `Invalid value for "${path}": expected ${expected}, got ${formatValue(value)}`
    );
  }
  const config = structuredClone(loadConfig());
  setPath(config, path, value);
  saveConfig(config);
  return value;
}
function configEntries() {
  const config = loadConfig();
  return VALID_CONFIG_KEYS.map((path) => [path, getPath(config, path)]);
}
function runConfig(args, io = consoleIO) {
  const [action, path, value, ...extra] = args;
  if (action === "get" && path && value === void 0) {
    io.stdout(formatValue(configGet(path)));
    return;
  }
  if (action === "set" && path && value !== void 0 && extra.length === 0) {
    io.stdout(`${path}=${formatValue(configSet(path, value))}`);
    return;
  }
  if (action === "list" && path === void 0) {
    for (const [key, entry] of configEntries()) {
      io.stdout(`${key}=${formatValue(entry)}`);
    }
    return;
  }
  throw new Error(
    "Usage: awaitlingo config <get <dot.path>|set <dot.path> <value>|list>"
  );
}

// src/cli.ts
async function readStdin() {
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    input += chunk;
  }
  return input;
}
async function runHook(harnessValue) {
  try {
    if (harnessValue !== "claude" && harnessValue !== "codex") {
      throw new Error("hook requires --harness claude|codex");
    }
    const harness = harnessValue;
    let payload;
    try {
      payload = JSON.parse(await readStdin());
    } catch (error) {
      appendLog(`hook: ignored malformed JSON: ${String(error)}`);
      return;
    }
    const event = normalize(harness, payload);
    if (!event || event.kind === "ignored") {
      return;
    }
    switch (event.kind) {
      case "prompt-submit":
        onPromptSubmit(event, loadConfig());
        break;
      case "stop":
        await onStop(event, loadConfig(), getPlatform());
        break;
      case "needs-input":
        await onNeedsInput(event, loadConfig(), getPlatform());
        break;
      case "session-end":
        onSessionEnd(event);
        break;
    }
  } catch (error) {
    appendLog(`hook: ${String(error)}`);
  }
}
async function runTimer(sessionId, nonce, delayValue) {
  if (!sessionId || !nonce || delayValue === void 0) {
    throw new Error("timer requires --session, --nonce, and --delay");
  }
  const delaySeconds = Number(delayValue);
  if (!Number.isFinite(delaySeconds) || delaySeconds < 0) {
    throw new Error("timer delay must be a non-negative number");
  }
  await new Promise((resolve3) => {
    setTimeout(resolve3, delaySeconds * 1e3);
  });
  await onTimerFire(sessionId, nonce, loadConfig(), getPlatform());
}
async function main() {
  const rawCommand = process.argv[2];
  if (rawCommand === "hook" && (process.env.AWAITLINGO_DISABLE === "1" || process.env.AWAITLINGO_DISABLE === "true")) {
    return;
  }
  try {
    const { positionals, values } = parseArgs({
      args: process.argv.slice(2),
      allowPositionals: true,
      strict: true,
      options: {
        harness: { type: "string" },
        session: { type: "string" },
        nonce: { type: "string" },
        delay: { type: "string" },
        yes: { type: "boolean", default: false },
        "claude-only": { type: "boolean", default: false },
        "codex-only": { type: "boolean", default: false },
        purge: { type: "boolean", default: false }
      }
    });
    const command = positionals[0];
    if (command === "hook") {
      await runHook(values.harness);
      return;
    }
    if (command === "timer") {
      await runTimer(values.session, values.nonce, values.delay);
      return;
    }
    if (command === "version") {
      console.log(VERSION);
      return;
    }
    if (command === "install") {
      const succeeded = await runInstall({
        yes: values.yes,
        claudeOnly: values["claude-only"],
        codexOnly: values["codex-only"]
      });
      if (!succeeded) {
        process.exitCode = 1;
      }
      return;
    }
    if (command === "uninstall") {
      await runUninstall({
        purge: values.purge,
        yes: values.yes
      });
      return;
    }
    if (command === "status") {
      await runStatus();
      process.exitCode = 0;
      return;
    }
    if (command === "config") {
      runConfig(positionals.slice(1));
      return;
    }
    console.error("Usage: awaitlingo <hook|timer|version|install|uninstall|status|config>");
    process.exitCode = 1;
  } catch (error) {
    appendLog(`${rawCommand ?? "cli"}: ${String(error)}`);
    if (rawCommand === "hook") {
      process.exitCode = 0;
      return;
    }
    console.error(`awaitlingo: ${String(error)}`);
    process.exitCode = 1;
  }
}
await main();
