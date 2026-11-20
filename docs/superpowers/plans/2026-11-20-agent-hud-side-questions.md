# Agent HUD Side Questions Implementation Plan

🕷️

```
╔═════════════╦══════════════════════════════════════════════╦═════════════╗
║ MARVEL      ║                                              ║  APPROVED   ║
║ COMICS      ║     A M A Z I N G   S P I D E R - M A N      ║   BY THE    ║
║ GROUP       ║                  ANNUAL #1                   ║ COMICS CODE ║
║ 25¢ · 1964  ║                                              ║  AUTHORITY  ║
╠═════════════╩══════════════════════════════════════════════╩═════════════╣
║                                                                          ║
║                   " T H E   S I N I S T E R   S I X "                    ║
║                                                                          ║
║                STAN LEE & STEVE DITKO  ◆  1964  ◆  TIER 3                ║
║                      multi-module, needs sequencing                      ║
╟──────────────────────────────────────────────────────────────────────────╢
║  WHY THIS ISSUE                                                          ║
║  Several foes, fought one at a time: an asker, a VS Code reader, a log,  ║
║  a panel tab and a row shortcut are separate fronts that meet in one     ║
║  store and one panel.                                                    ║
╟──────────────────────────────────────────────────────────────────────────╢
║  ROGUES GALLERY                                                          ║
║  ◆ GREEN GOBLIN   an update renames the side_question request or         ║
║                   VS Code's sideQuestionThreads key: both go dark        ║
║  ◆ THE SPOT       the asking process writes a session file under         ║
║                   the chat's own id; the row follows it for seconds      ║
║  ◆ CHAMELEON      the child inherits ELECTRON_RUN_AS_NODE or a host      ║
║                   entrypoint and starts as the wrong thing               ║
║  ◆ MYSTERIO       VS Code's stored shape is read from one sample         ║
║  ◆ MORBIUS        re-reading every workspace database on each poll       ║
║  ◆ VULTURE        the thread growing into a second chat window           ║
╚══════════════════════════════════════════════════════════════════════════╝
```

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ask any Claude chat a side question from the HUD, and keep every side question (HUD-asked or VS Code `/btw`) in a per-chat log shown in a "Side questions" tab of the details panel.

**Architecture:** Main gets four new modules: an asker that spawns `claude.exe` and speaks the stream-json `side_question` control request, a JSON Lines log under userData, a VS Code reader that copies `sideQuestionThreads` out of `state.vscdb`, and a coordinator that ties them to the store (row dot, panel view, tab state). The renderer gets a Side questions tab in the panel, a safe Markdown subset for answers, and a hover **?** plus dot on HUD rows. `sessions.js` hides the asking process by its entrypoint.

**Tech Stack:** Electron 44.7.2 (Node 24.21.0 in the app; `node:sqlite` there), plain ES modules, `node --test` on the system Node 20 (no `node:sqlite` — import it lazily, never in tests).

**Spec:** `docs/superpowers/specs/2026-11-20-agent-hud-side-questions-design.md` (read §3, §5 and §6 before starting).

## Global Constraints

- Entrypoint marker: `agent-hud-side` (exported as `SIDE_ENTRYPOINT` from `src/main/sessions.js`).
- Child args: `-p --input-format stream-json --output-format stream-json --verbose --resume <sessionId> --no-session-persistence --settings {"disableAllHooks":true}`, plus `--model <m>` when known. Spawned without a shell, `windowsHide: true`, `cwd` = the chat's cwd.
- Child env: `process.env` minus `ELECTRON_RUN_AS_NODE` and `CLAUDECODE`, plus `CLAUDE_CODE_ENTRYPOINT=agent-hud-side`.
- Request ids: `init` (`{"subtype":"initialize"}`) and `sq` (`{"subtype":"side_question","question","history"?}`); history only when non-empty.
- Timeouts: initialize fallback 2000 ms; overall 300000 ms; exit grace after the answer 5000 ms.
- History: the chat's last 10 logged exchanges with a response, oldest first, `{ question, response }`.
- Panel shows the newest 50 entries; the log keeps all, forever (no automatic deletion).
- Log file: `<userData>\side-questions\<sessionId>.jsonl`; line `{ id, at, source: "hud"|"vscode", question, response: string|null, error?: string }`.
- VS Code: `%APPDATA%\Code\User\workspaceStorage\*\state.vscdb`, every 30000 ms, mtime-gated, read-only.
- Exact texts:
  - busy note: `\n\n(Agent HUD note: this chat is still working right now. Current step: <doing>, for <elapsed>. Anything unfinished in the conversation is still running, not interrupted.)` where `<elapsed>` is `fmtDuration`.
  - errors: `Claude Code CLI not found` · `Claude gave no answer` · `No answer after 5 minutes` · `Claude didn't take the side question: this Claude version may have changed how they work. Ask in the chat with /btw.`
  - empty tab: `None yet. Ask one, or use /btw in VS Code: those show up here too.`
  - reader unhealthy: `Can't read VS Code side questions right now.`
  - row button title: `Ask on the side`; tray item: `Open side-question logs`; placeholders `Ask <display> on the side…` (empty thread) / `Ask a follow-up…` / `Waiting for the answer…` (while asking).
- Colours: house tokens only; side-question slate: text `#cfd6e6`, block `rgba(79, 103, 135, .16)` with left rule `rgba(130, 155, 190, .7)`, dot `#8fa6c6`. No sound, no glow for side answers.
- Codex agents: no tabs, no **?**, no dot, never asked.
- Every string from a log, a chat or VS Code goes through `esc` before markup.
- Tests never start the real Claude, never open real VS Code databases, never write outside `os.tmpdir()`.

## Review Focus

