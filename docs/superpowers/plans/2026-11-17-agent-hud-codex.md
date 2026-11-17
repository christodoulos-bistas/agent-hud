# Agent HUD v2.0 — Codex Agents in the Guild — Implementation Plan

```
╔═════════════╦══════════════════════════════════════════════╦═════════════╗
║ MARVEL      ║                                              ║  APPROVED   ║
║ COMICS      ║           S P I D E R - V E R S E            ║   BY THE    ║
║ GROUP       ║                 ASM #9 – 15                  ║ COMICS CODE ║
║ $3.99·2014  ║                                              ║  AUTHORITY  ║
╠═════════════╩══════════════════════════════════════════════╩═════════════╣
║                                                                          ║
║                       " S P I D E R - V E R S E "                        ║
║                                                                          ║
║                     DAN SLOTT  ◆  2014–15  ◆  TIER 3                     ║
║                      multi-module, needs sequencing                      ║
╟──────────────────────────────────────────────────────────────────────────╢
║  WHY THIS ISSUE                                                          ║
║  Heroes from another world join one team: Codex agents join the guild,   ║
║  touching hooks, server, store, sprites and installer in turn.           ║
╟──────────────────────────────────────────────────────────────────────────╢
║  ROGUES GALLERY                                                          ║
║  ◆ GREEN GOBLIN    a bridge that hangs or fails closed and stalls Codex  ║
║  ◆ THE SPOT        our edit to ~/.codex/hooks.json breaks others' hooks  ║
║  ◆ CHAMELEON       Codex events look like Claude's and slip into Claude- ║
║                    only paths (AskUserQuestion, background tasks)        ║
║  ◆ VENOM           Codex trust is bound to the hook command: change it   ║
║                    and every user must approve it again                  ║
║  ◆ MYSTERIO        a quiet Codex chat is not a closed one                ║
╚══════════════════════════════════════════════════════════════════════════╝
```

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Codex chats appear in the HUD beside Claude chats — same classes on the approved Codex body, live steps, panel, tuck/✕ — and Codex permission prompts are answered from the panel through a bridge the HUD's own exe runs.

**Architecture:** Codex `command` hooks run `resources/codex-hook.cmd`, which runs `Agent HUD.exe` as Node (`ELECTRON_RUN_AS_NODE=1`) on `resources/codex-bridge.js`; the bridge POSTs each event to the HUD's existing hook server with `X-Agent-HUD-Source: codex` and prints the reply. The hook server tags events with their source; a Codex session tracker turns events into session records that main merges with Claude's session files; the renderer draws Codex agents with the Codex body and a `Codex ·` tag. Codex hooks are merged into `~/.codex/hooks.json` without ever moving a hook's position.

**Tech Stack:** Electron 44 (main, sandboxed preloads, renderer), plain ES modules (+ one CommonJS bridge script), `node:test`, electron-builder NSIS.

**Spec:** `docs/superpowers/specs/2026-11-17-agent-hud-codex-design.md` (spike record: `spikes/SPIKES.md` Spike 8, scripts in `spikes/codex/`)

## Global Constraints

