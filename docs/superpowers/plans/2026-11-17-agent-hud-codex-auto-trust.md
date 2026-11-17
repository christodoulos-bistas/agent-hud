# Agent HUD — Codex Hooks Trusted at Install — Implementation Plan

```
╔═════════════╦══════════════════════════════════════════════╦═════════════╗
║ MARVEL      ║                                              ║  APPROVED   ║
║ COMICS      ║     A M A Z I N G   S P I D E R - M A N      ║   BY THE    ║
║ GROUP       ║                  #229 – 230                  ║ COMICS CODE ║
║ 60¢ · 1982  ║                                              ║  AUTHORITY  ║
╠═════════════╩══════════════════════════════════════════════╩═════════════╣
║                                                                          ║
║                    " N O T H I N G   C A N   S T O P                     ║
║                      T H E   J U G G E R N A U T "                       ║
║                                                                          ║
║                     ROGER STERN  ◆  1982  ◆  TIER 3                      ║
║                      multi-module, needs sequencing                      ║
╟──────────────────────────────────────────────────────────────────────────╢
║  WHY THIS ISSUE                                                          ║
║  A two-parter against one stubborn blocker - Codex's hook trust gate:    ║
║  part one has Codex vouch for the HUD's own hooks, part two is the       ║
║  guided way through when Codex can't be reached.                         ║
╟──────────────────────────────────────────────────────────────────────────╢
║  ROGUES GALLERY                                                          ║
║  ◆ GREEN GOBLIN    trusting a hook that is not the HUD's own             ║
║  ◆ CHAMELEON       another hook dressed in the HUD's command, or the     ║
║                    wrong codex.exe answering                             ║
║  ◆ SANDMAN         config.toml written by the running Codex app at the   ║
║                    same moment                                           ║
║  ◆ SCORPION        the running app ignores the new trust until a new     ║
║                    chat or a restart                                     ║
║  ◆ VENOM           hooks/list and config/batchWrite are undocumented     ║
║                    app-server methods we now lean on                     ║
║  ◆ ELECTRO         app-server slow to start, or hanging                  ║
╚══════════════════════════════════════════════════════════════════════════╝
```

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After the user says yes in the HUD's Codex install dialog, the HUD gets Codex to trust the HUD's own hooks, so nothing is left to approve in Codex; when that can't be done, the HUD points at the right Codex screen.

**Architecture:** A new `src/main/codex-trust.js` holds pure helpers (pick our untrusted hooks from `hooks/list`, build `config/batchWrite` edits, summarise), a small JSON-RPC client that runs `codex.exe app-server` once, and a locator for `codex.exe`. `main.js` calls it after a Codex install, at startup and from a tray item; `wiring.js` gets the new copy and a due-check.

**Tech Stack:** Node ESM, Electron 44 main process, `node --test`, `child_process.spawn`.

**Spec:** `docs/superpowers/specs/2026-11-17-agent-hud-codex-auto-trust-design.md`

## Global Constraints

- Trust only hooks with `source === 'user'`, `isManaged === false`, `sourcePath` equal to `CODEX_PATH` (case-insensitive, `path.win32.normalize`), `command === CODEX_COMMAND`. Never any other hook.
- Never trust without consent: `cfg.codexAutoTrust === true`, set by the install dialog's yes or the tray item's click.
- Never write `config.toml` text and never compute a hash: the hash is `currentHash` from `hooks/list`; the write is `config/batchWrite`.
- `config/batchWrite` params exactly: `{ edits, filePath: null, expectedVersion: null, reloadUserConfig: true }`; each edit `{ keyPath: 'hooks.state.' + JSON.stringify(key) + '.trusted_hash', value: currentHash, mergeStrategy: 'upsert' }`.
- `hooks/list` params: `{ cwds: [os.homedir()] }`.
- The whole trust step times out at **15 000 ms**; the child is always killed.
- Dev builds (`CODEX.blocked`) never run it. Tests never start the real Codex or touch real user files.
- Copy (exact):
  - dialog sentence: `Agent HUD will also mark its own hooks as trusted in Codex, so you won't need to approve them there.`
  - success title: `Agent HUD Codex hooks installed and trusted` (startup re-trust: `Agent HUD re-trusted its Codex hooks`)
  - fallback title: `Agent HUD Codex hooks need approval`
  - fallback balloon (`CODEX_APPROVE_BALLOON`): `Codex: open Settings → Hooks and click Trust on the Agent HUD hooks (in the Codex terminal: /hooks).`
  - tray label: `Codex hooks: approve in Codex Settings → Hooks`
  - tray item: `Trust Agent HUD hooks in Codex`
  - remove notice suffix: `(Codex Settings → Hooks)` in place of `(/hooks)`
  - Claude install notification (`doInstall`, changed case): body gains a last line `Chats you already have open start reporting after a restart.`