1. **Double submit / blank question** — Enter twice, or Ask on whitespace: exactly one ask per chat at a time, blank ignored (Task 6).
2. **VS Code database briefly locked** while VS Code writes it — one failed open is not "unhealthy"; the db is re-read next pass; unhealthy only after 3 failures in a row of the same file (Task 5).
3. **Hostile or malformed thread keys** (`"..\\..\\x 9p"`, empty, non-UUID) — never become a file path; skipped (Task 4).
4. **HUD quits mid-ask** — the child is killed, no orphan `claude.exe` and no stray session file (Tasks 3, 10).
5. **The chat ends while its question is out** — the answer is still logged under its session id and nothing throws (Task 6).

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/main/sessions.js` (modify) | `SIDE_ENTRYPOINT`; drop those files in `readSessionFiles` |
| `src/main/side-ask.js` (create) | pure helpers (exe lookup, env, args, request lines, reply parse, busy note, model and transcript lookup) + `askSide` process |
| `src/main/side-log.js` (create) | per-chat JSON Lines log: list, add, remove, import VS Code items, history |
| `src/main/vscode-threads.js` (create) | `extractThreads` (pure) + `createVscodeReader` (mtime gate, health) |
| `src/main/side-questions.js` (create) | coordinator: asking state, dots, tabs, viewing, focus requests, `view(id)` |
| `src/main/store.js` (modify) | `side` dependency: `sideDot` on agents, `side` on detail, `transcriptOf(id)` |
| `src/main/main.js` (modify) | wiring: log dir, reader timer, IPC, tray item, quit, focus |
| `src/renderer/side-md.js` (create) | `renderAnswer(text)`: escaped Markdown subset |
| `src/renderer/side-tab.js` (create) | `renderTabs`, `renderSideTab`, `sideWhen` |
| `src/renderer/panel.js` (modify) | tabs in `renderPanel`; ask box, Enter/Esc, copy, retry, focus, drafts in `bootPanel` |
| `src/renderer/hud.js` (modify) | **?** and dot in `renderRow`; `side` click |
| `src/renderer/panel.css`, `hud.css` (modify) | styles from §5 / the mockup |
| `src/preload-panel.cjs`, `src/preload.cjs` (modify) | new IPC calls |
| `test/fixtures/fake-claude.mjs` (create) | stream-json fake for `askSide` |
| `test/side-*.test.js`, `test/vscode-threads.test.js` (create) | tests per task |
| `spikes/SPIKES.md` (modify) | the hands-on checklist (Task 11) |

---

### Task 1: Hide the asking process from every session reader

**Files:**
- Modify: `src/main/sessions.js` (`toSession`, `readSessionFiles`)
- Test: `test/sessions.test.js`

**Interfaces:**
- Produces: `export const SIDE_ENTRYPOINT = 'agent-hud-side'`; `readSessionFiles(dir)` never returns a session whose `entrypoint === SIDE_ENTRYPOINT`.

- [ ] **Step 1: Write the failing test** (in `test/sessions.test.js`, using a temp dir like the existing tests)

```js
test('readSessionFiles drops the HUD\'s own side-question process (entrypoint agent-hud-side)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-sess-'));
  const base = { sessionId: 'abc', cwd: 'c:\\p', kind: 'interactive', status: 'idle', startedAt: 5 };
  fs.writeFileSync(path.join(dir, '100.json'), JSON.stringify({ ...base, pid: 100, entrypoint: 'claude-vscode' }));
  fs.writeFileSync(path.join(dir, '200.json'), JSON.stringify({ ...base, pid: 200, entrypoint: SIDE_ENTRYPOINT, startedAt: 9 }));
  const got = readSessionFiles(dir);
  assert.deepEqual(got.map((s) => s.pid), [100]);
  assert.equal(SIDE_ENTRYPOINT, 'agent-hud-side');
});
```

- [ ] **Step 2: Run it** — `node --test test/sessions.test.js` → FAIL (`SIDE_ENTRYPOINT` not exported).
- [ ] **Step 3: Implement** — export the constant; in `readSessionFiles` skip parsed sessions with that entrypoint. Every reader (`listSessions`, the `isInteractive` re-read at `main.js:201`, `sessionById` at `main.js:216`) goes through it.
- [ ] **Step 4: Run** `npm test` → all pass.
- [ ] **Step 5: Commit** — `git commit -m "feat: session readers skip the HUD's side-question process (entrypoint agent-hud-side)"`

---

### Task 2: Side-ask pure helpers

**Files:**
- Create: `src/main/side-ask.js`
- Test: `test/side-ask.test.js`

**Interfaces:**
- Consumes: `SIDE_ENTRYPOINT` (Task 1), `fmtDuration` (`src/renderer/format.js`).
- Produces (all exported from `side-ask.js`):
  - `SIDE_ERRORS = { notFound, noAnswer, timeout, refused }` — the four texts in Global Constraints.
  - `findClaudeExe({ env, home, exists }) -> string | null` — order: `env.AGENT_HUD_CLAUDE_EXE`, `<home>\.local\bin\claude.exe`, each `PATH` (or `Path`) dir + `claude.exe`; first that `exists(p)`.
  - `childEnv(env) -> object`
  - `sideArgs({ sessionId, model }) -> string[]`
  - `requestLines({ question, history }) -> { init: string, ask: string }` (each ends with `\n`)
  - `parseReply(line: string) -> null | { answer: string } | { error: string, detail: string }` — only for `control_response` with `request_id === 'sq'`; anything else → `null`.
  - `withBusyNote(question, current: { doing, startedAt } | null, now) -> string`
  - `transcriptPathFor(home, cwd, sessionId) -> string` — `<home>\.claude\projects\<cwd with every char outside [A-Za-z0-9] replaced by '-'>\<sessionId>.jsonl` (spec §6.2 said `: \ /`; `_` is replaced too: `c:\Consortis_projects\agent-hud` → `c--Consortis-projects-agent-hud`).
  - `modelFromTranscriptTail(text) -> string | null` — the `message.model` of the last `type === "assistant"` line; bad lines skipped.

- [ ] **Step 1: Write the failing tests**

```js
import test from 'node:test'; import assert from 'node:assert/strict';
import { SIDE_ERRORS, findClaudeExe, childEnv, sideArgs, requestLines, parseReply, withBusyNote, transcriptPathFor, modelFromTranscriptTail } from '../src/main/side-ask.js';

test('findClaudeExe: env override, then ~/.local/bin, then PATH', () => {
  const has = (...ps) => (p) => ps.includes(p);
  assert.equal(findClaudeExe({ env: { AGENT_HUD_CLAUDE_EXE: 'D:\\f\\claude.exe' }, home: 'C:\\U', exists: has('D:\\f\\claude.exe') }), 'D:\\f\\claude.exe');
  assert.equal(findClaudeExe({ env: {}, home: 'C:\\U', exists: has('C:\\U\\.local\\bin\\claude.exe') }), 'C:\\U\\.local\\bin\\claude.exe');
  assert.equal(findClaudeExe({ env: { Path: 'C:\\a;C:\\b' }, home: 'C:\\U', exists: has('C:\\b\\claude.exe') }), 'C:\\b\\claude.exe');
  assert.equal(findClaudeExe({ env: { PATH: 'C:\\a' }, home: 'C:\\U', exists: () => false }), null);
});