- The bridge **fails open**: any error, refused connection, timeout, non-200 or empty reply → print nothing, exit 0.
- Bridge timeouts: connect 2 s; response **590 s** for `PermissionRequest`, **5 s** for every other event.
- Bridge headers: `X-Agent-HUD: <secret>`, `X-Agent-HUD-Source: codex`. Port and secret come from `%APPDATA%\agent-hud\config.json` at run time.
- The hook command written into `hooks.json` is the quoted path of `<install dir>\resources\codex-hook.cmd` and **nothing else**; it never changes between versions.
- Codex hook events installed: `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `Stop`, `Interrupt`, `SubagentStart`, `SubagentStop`; `timeout` 600 for `PermissionRequest`, 10 for the rest; `matcher: ""`.
- Positions never move: install appends our group at the end of an event's list; reinstall updates ours in place; foreign groups stay byte-identical and in order.
- Codex permission cards hold **60 s**, like Claude's. Codex events never create `choice` or `reply` cards.
- Codex sessions: busy after `UserPromptSubmit`/`PreToolUse`/`PermissionRequest`; idle after `Stop`/`Interrupt`; idle after **15 min** silence when no tool step is open; removed on `SessionEnd` or after **24 h** without an event.
- Copy: class-line tag `Codex · `; balloon `Codex: open a Codex chat, type /hooks and approve Agent HUD.`; tray status `Codex hooks: approve in /hooks`; re-approval notice `Codex may ask you to re-approve hooks for: <events> (/hooks)`.
- New config flag: `offeredCodexHooks` (one Codex-only offer).
- Look: the approved art in `.superpowers/brainstorm/codex/` (`codex-body.js` pasted as written); no OpenAI logo, no `>_`.
- `npm run dev` never writes the user's real `~/.codex/hooks.json`. Tests never touch real user files.

## Review Focus

1. The HUD crashes or quits while a Codex card is held → the bridge must return promptly with nothing, so Codex shows its own prompt (Task 2 test: server destroys the socket mid-request → empty reply, exit path taken).
2. A new Codex chat's very first event is a `PermissionRequest` → it must be held as a card, not skipped as "not interactive" (Task 4 test: codex source counts as interactive).
3. Another tool rewrites `hooks.json` after ours and our group moves → the tray must say approval is needed rather than claim all is well (Task 3 test: `approvalMissing` reports a moved position).
4. Two Codex chats in the same folder → two distinct rows (Task 5 test: derived names differ by session id).
5. A Codex chat hosted in VS Code while the Codex app is also open → Open window goes to VS Code, not the app (Task 9 test).

---

### Task 1: Settle the open items (spikes, no product code)

**Files:**
- Modify: `spikes/SPIKES.md` (new "Spike 9" section), `spikes/codex/*` as needed
- Ledger: one `Ruling:` line per value below

**Interfaces:**
- Produces (as ledger rulings, consumed by later tasks): `APPLY_PATCH_FIELD` (the `tool_input` key holding the patch text); `CODEX_HOSTS` (map of rollout `originator`/`source` values → `'desktop' | 'vscode' | 'cli'`); `CODEX_ACTIVATE` (the `{ cmd, args }` that brings the Codex app forward, or `null` if none works); `DEV_CODEX_TARGET` (`C:\Consortis_projects\agent-hud-spike\.codex\hooks.json` if Codex loads project-layer hooks there, else `null`).

- [ ] **Step 1: apply_patch payload.** With `spikes/codex/receiver.mjs` running, run `spikes/codex/tui.mjs` with a prompt that makes Codex create a file with `apply_patch` (sandbox read-only so it asks). Read `events.jsonl`; record the `tool_name` and the key holding the patch text.
- [ ] **Step 2: project-layer hooks.** Write the spike hooks into `C:\Consortis_projects\agent-hud-spike\.codex\hooks.json` (pointing at `spikes/codex/bridge.cmd`), run interactive Codex in that folder with `--dangerously-bypass-hook-trust` and **no** `-c hooks.*` overrides, and see whether events reach the receiver. Delete that file afterwards if the answer is no.
- [ ] **Step 3: host values.** Scan every rollout under `~/.codex/sessions` (first line only) and list distinct `originator`/`source` pairs; map the ones seen. Unseen surfaces map to `'unknown'`.
- [ ] **Step 4: bring the Codex app forward.** Find the Codex app's top-level window (process `ChatGPT.exe` from the `OpenAI.Codex` package) and try a PowerShell activation (by window title via `WScript.Shell.AppActivate`, else by PID). Record the command that works; no scripted mouse clicks.
- [ ] **Step 5: Record** Spike 9 in `spikes/SPIKES.md`, write the four rulings to the ledger, and commit:

```bash
git add spikes
git commit -m "spike: Codex apply_patch payload, project hooks, hosts, app activation"
```

### Task 2: The bridge and its packaging

**Files:**
- Create: `resources/codex-bridge.js` (CommonJS), `resources/codex-hook.cmd`
- Modify: `package.json` (`build.extraResources`)
- Test: `test/codex-bridge.test.js`

**Interfaces:**
- Produces: `resources/codex-bridge.js` exports `readConfig(file: string) -> { port: number, secret: string } | null`, `timeoutFor(eventName: string) -> number` (590000 for `PermissionRequest`, 5000 otherwise), `forward(stdinText: string, { port, secret, timeoutMs, connectMs = 2000 }) -> Promise<string>` (resolves the reply body for HTTP 200, else `''`; never rejects). Run as a script it reads stdin, `readConfig(path.join(process.env.APPDATA, 'agent-hud', 'config.json'))`, forwards with `timeoutFor(<hook_event_name>)`, writes the result, exits 0.
- Produces: installed paths `<install>\resources\codex-hook.cmd` and `<install>\resources\codex-bridge.js` via `"extraResources": [{ "from": "resources", "to": ".", "filter": ["codex-bridge.js", "codex-hook.cmd"] }]`.

- [ ] **Step 1: Write the failing tests** (import with `createRequire`; servers are async in-process, so no `spawnSync` deadlock):

```js
test('forward passes a 200 body through and sends both headers and the body verbatim', async () => { /* local server echoes {"ok":true}; assert reply === '{"ok":true}', req.headers['x-agent-hud'] === 's', req.headers['x-agent-hud-source'] === 'codex', received body === input */ });
test('forward returns "" for non-200, empty 200, refused port (under 2.5 s) and a stalled server past timeoutMs', async () => { /* 403 → '', 200 '' → '', unused port → '', server never answers + timeoutMs 200 → '' */ });
test('Review Focus 1: the server dropping the socket mid-request gives "" promptly', async () => { /* server req.socket.destroy() after 50 ms → '' within 1 s */ });
test('timeoutFor: 590000 for PermissionRequest, 5000 for others', () => { /* ... */ });
test('readConfig: valid → {port, secret}; missing file, bad JSON, missing secret → null', () => { /* tmp dir */ });
test('codex-hook.cmd runs the HUD exe as Node on the bridge', () => { /* text includes 'set ELECTRON_RUN_AS_NODE=1' and '"%~dp0..\\Agent HUD.exe" "%~dp0codex-bridge.js"' */ });
test('package.json ships both resources and never disables RunAsNode', () => { /* build.extraResources filter has both names; JSON text has no /runAsNode"?\s*:\s*false/i and no electronFuses entry turning it off */ });
```

- [ ] **Step 2: Run them to see them fail** — `node --test test/codex-bridge.test.js` → FAIL (module missing).
- [ ] **Step 3: Implement** the bridge (Node built-ins only; `http.request` to `127.0.0.1`), the `.cmd` (`@echo off`, `set ELECTRON_RUN_AS_NODE=1`, the exe line) and the `extraResources` entry.
- [ ] **Step 4: Run** `npm test` → all pass.
- [ ] **Step 5: Commit** — `git commit -m "feat: Codex hook bridge run by the HUD's own exe"`

### Task 3: Codex hooks file — install, remove, status

**Files:**
- Create: `src/main/codex-hooks.js`
- Modify: `src/main/settings-hooks.js` (export its existing file-rewrite helper as `rewrite(file, transform)`)
- Test: `test/codex-hooks.test.js`

**Interfaces:**
- Consumes: `rewrite(file, transform)` from `settings-hooks.js` (same EOL/BOM/backup/atomic/missing/unparseable behaviour Claude's install has; `transform.skipIfMissing` for remove).
- Produces: `CODEX_EVENTS` (the ten names in Global Constraints); `codexHookCommand(resourcesDir: string) -> string` (`"<resourcesDir>\codex-hook.cmd"` with quotes); `installCodexHooks(doc: object, command: string) -> { doc, changed: boolean }`; `removeCodexHooks(doc, command) -> { doc, changed: boolean, shifted: string[] }` (events where a foreign group followed ours); `ourPositions(doc, command) -> Array<{ event, group, hook }>`; `approvalMissing(configToml: string, hooksPath: string, positions) -> string[]` (events whose `[hooks.state.'<hooksPath>:<snake_event>:<group>:<hook>']` header is absent); `installCodexHooksFile(file, command)`, `removeCodexHooksFile(file, command)` → `rewrite` results (+ `shifted` for remove).

- [ ] **Step 1: Write the failing tests** with a fixture shaped like the user's file (foreign groups in `PreToolUse`, `PostToolUse` ×3, `Stop` ×2, including a `commandWindows` field):

```js
test('install appends ours last in every event and leaves foreign groups identical and in order', () => { /* for each event: foreign groups deepEqual before/after at the same indices; ours is the last group; timeout 600 only on PermissionRequest */ });
test('reinstall updates ours in place: same index, no duplicate, changed=false when identical', () => {});
test('remove: ours last → shifted []; a foreign group after ours → shifted lists that event', () => {});
test('Review Focus 3: approvalMissing reports our positions with no hooks.state entry, including after our group moved', () => {});
test('file: missing → created with only ours; unparseable → ok:false and file unchanged; CRLF kept', () => {});
test('codexHookCommand quotes the .cmd path', () => { /* codexHookCommand('C:\\x\\resources') === '"C:\\x\\resources\\codex-hook.cmd"' */ });
```

- [ ] **Step 2: Run** `node --test test/codex-hooks.test.js` → FAIL.
- [ ] **Step 3: Implement.** Event-name to config key: `PreToolUse → pre_tool_use` (camel to snake). Our group shape: `{ matcher: '', hooks: [{ type: 'command', command, timeout }] }`.
- [ ] **Step 4: Run** `npm test` → all pass (Claude's settings-hooks tests unchanged).
- [ ] **Step 5: Commit** — `git commit -m "feat: merge Codex hooks without moving any hook's position"`

### Task 4: Hook server — source tagging and Codex-safe holds

**Files:**
- Modify: `src/main/hook-server.js`
- Test: `test/hook-server.test.js`

**Interfaces:**
- Produces: `onEvent` events gain `source: 'codex' | 'claude'` (`'codex'` iff header `x-agent-hud-source` is `codex`); held queue items gain `source`. For `source === 'codex'`: `PermissionRequest` is held as `permission` without consulting `isInteractive` (Codex exec never sends it); `AskUserQuestion` never becomes `choice`; `Stop` never becomes `reply`.

- [ ] **Step 1: Write the failing tests** (the file's existing server harness):

```js
test('v2: a codex PermissionRequest for a session the HUD never saw is held as a permission card with source codex (Review Focus 2)', async () => {});
test('v2: codex AskUserQuestion and codex Stop with reply opt-in are not held', async () => {});
test('v2: onEvent receives source codex / claude by header', async () => {});
```

- [ ] **Step 2: Run** `node --test test/hook-server.test.js` → FAIL.
- [ ] **Step 3: Implement** in `handle`/`route`.
- [ ] **Step 4: Run** `npm test` → all pass.
- [ ] **Step 5: Commit** — `git commit -m "feat: hook server tags Codex events and holds only their permissions"`

### Task 5: Codex sessions and the merged session list

**Files:**
- Create: `src/main/codex-sessions.js`
- Modify: `src/main/store.js` (views/detail carry `source`), `src/main/main.js` (merge, interactive check, onEvent)
- Test: `test/codex-sessions.test.js`, `test/store.test.js`

**Interfaces:**
- Consumes: Task 4's `ev.source`; Task 1's `CODEX_HOSTS`.
- Produces: `createCodexSessions({ now = Date.now, idleAfterMs = 900000, expireAfterMs = 86400000, readMeta })` → `{ onEvent(ev), list() -> Session[], has(id) -> boolean }`. `Session = { sessionId, pid: null, cwd, kind: 'interactive', entrypoint: 'codex', source: 'codex', host: 'desktop'|'vscode'|'cli'|'unknown', name: '', nameSource: 'derived', status: 'busy'|'idle', startedAt, statusSince }`. `readMeta(transcriptPath) -> { originator, source } | null` reads the rollout's first line once per session (main passes a sync file reader; tests pass a stub). `hostOf(meta) -> host` exported. AgentView and detail gain `source` (`sess.source ?? 'claude'`).
- Main: on an event with `source === 'codex'`, call `codexSessions.onEvent(ev)` then `store.setSessions(merged())` **before** `store.onEvent(ev)`; `poll()` sets `merged() = [...claudeSessions, ...codexSessions.list()]`; `createInteractiveCheck` reads the merged list.

- [ ] **Step 1: Write the failing tests:**

```js
test('first codex event creates an interactive session; host from meta; UserPromptSubmit busy, Stop idle, Interrupt idle', () => {});
test('busy with no open tool step goes idle after 15 min; an open PreToolUse without its Post keeps it busy', () => {});
test('SessionEnd removes it; 24 h without an event removes it; any event resets the clock', () => {});
test('Review Focus 4: two codex sessions in one folder get distinct derived names', () => { /* displayName(s1) !== displayName(s2) */ });
test('store: a codex session view and detail carry source codex; a Claude one carries claude', () => {});
```

- [ ] **Step 2: Run** `node --test test/codex-sessions.test.js test/store.test.js` → FAIL.
- [ ] **Step 3: Implement** the tracker (open steps keyed by `tool_use_id`), the store field and the main wiring.
- [ ] **Step 4: Run** `npm test` → all pass.
- [ ] **Step 5: Commit** — `git commit -m "feat: Codex sessions from hook events, merged with Claude's"`

### Task 6: Codex tools in classes, activity lines and step labels

**Files:**
- Modify: `src/main/steps.js` (`activityLine`, `stepLabel`, new `patchPaths`), `src/main/classes.js` (`signalsFromEvent`)
- Test: `test/steps.test.js`, `test/classes.test.js`

**Interfaces:**
- Consumes: Task 1's `APPLY_PATCH_FIELD`.
- Produces: `patchPaths(patchText: string) -> string[]` (paths after `*** Add File: `, `*** Update File: `, `*** Delete File: `, in order, deduplicated). For `tool_name === 'apply_patch'`: `activityLine` → `editing <basename of first>`; `stepLabel` → `Edited <basename of first>` plus ` +<n-1>` when more; `signalsFromEvent` → the same signals an `Edit` of each path gives.

- [ ] **Step 1: Write the failing tests:** `patchPaths` on a three-file patch (`['src/a.ts','README.md','old.js']`); `stepLabel('apply_patch', { [APPLY_PATCH_FIELD]: patch })` → `'Edited a.ts +2'`; `activityLine` → `'editing a.ts'`; `signalsFromEvent` for a patch touching `src/a.ts` equals the signals for an `Edit` of `src/a.ts`; Codex `Bash` events give the same labels as Claude's.
- [ ] **Step 2: Run** `node --test test/steps.test.js test/classes.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` → all pass.
- [ ] **Step 5: Commit** — `git commit -m "feat: Codex apply_patch edits count like Edit for classes and steps"`

### Task 7: Codex sprites

**Files:**
- Modify: `src/renderer/sprites.js` (paste `.superpowers/brainstorm/codex/codex-body.js` as written; `spriteSvg` option)
- Test: `test/sprites.test.js` (new, or the file that already covers `spriteSvg`)

**Interfaces:**
- Produces: exports `CODEX_PAL`, `CODEX_BODY`, `CODEX_FAMILIAR`, `codexOf(def)`; `spriteSvg(classId, scale = 2, { source = 'claude' } = {})` draws `codexOf(def)` for `'codex'`.

- [ ] **Step 1: Write the failing tests:** for every class id the Codex SVG differs from the Claude SVG and contains `#8ef5c6`; the Claude SVG for every class is byte-identical to its output before this task (capture before changing); `spriteSvg(id, 2)` equals `spriteSvg(id, 2, { source: 'claude' })`; the Codex Summoner contains no Claude critter colours (`#D97757`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` → all pass.
- [ ] **Step 5: Commit** — `git commit -m "feat: Codex body, familiar and palette for every class"`