- Work on a branch `codex-auto-trust`, not `main`.

## Review Focus

1. **`~/.codex` exists but the Codex app isn't installed** (CLI-only user, or app removed): the locator returns `null`, the fallback balloon shows once, nothing throws. → Task 3 `nothing found -> null`; Task 2 `exe null -> not-found`.
2. **app-server prints non-JSON lines or never answers**: non-JSON lines are skipped; a silent server ends in `{ ok: false, error: 'timeout' }` with the child killed. → Task 2 `skips non-JSON lines`, `hang -> timeout, child killed`.
3. **A hook that looks like ours but isn't** (same command in a project-layer file, or a plugin hook): not trusted. Same file with different drive-letter case: trusted. → Task 1 `pickOurUntrusted: only our user-layer hooks`.
4. **Everything already trusted**: no `config/batchWrite` call at all. → Task 2 `all trusted -> no batchWrite`.
5. **Trust keeps failing**: the startup re-trust runs once per HUD start, not on the 30 s menu refresh, and shows one balloon. → Task 4 `codexTrustDue` cases; Task 6 Step 3.

---

### Task 0: Spike — the open questions (throwaway)

**Files:**
- Modify: `spikes/SPIKES.md` (append "Spike 10: Codex trust via app-server")
- Create (throwaway): `spikes/codex/trust-probe.mjs`

- [ ] **Step 1: Branch.** `git switch -c codex-auto-trust`
- [ ] **Step 2: Probe script.** `node spikes/codex/trust-probe.mjs <codex.exe> list|trust <key>`: spawns `<codex.exe> app-server`, sends `initialize` `{ clientInfo: { name: 'agent-hud', version: '0.1.0' } }`, notifies `initialized`, then `hooks/list` (print key / trustStatus / currentHash) or, for `trust`, one `config/batchWrite` edit per Global Constraints followed by `hooks/list`.
- [ ] **Step 3: Live test — ask the user first; they click in Codex.** Back up `~/.codex/config.toml`; delete only the HUD's `stop:2:0` `hooks.state` block; `list` shows it untrusted; `trust` it; `list` shows `trusted`. Then, **without restarting the Codex app**, start a new Codex chat, send a message, and check the HUD got its `Stop`. If not, restart Codex and check again.
- [ ] **Step 4: Side effects.** List the newest files in `~/.codex/sessions` and `~/.codex/log` before and after the probe; note anything it created.
- [ ] **Step 5: Alias.** In node: `fs.readlinkSync(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'chatgpt-desktop.exe'))` — record whether it returns `…\app\ChatGPT.exe` or throws.
- [ ] **Step 6: Record.** Append the answers to `spikes/SPIKES.md` and to the spec's "Open" section. Wording decided here: if Step 3 needed a restart, the success body is `Restart Codex to use them.`, else `Start a new Codex chat to use them.`
- [ ] **Step 7: Commit.** `git add spikes/SPIKES.md docs/superpowers/specs/2026-11-17-agent-hud-codex-auto-trust-design.md && git commit -m "spike: Codex hook trust via app-server"`