test('childEnv strips ELECTRON_RUN_AS_NODE and CLAUDECODE, marks the entrypoint', () => {
  const e = childEnv({ ELECTRON_RUN_AS_NODE: '1', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'claude-vscode', PATH: 'x' });
  assert.deepEqual(e, { PATH: 'x', CLAUDE_CODE_ENTRYPOINT: 'agent-hud-side' });
});

test('sideArgs: the spec\'s flags, --model only when known', () => {
  const base = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--resume', 's1', '--no-session-persistence', '--settings', '{"disableAllHooks":true}'];
  assert.deepEqual(sideArgs({ sessionId: 's1' }), base);
  assert.deepEqual(sideArgs({ sessionId: 's1', model: 'claude-opus-5-5' }), [...base, '--model', 'claude-opus-5-5']);
});

test('requestLines: init then side_question; history only when non-empty', () => {
  const a = requestLines({ question: 'q?', history: [] });
  assert.deepEqual(JSON.parse(a.init), { type: 'control_request', request_id: 'init', request: { subtype: 'initialize' } });
  assert.deepEqual(JSON.parse(a.ask), { type: 'control_request', request_id: 'sq', request: { subtype: 'side_question', question: 'q?' } });
  assert.ok(a.init.endsWith('\n') && a.ask.endsWith('\n'));
  const b = requestLines({ question: 'q2', history: [{ question: 'q1', response: 'r1' }] });
  assert.deepEqual(JSON.parse(b.ask).request.history, [{ question: 'q1', response: 'r1' }]);
});

test('parseReply: success, null answer, error, other ids and noise', () => {
  const ok = JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: 'sq', response: { response: 'MARMALADE', synthetic: false } } });
  assert.deepEqual(parseReply(ok), { answer: 'MARMALADE' });
  const nul = JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: 'sq', response: { response: null } } });
  assert.deepEqual(parseReply(nul), { error: SIDE_ERRORS.noAnswer, detail: 'null response' });
  const err = JSON.stringify({ type: 'control_response', response: { subtype: 'error', request_id: 'sq', error: 'Unknown subtype' } });
  assert.deepEqual(parseReply(err), { error: SIDE_ERRORS.refused, detail: 'Unknown subtype' });
  assert.equal(parseReply(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: 'init', response: {} } })), null);
  assert.equal(parseReply('booting…'), null);
  assert.equal(parseReply(JSON.stringify({ type: 'system', subtype: 'commands_changed' })), null);
});

test('withBusyNote: the exact note while working, the plain question otherwise', () => {
  const now = 100_000;
  assert.equal(withBusyNote('why?', { doing: 'running sleep 25', startedAt: now - 9000 }, now),
    'why?\n\n(Agent HUD note: this chat is still working right now. Current step: running sleep 25, for 9s. Anything unfinished in the conversation is still running, not interrupted.)');
  assert.equal(withBusyNote('why?', null, now), 'why?');
});

test('transcriptPathFor replaces every non-alphanumeric character of the cwd', () => {
  assert.equal(transcriptPathFor('C:\\Users\\b', 'c:\\Consortis_projects\\agent-hud', 'abc'),
    'C:\\Users\\b\\.claude\\projects\\c--Consortis-projects-agent-hud\\abc.jsonl');
});

test('modelFromTranscriptTail: the last assistant line\'s model; a cut first line is skipped', () => {
  const t = 'tial line"}\n' + [
    { type: 'assistant', message: { model: 'claude-sonnet-5-5' } }, { type: 'user', message: {} },
    { type: 'assistant', message: { model: 'claude-opus-5-5' } }, { type: 'system' },
  ].map((o) => JSON.stringify(o)).join('\n');
  assert.equal(modelFromTranscriptTail(t), 'claude-opus-5-5');
  assert.equal(modelFromTranscriptTail('{"type":"user"}'), null);
});
```

- [ ] **Step 2: Run** `node --test test/side-ask.test.js` → FAIL (module missing).
- [ ] **Step 3: Implement the helpers in `src/main/side-ask.js`** with the signatures above. `childEnv` copies, deletes the two keys, sets `CLAUDE_CODE_ENTRYPOINT: SIDE_ENTRYPOINT`. Paths use `path.win32.join`.
- [ ] **Step 4: Run** `node --test test/side-ask.test.js` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: side-ask helpers (exe lookup, env, args, stream-json lines, reply, busy note, model)"`

---

### Task 3: `askSide` — the asking process

**Files:**
- Modify: `src/main/side-ask.js`
- Create: `test/fixtures/fake-claude.mjs`
- Test: `test/side-ask-process.test.js`

**Interfaces:**
- Consumes: Task 2 helpers.
- Produces: `askSide({ exe: { file, args = [] }, sessionId, cwd, question, history = [], model = null, env, spawnFn = spawn, timeoutMs = 300000, initFallbackMs = 2000, exitGraceMs = 5000, signal }) -> Promise<{ answer: string } | { error: string, detail?: string }>`. Never rejects. `exe === null` → `{ error: SIDE_ERRORS.notFound }`.

Behaviour: spawn `exe.file` with `[...exe.args, ...sideArgs({ sessionId, model })]`, `{ cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] }`; write `init`; write `ask` on the `init` control_response or after `initFallbackMs`, whichever first (once); split stdout on `\n` across chunks; first non-null `parseReply` settles; after settling end stdin and kill if not exited within `exitGraceMs`. Exit before a reply → `{ error: refused, detail: 'exited <code>' }`; spawn error → `{ error: notFound, detail: err.message }`; `timeoutMs` → kill, `{ error: timeout }`; `signal` abort → kill, `{ error: 'cancelled' }`.

- [ ] **Step 1: Write the fixture** `test/fixtures/fake-claude.mjs`: exits 0 at once unless `process.argv.includes('-p')` (so `node --test test/` skips it); appends `{ argv, cwd, entry: env.CLAUDE_CODE_ENTRYPOINT, runAsNode: env.ELECTRON_RUN_AS_NODE ?? null }` as JSON to `env.FAKE_CLAUDE_OUT` if set; reads stdin lines; mode `env.FAKE_CLAUDE_MODE`:
  - `answer` (default): replies to `init` with success; replies to `sq` with `response.response = "A:" + question + "|h" + (history?.length ?? 0)`; prints a `{"type":"system"}` noise line first.
  - `null` → `response: null`; `error` → `subtype: "error", error: "Unknown subtype"`; `noinit` → never answers `init`, answers `sq`; `exit` → exits 3 on `sq`; `hang` → answers nothing and stays alive; `split` → writes the `sq` reply in two chunks 20 ms apart.
  - After replying, stays alive until stdin ends (then exits 0), except `hang`.