### Task 8: Renderer — Codex rows, panel, tag

**Files:**
- Modify: `src/renderer/hud.js`, `src/renderer/panel.js`, `src/renderer/hud.css` (and `panel.css` if the tag lives there)
- Test: `test/hud-render.test.js`, `test/panel-render.test.js`

**Interfaces:**
- Consumes: `spriteSvg(cls, scale, { source })`, `CODEX_FAMILIAR` (Task 7); `agent.source`, `detail.source` (Task 5).
- Produces: every sprite cache key includes the source (`class:<source>:<cls>`, familiar `fam:<source>`); Codex rows and collapsed faces draw the Codex body and familiars; the class line starts with `<span class="src">Codex</span> · ` for Codex agents (row and panel); no "wait for my reply" button on Codex rows. Tag style from the roster notes: Alegreya Sans 700, .68rem, `#c3ccd5` on slate 22%, 3 px radius, no border.

- [ ] **Step 1: Write the failing tests:** a Codex row contains `class="src">Codex</span> · ` and `#8ef5c6`, and no `data-act="wait"`; a Claude row has none of these; a Claude and a Codex agent of the same class render different sprites in one `renderParty` (proves the cache key); the panel's class line for a Codex detail starts with the tag.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` → all pass.
- [ ] **Step 5: Commit** — `git commit -m "feat: Codex rows, panel and tag in the HUD"`