### Task 1: Pure helpers

**Files:**
- Create: `src/main/codex-trust.js`
- Test: `test/codex-trust.test.js`

**Interfaces:**
- Produces:
  - `isOurs(hook, { hooksPath, command }) -> boolean` — the Global Constraints filter, ignoring trust status.
  - `pickOurUntrusted(listResult, { hooksPath, command }) -> Array<{ key: string, hash: string, event: string }>` — `listResult` is the `hooks/list` result `{ data: [{ cwd, hooks: [...] }] }`; dedupes by `key` across `data` entries; `event` is the hook's `eventName`; any `trustStatus` other than `'trusted'` counts as untrusted.
  - `trustEdits(picked) -> Array<{ keyPath: string, value: string, mergeStrategy: 'upsert' }>`
  - `trustSummary(listResult, { hooksPath, command }) -> { ours: number, trusted: string[], untrusted: string[] }` (event names as Codex reports them, deduped by key).

- [ ] **Step 1: Write the failing tests**

```js
const HP = 'C:\\Users\\u\\.codex\\hooks.json';
const CMD = '"C:\\Users\\u\\AppData\\Local\\Programs\\Agent HUD\\resources\\codex-hook.cmd"';
const OPTS = { hooksPath: HP, command: CMD };
const hook = (o) => ({ key: `${HP}:stop:2:0`, eventName: 'stop', command: CMD, sourcePath: HP, source: 'user', isManaged: false, currentHash: 'sha256:aa', trustStatus: 'untrusted', ...o });

test('pickOurUntrusted: only our user-layer hooks', () => {
  const list = { data: [{ cwd: 'C:\\Users\\u', hooks: [
    hook({}),
    hook({ key: `${HP}:stop:0:0`, command: 'node other.js' }),
    hook({ key: 'C:\\p\\.codex\\hooks.json:stop:0:0', sourcePath: 'C:\\p\\.codex\\hooks.json', source: 'project' }),
    hook({ key: 'x@m:hooks.json:stop:0:0', source: 'plugin' }),
    hook({ key: `${HP}:session_end:1:0`, eventName: 'sessionEnd', sourcePath: 'c:\\users\\u\\.codex\\hooks.json' }),
    hook({ key: `${HP}:pre_tool_use:1:0`, eventName: 'preToolUse', trustStatus: 'trusted' }),
    hook({ key: `${HP}:interrupt:0:0`, isManaged: true }),
  ] }] };
  assert.deepEqual(pickOurUntrusted(list, OPTS).map((h) => h.key), [`${HP}:stop:2:0`, `${HP}:session_end:1:0`]);
});
test('pickOurUntrusted: same hook under two cwds counts once', () => {
  assert.equal(pickOurUntrusted({ data: [{ hooks: [hook({})] }, { hooks: [hook({})] }] }, OPTS).length, 1);
});
test('pickOurUntrusted: malformed result -> []', () => {
  for (const r of [null, {}, { data: null }, { data: [{ hooks: null }] }]) assert.deepEqual(pickOurUntrusted(r, OPTS), []);
});
test('trustEdits: one quoted-key upsert per hook', () => {
  assert.deepEqual(trustEdits([{ key: `${HP}:stop:2:0`, hash: 'sha256:aa', event: 'stop' }]),
    [{ keyPath: `hooks.state.${JSON.stringify(`${HP}:stop:2:0`)}.trusted_hash`, value: 'sha256:aa', mergeStrategy: 'upsert' }]);
});
test('trustSummary: counts ours, splits by trust', () => {
  const list = { data: [{ hooks: [hook({}), hook({ key: `${HP}:pre_tool_use:1:0`, eventName: 'preToolUse', trustStatus: 'trusted' }), hook({ key: 'k', command: 'x' })] }] };
  assert.deepEqual(trustSummary(list, OPTS), { ours: 2, trusted: ['preToolUse'], untrusted: ['stop'] });
});
```