- [ ] **Step 2: Write the failing tests**

```js
const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-claude.mjs');
const exe = { file: process.execPath, args: [FIX] };
const run = (mode, extra = {}) => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hud-side-')), 'out.jsonl');
  const env = { ...process.env, FAKE_CLAUDE_MODE: mode, FAKE_CLAUDE_OUT: out, ELECTRON_RUN_AS_NODE: '1' };
  return askSide({ exe, sessionId: 's1', cwd: os.tmpdir(), question: 'q?', env: childEnv(env), initFallbackMs: 200, exitGraceMs: 500, ...extra })
    .then((r) => ({ r, calls: fs.existsSync(out) ? fs.readFileSync(out, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [] }));
};

test('askSide: answer, with history; the child is marked and has no ELECTRON_RUN_AS_NODE', async () => {
  const { r, calls } = await run('answer', { history: [{ question: 'a', response: 'b' }], model: 'claude-opus-5-5' });
  assert.deepEqual(r, { answer: 'A:q?|h1' });
  assert.equal(calls[0].entry, 'agent-hud-side');
  assert.equal(calls[0].runAsNode, null);
  assert.ok(calls[0].argv.includes('--no-session-persistence') && calls[0].argv.includes('claude-opus-5-5'));
});
test('askSide: null answer -> noAnswer', async () => assert.equal((await run('null')).r.error, SIDE_ERRORS.noAnswer));
test('askSide: error subtype -> refused, detail kept', async () => assert.deepEqual((await run('error')).r, { error: SIDE_ERRORS.refused, detail: 'Unknown subtype' }));
test('askSide: no init reply -> asks after the fallback', async () => assert.equal((await run('noinit')).r.answer, 'A:q?|h0'));
test('askSide: reply split across chunks', async () => assert.equal((await run('split')).r.answer, 'A:q?|h0'));
test('askSide: exits before replying -> refused', async () => assert.equal((await run('exit')).r.error, SIDE_ERRORS.refused));
test('askSide: hang -> timeout, child killed', async () => assert.equal((await run('hang', { timeoutMs: 400 })).r.error, SIDE_ERRORS.timeout));
test('askSide: missing exe -> notFound', async () => assert.equal((await askSide({ exe: null, sessionId: 's', cwd: '.', question: 'q', env: {} })).error, SIDE_ERRORS.notFound));
test('askSide: abort mid-ask kills the child (HUD quitting)', async () => {
  const ac = new AbortController();
  const p = run('hang', { signal: ac.signal });
  setTimeout(() => ac.abort(), 150);
  assert.equal((await p).r.error, 'cancelled');
});
```

- [ ] **Step 3: Run** `node --test test/side-ask-process.test.js` → FAIL.
- [ ] **Step 4: Implement `askSide`** in `src/main/side-ask.js` as described (one `settle` guard; clear every timer on settle).
- [ ] **Step 5: Run** `npm test` → PASS (and the fixture is not counted as a failing test).
- [ ] **Step 6: Commit** — `git commit -m "feat: askSide speaks the side_question request to a resumed, non-persisted claude"`

---

### Task 4: The side-question log

**Files:**
- Create: `src/main/side-log.js`
- Test: `test/side-log.test.js`

**Interfaces:**
- Produces: `createSideLog({ dir, now = Date.now, fs = nodeFs, newId = () => 'h' + randomUUID().slice(0, 12) })` returning:
  - `validId(sessionId) -> boolean` — `/^[A-Za-z0-9-]{8,64}$/` (also exported standalone as `validSessionId`).
  - `list(sessionId) -> Entry[]` (oldest first; bad lines skipped; cached after first read)
  - `add(sessionId, { source, question, response = null, error, at }) -> Entry | null` (`at` defaults to `now()`; invalid id → `null`, nothing written)
  - `remove(sessionId, entryId) -> boolean` (rewrites the file)
  - `importVscode(items: { sessionId, question, response, updatedAt }[]) -> string[]` — session ids that got new entries. Entry id `'v' + sha1(sessionId + '\n' + question + '\n' + response).slice(0, 16)`; skipped when that id is already in the log. Within one thread's batch, the last item uses `updatedAt` as `at` when it is a finite number, the rest `now()`.
  - `history(sessionId, n = 10) -> { question, response }[]` — last `n` entries with a string response, oldest first.
  - `count(sessionId) -> number`
- `Entry = { id, at, source, question, response, error? }`.

- [ ] **Step 1: Write the failing tests** (temp dir per test)

```js
test('add/list round-trip, JSON Lines on disk, cache survives a new instance', () => { /* add two, list -> both oldest first; new createSideLog on same dir lists the same two; file has 2 lines */ });
test('importVscode dedupes by content hash and reports changed sessions', () => {
  const log = createSideLog({ dir, now: () => 50 });
  const it = { sessionId: 'af479eec-aaaa', question: 'q', response: 'r', updatedAt: 40 };
  assert.deepEqual(log.importVscode([it]), ['af479eec-aaaa']);
  assert.deepEqual(log.importVscode([it]), []);
  const [e] = log.list('af479eec-aaaa');
  assert.equal(e.source, 'vscode'); assert.equal(e.at, 40); assert.match(e.id, /^v[0-9a-f]{16}$/);
});
test('history: last 10 answered, oldest first, errors skipped', () => { /* 12 answered + 1 error -> 10 items, first is #3 */ });
test('remove rewrites the file without the entry', () => { /* add a, b; remove a; new instance lists only b */ });
test('hostile or malformed session ids never touch the disk', () => {
  for (const id of ['..\\..\\x', '', 'a/b', 'x'.repeat(65), 'short']) {
    assert.equal(log.add(id, { source: 'hud', question: 'q', response: 'r' }), null);
  }
  assert.deepEqual(log.importVscode([{ sessionId: '..\\evil', question: 'q', response: 'r' }]), []);
  assert.deepEqual(fs.readdirSync(dir), []);
});
test('a corrupt line is skipped, the rest still listed', () => { /* write a file with one bad line between two good ones */ });
```

  (Fill each commented test with its asserts as stated; no test may be left as a comment.)

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** `mkdirSync(dir, { recursive: true })` on first write only. **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: per-chat side-question log (JSON Lines, VS Code dedupe, history)"`

---

### Task 5: Reading VS Code's side threads