### Task 9: Open window for Codex chats

**Files:**
- Modify: `src/main/focus.js`, `src/main/main.js` (pass `codexActivate`)
- Test: `test/focus.test.js`

**Interfaces:**
- Consumes: Task 1's `CODEX_ACTIVATE`; session `host` (Task 5).
- Produces: `openCommandFor(session, { codeCmd, codexActivate })`: `entrypoint === 'codex'` → host `desktop` → `codexActivate` (null → no button); host `vscode` → `{ cmd: codeCmd, args: [cwd] }` when both exist; otherwise `null`. Claude branches unchanged.

- [ ] **Step 1: Write the failing tests:** desktop host → `codexActivate`; vscode host → code.cmd with cwd (Review Focus 5); cli/unknown → null; desktop with `codexActivate: null` → null; Claude cases unchanged.
- [ ] **Step 2: Run** `node --test test/focus.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` → all pass.
- [ ] **Step 5: Commit** — `git commit -m "feat: open window brings the right app forward for Codex chats"`

### Task 10: Install, offer, status and removal wiring

**Files:**
- Modify: `src/main/wiring.js` (`codexTarget`, `codexOfferDue`, `removeHooksCli` for two targets), `src/main/main.js` (tray, first run, balloon, status, `--remove-hooks`), `scripts/dev.mjs`
- Test: `test/wiring.test.js`