- [ ] **Step 2: Run to verify failure.** `node --test test/codex-trust.test.js` → FAIL (module not found).
- [ ] **Step 3: Implement** the four exports. Path compare: `path.win32.normalize(a).toLowerCase() === path.win32.normalize(b).toLowerCase()`.
- [ ] **Step 4: Run.** `node --test test/codex-trust.test.js` → PASS.
- [ ] **Step 5: Commit.** `git add src/main/codex-trust.js test/codex-trust.test.js && git commit -m "feat: pick and trust-edit the HUD's own Codex hooks"`

### Task 2: Run the trust step against an app-server

**Files:**
- Modify: `src/main/codex-trust.js`
- Create: `test/fixtures/fake-codex-app-server.mjs`
- Test: `test/codex-trust.test.js`

**Interfaces:**
- Consumes: Task 1 exports.
- Produces: `trustCodexHooks({ exe, hooksPath, command, cwd, timeoutMs = 15000, spawnFn = spawn, env = process.env }) -> Promise<{ ok: boolean, trusted: string[], already: string[], untrusted: string[], error?: 'not-found' | 'timeout' | 'exit' | 'rpc' }>`. `exe` is `{ file: string, args: string[] } | null`; `'app-server'` is appended to `args`. Never rejects. `trusted` = events newly trusted by this call; `already` = ours trusted before it; `untrusted` = ours still untrusted after.

The fake (`node fake-codex-app-server.mjs app-server`) speaks newline-delimited JSON-RPC: answers `initialize` with `{ userAgent: 'fake' }`; ignores notifications; answers `hooks/list` with `{ data: [{ cwd, hooks }] }` from the JSON file named by `FAKE_CODEX_STATE` (`{ hooks: [...] }`); on `config/batchWrite` marks each edited key `trusted` in that file and appends the params as one line to `<FAKE_CODEX_STATE>.writes.jsonl`. `FAKE_CODEX_MODE`: `normal` (default) | `hang` (never answers) | `noise` (prints `booting…` before every reply) | `error` (answers `config/batchWrite` with `{ error: { code: -1, message: 'nope' } }`) | `exit` (exits 3 after answering `initialize`).

- [ ] **Step 1: Write the failing tests.** Each uses a state file in `fs.mkdtempSync(path.join(os.tmpdir(), 'hud-trust-'))`, `exe = { file: process.execPath, args: [FIXTURE] }`, and passes `env: { ...process.env, FAKE_CODEX_STATE, FAKE_CODEX_MODE }`.
  - `trust: untrusted ours -> one batchWrite, now trusted` — state: our Stop (untrusted), our PreToolUse (trusted), another tool's untrusted hook. Expect `{ ok: true, trusted: ['stop'], already: ['preToolUse'], untrusted: [] }`; the writes file has exactly one line, with `filePath: null`, `expectedVersion: null`, `reloadUserConfig: true` and one edit, for the Stop key; the other tool's hook is still untrusted in the state file.
  - `all trusted -> no batchWrite` — the writes file does not exist; `ok: true`, `trusted: []`.
  - `skips non-JSON lines` — mode `noise`; same result as the first test.
  - `hang -> timeout, child killed` — mode `hang`, `timeoutMs: 500`: resolves `{ ok: false, error: 'timeout' }` within 2000 ms, and the child captured through a `spawnFn` wrapper has `exitCode !== null || signalCode !== null` shortly after.
  - `batchWrite error -> rpc` — mode `error`: `{ ok: false, error: 'rpc', untrusted: ['stop'] }`.
  - `server exits -> exit` — mode `exit`: `{ ok: false, error: 'exit' }`.
  - `exe null -> not-found` — `{ ok: false, error: 'not-found', trusted: [], already: [], untrusted: [] }`; `spawnFn` never called.