**Files:**
- Create: `src/main/vscode-threads.js`
- Test: `test/vscode-threads.test.js`, fixture JSON inline in the test

**Interfaces:**
- Produces:
  - `extractThreads(value: string) -> { found: number, items: { sessionId, question, response, updatedAt }[] }` — parse `value`; walk objects/arrays; any string that starts with `{` or `[` is parsed and walked; every object with an object-valued `sideQuestionThreads` adds 1 to `found` and yields its threads: key → `sessionId` = text before the first space; entries with `kind === 'answer'` and string `question`/`response`; `updatedAt` from the thread. Never throws (bad JSON → `{ found: 0, items: [] }`).
  - `createVscodeReader({ root, listDbs, statMtime, openDb, failLimit = 3 }) -> { pass(): Promise<{ items, healthy }> }`
    - defaults: `listDbs` = `<root>\*\state.vscdb` that exist; `statMtime` = `fs.statSync(p).mtimeMs`; `openDb(p)` = `const { DatabaseSync } = await import('node:sqlite'); new DatabaseSync(p, { readOnly: true })`, query `SELECT value FROM ItemTable WHERE value LIKE '%sideQuestionThreads%'`, close, return `string[]`.
    - skip a db whose mtime equals the last successful pass's mtime for it.
    - a db whose open/query throws: mtime not recorded (re-read next pass); its consecutive-failure count goes up; reset on success.
    - `healthy === false` when any db reached `failLimit` consecutive failures, or any matched row in this pass gave `found === 0`; otherwise `true`. A db with no matching rows is healthy.
  - `VSCODE_STORAGE(appData) -> string` = `<appData>\Code\User\workspaceStorage`.

- [ ] **Step 1: Write the failing tests**

```js
const panelState = (threads) => JSON.stringify({ isFullEditor: false, sessionID: 'af479eec-1111', sideQuestionThreads: threads });
const editorPart = (inner) => JSON.stringify({ editorpart: { state: { serializedGrid: { root: { data: [{ data: { editors: [{ value: JSON.stringify({ state: inner }) }] } }] } } } } });
const THREADS = { 'af479eec-1111 9ped11': { updatedAt: 1795169700000, entries: [
  { kind: 'answer', question: 'what file are we in?', response: 'You are in agent-hud.' },
  { kind: 'pending', question: 'x' }, { kind: 'answer', question: 7, response: 'bad' },
] } };

test('extractThreads: the Spike D shape, nested string-encoded state', () => {
  const r = extractThreads(editorPart(panelState(THREADS)));
  assert.equal(r.found, 1);
  assert.deepEqual(r.items, [{ sessionId: 'af479eec-1111', question: 'what file are we in?', response: 'You are in agent-hud.', updatedAt: 1795169700000 }]);
});
test('extractThreads: bad JSON and no threads', () => {
  assert.deepEqual(extractThreads('{nope'), { found: 0, items: [] });
  assert.deepEqual(extractThreads(editorPart(panelState({}))), { found: 1, items: [] });
});
test('reader: mtime gate skips unchanged dbs', async () => { /* fake listDbs ['a'], statMtime 1 -> openDb called once over two passes; mtime 2 -> called again */ });
test('reader: a locked db retries next pass and turns unhealthy only after 3 failures in a row', async () => {
  let fails = 0; const reader = createVscodeReader({ root: 'r', listDbs: () => ['a'], statMtime: () => 1,
    openDb: async () => { if (fails++ < 3) throw new Error('SQLITE_BUSY'); return [editorPart(panelState(THREADS))]; } });
  assert.equal((await reader.pass()).healthy, true);
  assert.equal((await reader.pass()).healthy, true);
  assert.equal((await reader.pass()).healthy, false);
  const ok = await reader.pass();
  assert.equal(ok.healthy, true); assert.equal(ok.items.length, 1);
});
test('reader: a matched row with no parsable threads is unhealthy (shape changed)', async () => { /* openDb returns ['{"x":"sideQuestionThreads"}'] -> healthy false */ });
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (no top-level `node:sqlite` import). **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: read VS Code's /btw threads from state.vscdb (mtime-gated, health)"`

---

### Task 6: The coordinator and the store

**Files:**
- Create: `src/main/side-questions.js`
- Modify: `src/main/store.js` (`createStore` deps, `onEvent`, `computeAgents`, `detail`, return value)
- Test: `test/side-questions.test.js`, `test/store.test.js`

**Interfaces:**
- Consumes: `createSideLog` (Task 4), `withBusyNote` (Task 2); an `ask(opts) -> Promise<{answer}|{error,detail?}>` function injected by main (Task 10).
- Produces: `createSideQuestions({ log, ask, now = Date.now, onChange = () => {}, onError = () => {} })` returning:
  - `start(sessionId, question, ctx: { cwd, model, current }) -> boolean` — `false` (no ask) when the question is blank after trim, the id is invalid, or this chat is already asking. Calls `ask({ sessionId, cwd, model, question: withBusyNote(trimmed, ctx.current, now()), history: log.history(sessionId) })`; on settle `log.add(sessionId, { source: 'hud', question: trimmed, response: r.answer ?? null, error: r.error, at: startedAt })`, clears asking, sets the dot unless `viewing === sessionId`, calls `onChange()`. A rejected `ask` is treated as `{ error: SIDE_ERRORS.refused }`. A result with `detail` calls `onError(\`side question \${sessionId}: \${detail}\`)` (the raw reason reaches the debug log; the user sees `error`).
  - `retry(sessionId, entryId, ctx) -> boolean` — the entry must have `error`; removes it and `start`s its question.
  - `asking(sessionId) -> { question, at } | null`
  - `dot(sessionId) -> boolean`; `setViewing(sessionId | null)` — clears that chat's dot.
  - `tab(sessionId) -> 'now' | 'side'`; `setTab(sessionId, tab)` (anything but `'side'` → `'now'`).
  - `requestFocus(sessionId)` — sets tab `'side'` and `focusAsk = now()` for that chat.
  - `importVscode(items)` → `log.importVscode`; `onChange()` when it changed anything (never sets dots).
  - `setHealthy(bool)` (`onChange()` when it flips)
  - `stopAll()` — aborts every in-flight ask (pass an `AbortSignal` in `ask` opts as `signal`).
  - `view(sessionId) -> { tab, count, dot, asking, entries, healthy, focusAsk }` — `entries` = newest 50 of `log.list`, oldest first.