**Interfaces:**
- Consumes: Task 3's file functions and `approvalMissing`; Task 1's `DEV_CODEX_TARGET`.
- Produces: `codexTarget({ isPackaged, envPath, home, exists }) -> { path: string|null, blocked: boolean }` — `AGENT_HUD_CODEX_HOOKS_PATH` wins; packaged → `<home>\.codex\hooks.json` when `<home>\.codex` exists, else blocked; dev without env → blocked. `codexOfferDue({ cfg, target, installed }) -> boolean` — true only when `!cfg.offeredCodexHooks && !target.blocked && !installed`. The command main installs: packaged → `codexHookCommand(path.join(path.dirname(process.execPath), 'resources'))`; dev → the spike bridge command (only with `AGENT_HUD_CODEX_HOOKS_PATH` set). `dev.mjs` sets `AGENT_HUD_CODEX_HOOKS_PATH` to `DEV_CODEX_TARGET` when that ruling is not null.
- Tray: Install/Remove act on Claude and (when not blocked) Codex; one status line per target, with `Codex hooks: approve in /hooks` while `approvalMissing` is non-empty; after a Codex install, the balloon copy from Global Constraints; after a remove with `shifted.length`, the re-approval notice. First run: the existing Claude offer as today, then (independently) a Codex-only offer when `codexOfferDue`, setting `offeredCodexHooks` either way. `--remove-hooks` removes from both targets and logs both results.