- [ ] **Step 2: Run to verify failure.** `node --test test/codex-trust.test.js` → the new tests FAIL.
- [ ] **Step 3: Implement** `trustCodexHooks` and the fake. Spawn with `windowsHide: true`, `stdio: ['pipe', 'pipe', 'ignore']`, `env`. Sequence: `initialize` → notify `initialized` → `hooks/list` → stop here if `pickOurUntrusted` is empty → `config/batchWrite(trustEdits(...))` → `hooks/list` → `trustSummary` → kill. Requests use increasing integer ids; replies are matched by id; lines that don't parse or match no id are ignored. One timer covers the whole call.
- [ ] **Step 4: Run.** `node --test test/codex-trust.test.js` → PASS.
- [ ] **Step 5: Commit.** `git add src/main/codex-trust.js test/codex-trust.test.js test/fixtures/fake-codex-app-server.mjs && git commit -m "feat: trust the HUD's Codex hooks through codex app-server"`

### Task 3: Find codex.exe

**Files:**
- Modify: `src/main/codex-trust.js`
- Test: `test/codex-trust.test.js`

**Interfaces:**
- Produces: `findCodexExe({ env = process.env, readlink = fs.readlinkSync, exists = fs.existsSync, runPs }) -> Promise<{ file: string, args: [] } | null>`. `runPs(script) -> Promise<string>` defaults to `execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])` stdout, trimmed; errors resolve `''`.

Order:
1. `env.AGENT_HUD_CODEX_EXE` set → it is the **only** candidate: return it if `exists`, else `null` (this is how Task 6 forces the fallback).
2. `readlink(<env.LOCALAPPDATA>\Microsoft\WindowsApps\chatgpt-desktop.exe)` → `path.win32.join(path.win32.dirname(target), 'resources', 'codex.exe')` (drop this step if Task 0 Step 5 showed readlink throws).
3. `runPs('(Get-AppxPackage -Name OpenAI.Codex).InstallLocation')` → `<location>\app\resources\codex.exe`.
4. `null`. A Codex CLI on PATH is out of scope: CLI users have `/hooks`.

Each candidate from 2–3 must pass `exists`; a throw or a miss moves to the next.

- [ ] **Step 1: Write the failing tests:** `env override wins`; `env override missing on disk -> null, no other lookups`; `alias link -> resources\codex.exe` (readlink returns `C:\PF\WindowsApps\OpenAI.Codex_1\app\ChatGPT.exe` → `C:\PF\WindowsApps\OpenAI.Codex_1\app\resources\codex.exe`); `alias throws -> Appx location`; `nothing found -> null` (readlink throws, runPs resolves `''`); `alias result missing on disk -> Appx location`.
- [ ] **Step 2: Run** `node --test test/codex-trust.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit.** `git add src/main/codex-trust.js test/codex-trust.test.js && git commit -m "feat: locate the Codex app's codex.exe"`

### Task 4: Copy and the due-check in wiring

**Files:**
- Modify: `src/main/wiring.js:297-300` (`codexStatusLabel`); add `codexTrustDue` next to `codexOfferDue` (:245)
- Test: `test/wiring.test.js:490-500`

**Interfaces:**
- Produces: `codexTrustDue({ cfg, target, missing }) -> boolean` — true only when `cfg?.codexAutoTrust === true`, `!target?.blocked` and `missing?.length > 0`.

- [ ] **Step 1: Update tests.** Change both `'Codex hooks: approve in /hooks'` assertions to `'Codex hooks: approve in Codex Settings → Hooks'`. Add `codexTrustDue`: flag unset → false; flag true + blocked target → false; flag true + `missing: []` → false; flag true + `missing: ['Stop']` → true; `cfg: null` → false.
- [ ] **Step 2: Run** `node --test test/wiring.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit.** `git commit -am "feat: Codex trust due-check; point the tray at Codex Settings → Hooks"`

### Task 5: Wire it into main.js