- Store: `createStore({ ..., side = null })`.
  - `onEvent`: keep `s.transcript = raw.transcript_path` when it is a string.
  - `transcriptOf(id) -> string | null` (new in the return value).
  - each agent gets `sideDot: source === 'claude' && !!side?.dot(id)`.
  - `detail(id).side` = `side.view(id)` for Claude chats, `null` for Codex or without `side`.

- [ ] **Step 1: Write the failing tests** (`test/side-questions.test.js`, a real `createSideLog` in a temp dir, a fake `ask` returning a controllable promise)

```js
test('one ask per chat; blank and invalid ignored; the answer is logged with the plain question', async () => {
  const d = deferred(); const asks = [];
  const sq = createSideQuestions({ log, ask: (o) => { asks.push(o); return d.promise; }, now: () => 1000 });
  assert.equal(sq.start(ID, '   ', {}), false);
  assert.equal(sq.start('bad/id', 'q', {}), false);
  assert.equal(sq.start(ID, ' why? ', { cwd: 'c:\\p', model: 'm', current: { doing: 'running x', startedAt: 0 } }), true);
  assert.equal(sq.start(ID, 'again', {}), false);
  assert.match(asks[0].question, /^why\?\n\n\(Agent HUD note: this chat is still working right now\. Current step: running x, for 1s\./);
  assert.deepEqual(sq.asking(ID), { question: 'why?', at: 1000 });
  d.resolve({ answer: 'because' }); await tick();
  assert.equal(sq.asking(ID), null);
  assert.deepEqual(log.list(ID).map((e) => [e.source, e.question, e.response]), [['hud', 'why?', 'because']]);
});
test('dot: set when not viewing, not when viewing; viewing clears it; VS Code imports never set it', async () => { /* … */ });
test('history from the log goes with the ask', async () => { /* log two answered entries first -> asks[0].history has both */ });
test('retry removes the error entry and asks its question again', async () => { /* … */ });
test('requestFocus switches to the side tab and stamps focusAsk', () => { /* … */ });
test('view: newest 50, oldest first, with tab, count, dot, asking, healthy', () => { /* 55 entries -> 50, count 55 */ });
test('the chat ending mid-ask still logs the answer and does not throw', async () => { /* resolve after nothing else references the chat */ });
test('stopAll aborts in-flight asks (signal aborted)', () => { /* asks[0].signal.aborted === true after stopAll */ });
```

  In `test/store.test.js`:

```js
test('side: sideDot on Claude agents only; detail.side for Claude, null for Codex; transcriptOf from hooks', () => {
  const side = { dot: (id) => id === 's1' || id === 'c1', view: (id) => ({ tab: 'now', id }) };
  /* createStore({ engine, queue, now, side }); setSessions([S('s1'), S('c1', { source: 'codex' })]);
     onEvent(ev('s1', 'UserPromptSubmit', 1, { raw: { transcript_path: 'C:\\t\\s1.jsonl' } }));
     assert agents s1.sideDot true, c1.sideDot false; detail('s1').side.id === 's1'; detail('c1').side === null;
     transcriptOf('s1') === 'C:\\t\\s1.jsonl' */
});
```

  (Every `/* … */` above is to be written out with the asserts its title states.)

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** `side-questions.js` and the store changes. **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: side-question coordinator (asking, dots, tabs, view) wired into the store"`

---

### Task 7: Answer rendering (safe Markdown subset)

**Files:**
- Create: `src/renderer/side-md.js`
- Test: `test/side-md.test.js`

**Interfaces:**
- Consumes: `esc` from `src/renderer/cards.js`.
- Produces: `renderAnswer(text) -> string` — escape first, then: fenced ``` blocks → `<pre><code>…</code></pre>`; blank-line-separated paragraphs → `<p>`; consecutive `- `/`* ` lines → `<ul><li>`; `1. ` lines → `<ol><li>`; inline `` `x` `` → `<code>`; `**x**` → `<b>`. Nothing else becomes markup (no links, images, raw HTML). Non-string → `''`.

- [ ] **Step 1: Failing tests**

```js
test('bold, code, lists, paragraphs, fences', () => {
  assert.equal(renderAnswer('**Yes**: run `npm test`.'), '<p><b>Yes</b>: run <code>npm test</code>.</p>');
  assert.equal(renderAnswer('a\n\nb'), '<p>a</p><p>b</p>');
  assert.equal(renderAnswer('- one\n- two'), '<ul><li>one</li><li>two</li></ul>');
  assert.equal(renderAnswer('1. one\n2. two'), '<ol><li>one</li><li>two</li></ol>');
  assert.equal(renderAnswer('```\n<b>x</b>\n```'), '<pre><code>&lt;b&gt;x&lt;/b&gt;</code></pre>');
});
test('HTML, links and images stay text', () => {
  const h = renderAnswer('<img src=x onerror=alert(1)> [a](javascript:x) ![i](y)');
  assert.ok(!h.includes('<img') && !h.includes('<a') && h.includes('&lt;img'));
});
test('non-strings render nothing', () => { assert.equal(renderAnswer(null), ''); assert.equal(renderAnswer(42), ''); });
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: safe Markdown subset for side answers"`

---

### Task 8: The Side questions tab (render)

**Files:**
- Create: `src/renderer/side-tab.js`
- Modify: `src/renderer/panel.js` (`renderPanel`), `src/renderer/panel.css`
- Test: `test/panel-render.test.js`

**Interfaces:**
- Consumes: `detail.side` (Task 6 `view` shape), `renderAnswer` (Task 7), `esc`, `fmtDuration`.
- Produces:
  - `sideWhen(at, nowMs) -> string` — `now` under 60 s; `<fmtDuration> ago` under 24 h; else `d Mon` (e.g. `19 Nov`, English month abbreviations, no locale call).
  - `renderTabs(side) -> string` — `<div class="tabs" data-key="tabs">` with two buttons `data-act="tab" data-tab="now|side"`, `role="tab"`, `aria-selected`; the side one reads `Side questions` plus ` <span class="n">N</span>` when `count > 0`.
  - `renderSideTab(side, display, nowMs) -> string` — per §5.2: `.thread` (entries oldest first: `.qa` > `.qa-q` (`.q` “question”, `.meta` with `<span class="tag hud|vsc">HUD|VS Code</span>` + `sideWhen`), then `.qa-a` with `renderAnswer(response)`, or `.qa-a.err` with the error text + `.qa-acts` buttons `data-act="side-retry" data-entry` (**try again**) and `data-act="open"` (**open window ↗**); answered entries get `data-act="side-copy" data-entry` (**copy**)); the pending ask as a last `.qa` with `.qa-a.wait` `thinking<span class="dots"></span>`; the empty line when no entries and not asking; the unhealthy line when `healthy === false`; the ask box `<div class="ask" data-key="side-ask"><input data-side-ask …><button class="btn gold" data-act="side-ask">Ask</button></div>`, input `disabled` + placeholder `Waiting for the answer…` while asking, else `Ask a follow-up…` (entries exist) or `Ask <display> on the side…`.
  - `renderPanel(detail, nowMs)`: when `detail.side` is non-null, renders `renderTabs` after the header, then either today's details body (tab `now`) or `renderSideTab` (tab `side`), then the footer in both. `detail.side === null` → exactly today's markup.