- [ ] **Step 1: Write the failing tests:** `codexTarget` (env wins; packaged with/without `.codex`; dev blocked); `codexOfferDue` truth table; `removeHooksCli` with two targets reports both.
- [ ] **Step 2: Run** `node --test test/wiring.test.js` → FAIL.
- [ ] **Step 3: Implement** (dialog and tray copy beyond Global Constraints is the builder's).
- [ ] **Step 4: Run** `npm test` → all pass; `node --check src/main/main.js`.
- [ ] **Step 5: Commit** — `git commit -m "feat: install, offer and remove Codex hooks with Claude's"`

### Task 11: Live check and installer

**Files:** none unless a defect is found (then TDD in the owning task's files).

- [ ] **Step 1: Dev run.** `node scripts/dev.mjs --quit` only if a *dev* HUD started in this session is running (never quit the user's installed HUD; if it owns the port, stop and ask the user to quit it from its tray). Start `npm run dev`.
- [ ] **Step 2: Live Codex check** in a scratch folder (project-layer hooks if `DEV_CODEX_TARGET`, else `spikes/codex/tui.mjs`-style `-c hooks.*` overrides pointing at the dev bridge): a Codex row appears with the Codex body and `Codex ·` tag; steps show; Allow and Deny clicked **in the panel by the user or via the dev debug-port driver** reach Codex; with the dev HUD stopped, Codex shows its own prompt after the bridge fails open. No scripted clicks on the user's desktop.
- [ ] **Step 3: Ask the user** for the two Desktop-only checks (does closing a chat send `SessionEnd`; does Esc send `Interrupt`) — record answers in `spikes/SPIKES.md`; the 24 h / 15 min fallbacks cover a "no".
- [ ] **Step 4: Rebuild** — `npm run build:win`; confirm `dist\win-unpacked\resources\codex-hook.cmd` and `codex-bridge.js` exist and `app.asar` has no local secret.