**Files:**
- Modify: `src/main/main.js` — imports (:14, :20), `CODEX_APPROVE_BALLOON` (:47), `confirmCodexInstall` detail (:542), `doCodexInstall` (:554-563), remove notice (:586), `codexState` comment (:601-602), `refreshMenu` (:625-644), `firstRun` (:686-692), `start` (:715-728).

**Interfaces:**
- Consumes: `trustCodexHooks`, `findCodexExe` (Tasks 2–3), `codexTrustDue` (Task 4); existing `codexState()`, `notify(title, body, isError?)`, `saveConfig`, `refreshMenu()`, `log()`.

- [ ] **Step 1: Copy.** Apply every string in Global Constraints › Copy. The dialog sentence replaces `'Codex asks you to approve new hooks once: open a Codex chat and type /hooks. '`.
- [ ] **Step 2: `async function trustCodex({ reason })`** with `reason` one of `'install' | 'startup' | 'tray'`. Returns at once if `CODEX.blocked` or a run is already in flight (module-level promise). Calls `findCodexExe()` then `trustCodexHooks({ exe, hooksPath: CODEX_PATH, command: CODEX_COMMAND, cwd: os.homedir() })`, logs the result, then `refreshMenu()`. Notifications: `ok` and `trusted.length` → success title (startup title for `'startup'`) with the Task 0 body; `ok` with nothing trusted → none; not `ok` → fallback title + `CODEX_APPROVE_BALLOON`.
- [ ] **Step 3: Consent and install.** A yes in `confirmCodexInstall` (first-run and tray paths) sets `cfg.codexAutoTrust = true` and saves. `doCodexInstall` no longer appends `CODEX_APPROVE_BALLOON` to its own notification; after a successful install it calls `trustCodex({ reason: 'install' })` when the file changed or `codexState().missing.length`.
- [ ] **Step 4: Startup.** In `start()`, after `await firstRun()`: `if (codexTrustDue({ cfg, target: CODEX, missing: codexState().missing })) trustCodex({ reason: 'startup' });` — only here, never from `refreshMenu`.
- [ ] **Step 5: Tray item.** In `refreshMenu`, directly under the Codex status line, when `!CODEX.blocked && codexState().missing.length`: `{ label: 'Trust Agent HUD hooks in Codex', click }` where `click` sets `cfg.codexAutoTrust = true`, saves, and calls `trustCodex({ reason: 'tray' })`. Compute `codexState()` once per `refreshMenu` call and reuse it for the label and this item.
- [ ] **Step 6: Run all tests.** `npm test` → all PASS.
- [ ] **Step 7: Commit.** `git commit -am "feat: trust the HUD's Codex hooks after install, at startup and from the tray"`

### Task 6: Live check on the packaged build (user present)

- [ ] **Step 1: Build and install.** `npm run build:win`; install `dist/Agent HUD Setup *.exe` over the current one.
- [ ] **Step 2: Install path.** With the user's go-ahead: back up `~/.codex/config.toml` and `~/.codex/hooks.json`; tray › Remove hooks; delete the HUD's `hooks.state` blocks (keys whose hook command is the HUD's); tray › Install hooks → yes. Expect the success notification, the tray reading `Codex hooks: installed`, no HUD hook waiting in the Codex app's Settings → Hooks, and a new Codex chat showing in the HUD.
- [ ] **Step 3: Fallback path.** Quit the HUD; delete one HUD `hooks.state` block; start `Agent HUD.exe` from a shell with `AGENT_HUD_CODEX_EXE=C:\nope.exe`. Expect exactly one `Agent HUD Codex hooks need approval` balloon with the Settings → Hooks text, the tray label `Codex hooks: approve in Codex Settings → Hooks` plus the `Trust Agent HUD hooks in Codex` item, and no second balloon after 60 s.
- [ ] **Step 4: Other tools untouched.** Diff the backup `config.toml` against the current one: only `hooks.state` entries for HUD keys differ. `hooks.json` matches the post-install file.
- [ ] **Step 5: Report** results to the user; commit any doc touch-ups.