- CSS: add to `panel.css` the classes `.tabs .tab .n .thread .qa .qa-q .q .meta .qa-a (.wait .err) .qa-acts .tag (.hud .vsc) .ask .dots::after`, taking values from Global Constraints and the mockup (`.superpowers/brainstorm/767-1795169853/content/side-questions-layout.html`, option B): thread `max-height: 300px; overflow: auto`; answer `font-size: .76rem; line-height: 1.38; max-height: 9.5em; overflow: auto; user-select: text`; question `font-family: 'IM Fell English'; font-style: italic; font-size: .86rem`; tab underline `2px solid var(--gold)` on the selected tab; `.dots::after { content: '…' }` (panel.css has no dots rule today).

- [ ] **Step 1: Failing tests** (extend `test/panel-render.test.js`)

```js
const side = (o = {}) => ({ tab: 'side', count: 2, dot: false, asking: null, healthy: true, focusAsk: null, entries: [
  { id: 'v1', at: NOW - 3 * 3600000, source: 'vscode', question: 'what file?', response: '**agent-hud**' },
  { id: 'h1', at: NOW - 120000, source: 'hud', question: XSS, response: null, error: 'Claude gave no answer' },
], ...o });

test('no side (Codex or none): no tabs, details as today', () => {
  assert.ok(!renderPanel(detail(), NOW).includes('class="tabs"'));
});
test('Now tab: tabs with the count, details body', () => {
  const h = renderPanel(detail({ side: side({ tab: 'now' }) }), NOW);
  assert.match(h, /data-tab="side"[^>]*>Side questions <span class="n">2<\/span>/);
  assert.match(h, /Recent steps/);
});
test('Side tab: thread, tags, markdown, error with retry, escaped question, ask box', () => {
  const h = renderPanel(detail({ side: side() }), NOW);
  assert.ok(!h.includes('Recent steps'));
  assert.match(h, /<span class="tag vsc">VS Code<\/span> 3h ago/);
  assert.match(h, /<b>agent-hud<\/b>/);
  assert.match(h, /class="qa-a err">Claude gave no answer/);
  assert.match(h, /data-act="side-retry" data-entry="h1"/);
  assert.ok(h.includes('&lt;img') && !h.includes('<img'));
  assert.match(h, /placeholder="Ask a follow-up…"/);
  assert.match(h, /data-act="open"/); // footer stays
});
test('asking: thinking row, disabled box', () => {
  const h = renderPanel(detail({ side: side({ asking: { question: 'is it safe?', at: NOW } }) }), NOW);
  assert.match(h, /is it safe\?[^]*class="qa-a wait">thinking/);
  assert.match(h, /<input[^>]*data-side-ask[^>]*disabled[^>]*placeholder="Waiting for the answer…"/);
});
test('empty and unhealthy lines', () => {
  const h = renderPanel(detail({ display: 'arsenal', side: side({ count: 0, entries: [], healthy: false }) }), NOW);
  assert.match(h, /None yet\. Ask one, or use \/btw in VS Code: those show up here too\./);
  assert.match(h, /Can't read VS Code side questions right now\./);
  assert.match(h, /placeholder="Ask arsenal on the side…"/);
});
test('sideWhen', () => {
  assert.equal(sideWhen(NOW - 5000, NOW), 'now');
  assert.equal(sideWhen(NOW - 120000, NOW), '2m ago');
  assert.equal(sideWhen(Date.UTC(2026, 10, 19, 12), Date.UTC(2026, 10, 21, 12)), '19 Nov');
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** `side-tab.js`, the `renderPanel` branch and the CSS. **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: Side questions tab in the details panel"`

---

### Task 9: The tab's interactions (panel boot + preload)

**Files:**
- Modify: `src/renderer/panel.js` (`panelAction`, `bootPanel`), `src/preload-panel.cjs`
- Test: `test/panel-render.test.js` (`panelAction` only; the DOM half is covered by Task 11's hands-on checks)

**Interfaces:**
- Produces (preload `window.panel`): `setTab(id, tab)` → `panel:setTab`; `askSide(id, text)` → `panel:askSide`; `copySide(id, entryId)` → `panel:copySide`; `retrySide(id, entryId)` → `panel:retrySide` (all args stringified).
- `panelAction(act, detail, ds)` adds: `tab` → `{ call: 'setTab', id, tab: ds.tab }`; `side-copy` → `{ call: 'copySide', id, entry: ds.entry }`; `side-retry` → `{ call: 'retrySide', id, entry: ds.entry }`. (`side-ask` stays in `bootPanel`: it reads the input.) The click handler passes `a.tab ?? a.entry` as the second argument.
- `bootPanel` additions:
  - drafts: `Map<sessionId, string>` updated on `input` of `[data-side-ask]`; after each `patch`, a replaced empty input gets its draft back.
  - pointerdown in `[data-side-ask]` → `setInteractive(true)` (same rule as cards.js).
  - Ask (`data-act="side-ask"` click, or Enter without composition in the input): trimmed text non-empty → `call('askSide', detail.id, text)`, clear the draft and the input, `setInteractive(false)`.
  - Escape in the input → blur, `setInteractive(false)`.
  - `detail.side.focusAsk` greater than the last one handled → focus `[data-side-ask]` (if not disabled), then `setInteractive(true)`; remember the value.
  - when the thread's entry count or asking state changed since the last render, scroll `.thread` to its end.
  - switching tab or agent with the input focused → `setInteractive(false)`.

- [ ] **Step 1: Failing test**

```js
test('panelAction: tab, copy and retry name the agent on show', () => {
  const d = { id: 's1' };
  assert.deepEqual(panelAction('tab', d, { tab: 'side' }), { call: 'setTab', id: 's1', tab: 'side' });
  assert.deepEqual(panelAction('side-copy', d, { entry: 'h1' }), { call: 'copySide', id: 's1', entry: 'h1' });
  assert.deepEqual(panelAction('side-retry', d, { entry: 'h1' }), { call: 'retrySide', id: 's1', entry: 'h1' });
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** the preload calls, `panelAction` and the `bootPanel` additions. **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: Side questions tab: ask, Enter/Esc, copy, retry, focus and drafts"`

---

### Task 10: The row's **?** and dot, and main wiring

**Files:**
- Modify: `src/renderer/hud.js` (`renderRow`, boot click), `src/renderer/hud.css`, `src/preload.cjs`, `src/main/main.js`
- Test: `test/hud-render.test.js`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `renderRow`: for a Claude row (`sourceOf(a) === 'claude'`) that is not tucked, a `<button type="button" class="side-q" data-act="side" data-session="<id>" title="Ask on the side" aria-label="Ask <display> on the side">?</button>` placed before the ✕ (shown on `.row:hover`/`:focus-within` like `.hide`, `right: 24px`); when `a.sideDot`, `<span class="side-dot" title="A side answer is ready"></span>` first inside `.mark`. Codex rows: neither.
  - HUD click `side` → `call('askSide', session, rowCentre(row))`; preload `askSide(sessionId, rowY)` → `hud:askSide`.
  - `main.js`:
    - At module level, right before `const store = createStore(…)` (`main.js:111`; the dev `userData` override at `main.js:64-67` has already run): `SIDE_DIR = path.join(app.getPath('userData'), 'side-questions')`, `sideLog = createSideLog({ dir: SIDE_DIR })`, `side = createSideQuestions({ log: sideLog, ask, onChange: () => { push(); pushDetail(); }, onError: (e) => log('side', e) })`; pass `side` into `createStore`. (`push`/`pushDetail` are defined further down; the closure only runs later.)
    - `ask(opts)` = `askSide({ ...opts, exe: claudeExe ? { file: claudeExe } : null, env: childEnv(process.env) })`, `claudeExe = findClaudeExe({ env: process.env, home: os.homedir(), exists })` resolved per ask (cheap; picks up an install made after start).
    - `ctxFor(id)` = `{ cwd: sessionById(id)?.cwd, model, current }`: `model` from `modelFromTranscriptTail` of the last 256 KB of `store.transcriptOf(id) ?? transcriptPathFor(os.homedir(), cwd, id)` (missing file → `null`); `current` = `store.detail(id)?.current` when its `stage` is `thinking` or `working`, else `null`.
    - IPC: `hud:askSide (id, rowY)` → set `anchorRow`, `side.requestFocus(id)`, `apply(userSelect(pick, { id, rowY }, cards))` (select, never toggle closed); `panel:setTab (id, tab)` → `side.setTab`, `pushDetail()`; `panel:askSide (id, text)` → `side.start(id, text, ctxFor(id))`; `panel:copySide (id, entryId)` → `clipboard.writeText(entry.response)`; `panel:retrySide (id, entryId)` → `side.retry(id, entryId, ctxFor(id))`. Ignore ids of Codex sessions.
    - Viewing: in `pushDetailNow`, `side.setViewing(detailId && side.tab(detailId) === 'side' && panel visible ? detailId : null)` before building the detail.
    - VS Code reader: `createVscodeReader({ root: VSCODE_STORAGE(process.env.APPDATA) })`; `readVscode()` = `pass()` → `side.importVscode(items)`, `side.setHealthy(healthy)`, guarded and never overlapping; run once in `start()` and every 30000 ms.
    - Tray: `{ label: 'Open side-question logs', click: () => shell.openPath(<that dir>) }` after the Sounds menu (create the dir first).
    - `quit()`: `side.stopAll()` before exiting.
- CSS (`hud.css`): `.row .side-q` like `.row .hide` (18 × 18, radius 4px) with `background: rgba(79, 103, 135, .35); color: #cfd6e6; font: 700 .72rem/18px 'IM Fell English', Georgia, serif; right: 24px; opacity: 0`, shown at `.75` on `.row:hover`/`.row:focus-within`; `.mark .side-dot { display: inline-block; width: 8px; height: 8px; margin-right: 5px; border-radius: 50%; background: #8fa6c6; box-shadow: 0 0 6px rgba(143, 166, 198, .8) }`; no animation.

- [ ] **Step 1: Failing tests** (`test/hud-render.test.js`)

```js
test('renderRow: ? on Claude rows (not tucked, not Codex), escaped label', () => {
  assert.match(renderRow(agent({ display: XSS })), /class="side-q" data-act="side" data-session="s1" title="Ask on the side" aria-label="Ask &lt;img/);
  assert.ok(!renderRow(agent({ source: 'codex' })).includes('side-q'));
  assert.ok(!renderRow(agent(), { tucked: true }).includes('side-q'));
});
test('renderRow: the dot only when sideDot, inside the mark', () => {
  assert.match(renderRow(agent({ sideDot: true })), /<span class="mark"><span class="side-dot"/);
  assert.ok(!renderRow(agent()).includes('side-dot'));
  assert.ok(!renderRow(agent({ source: 'codex', sideDot: true })).includes('side-dot'));
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** the row, CSS, preload and the `main.js` wiring. **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Run the dev HUD** (`npm run dev`; clear `ELECTRON_RUN_AS_NODE` first — see the memory note) and confirm it starts, the tab shows on a Claude agent, and the debug log has no errors from the reader.
- [ ] **Step 6: Commit** — `git commit -m "feat: ask on the side from a HUD row; main wires the asker, log, VS Code reader and tray"`

---

### Task 11: Hands-on checklist and run

**Files:**
- Modify: `spikes/SPIKES.md` (new section `## Live check - v1.5 side questions`)

- [ ] **Step 1: Write the checklist** — spec §8's six hands-on checks as numbered steps a non-author can run, each with its expected result and a blank result column, all in a throwaway chat in `C:\Consortis_projects\agent-hud-spike`. Add: (7) quit the HUD while a question is out → no `claude.exe` child left (`Get-Process claude`) and no `~/.claude/sessions` file with entrypoint `agent-hud-side`.
- [ ] **Step 2: Run** `npm test` → all pass; record the count.
- [ ] **Step 3: Hand the checklist to the user** to run on the dev HUD (checks 1, 2, 5 need their hands in VS Code and the desktop app); record their results in the table.
- [ ] **Step 4: Commit** — `git commit -m "docs: v1.5 side questions live checklist"`
