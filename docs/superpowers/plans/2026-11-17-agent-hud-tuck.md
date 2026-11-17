# Agent HUD v1.3 — Tuck Idle Chats and Hide with ✕ — Implementation Plan

```
╔═════════════╦══════════════════════════════════════════════╦═════════════╗
║ MARVEL      ║                                              ║  APPROVED   ║
║ COMICS      ║     A M A Z I N G   S P I D E R - M A N      ║   BY THE    ║
║ GROUP       ║                     #50                      ║ COMICS CODE ║
║ 12¢ · 1967  ║                                              ║  AUTHORITY  ║
╠═════════════╩══════════════════════════════════════════════╩═════════════╣
║                                                                          ║
║                " S P I D E R - M A N   N O   M O R E ! "                 ║
║                                                                          ║
║                STAN LEE & JOHN ROMITA  ◆  1967  ◆  TIER 2                ║
║                       a few files, one clear seam                        ║
╟──────────────────────────────────────────────────────────────────────────╢
║  WHY THIS ISSUE                                                          ║
║  The issue where Peter stuffs the suit in a trash can: chats step off    ║
║  the HUD, by an idle rule or a ✕, and come back when they are needed.    ║
╟──────────────────────────────────────────────────────────────────────────╢
║  ROGUES GALLERY                                                          ║
║  ◆ GREEN GOBLIN    a hidden chat asks a question and stays out of sight  ║
║  ◆ SANDMAN         the idle clock rides on shifting busy/idle status     ║
║  ◆ SCORPION        the panel keeps pointing at a row that tucked away    ║
║  ◆ MYSTERIO        "busy" session files for chats that are not working   ║
╚══════════════════════════════════════════════════════════════════════════╝
```

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chats quiet for an hour tuck away under a `N tucked away · show` line, a hover ✕ hides a chat at once, and either comes back when the chat asks something or starts a new turn.

**Architecture:** A pure rule module (`tuck.js`) decides each chat's tuck state; the store applies it and splits the snapshot into `agents` (visible) and `tucked`. The main process owns the ✕ hides' effects on selection and the open/folded state of the tucked list (like `collapsed`); the HUD renderer only draws rows, the ✕ and the tucked line.

**Tech Stack:** Electron 44 (main + sandboxed preload + renderer), plain ES modules, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-17-agent-hud-tuck-design.md`

## Global Constraints

- Tuck after exactly **1 hour** quiet: `TUCK_AFTER_MS = 3_600_000`.
- Stages that may auto-tuck: `idle` and `turn` only. `needs` is never tucked or hidden; `working`/`thinking` never auto-tuck.
- A ✕-hidden chat comes back only on stage `needs` or a new turn: a non-synthetic `UserPromptSubmit` (prompt not starting with `<task-notification>`), or its session file's status going from not-`busy` to `busy`.
- A chat brought back by `needs` loses its ✕ hide for good.
- No ✕ on a row whose stage is `needs`, and none on tucked rows.
- Tucked line copy: `── ${n} tucked away · show ──` folded, `── ${n} tucked away · hide ──` open; shown only when n > 0.
- Empty copy when nothing is visible but chats are tucked: `All quiet — every chat is tucked away.` (otherwise the existing `No agents are running.`).
- Header "N at work" counts visible rows only. Collapsed faces show visible chats only.
- Hides live in memory only (no config changes). The HUD never closes a real chat.
- Every snapshot string still goes through `esc()`; CSP and preload rules unchanged (sender-checked IPC via `fromHud`).

## Review Focus

1. A ✕-hidden chat that then asks for permission must reappear and the panel must pop open on it (Task 2 test: hidden → `needs` → in `agents`; Task 3 relies on the unchanged `autoSelect`).
2. A ✕-hidden chat that keeps running tools must stay hidden; one that gets a real new prompt must return; a `<task-notification>` prompt must not wake it (Task 2 tests).
3. Hiding the row whose panel is open, or folding the tucked list while a tucked chat's panel is open, must close the panel (Task 3 `panelTarget` tests).
4. A chat with no hooks (session file only) that is idle for over an hour must tuck by its file's `statusUpdatedAt`, and must never tuck while its file says `busy` (Task 1 and Task 2 tests).
5. The stage tick must push when a chat crosses the one-hour line with no other event (Task 2 `stageKey` test).

---

### Task 1: The tuck rule and the session file's status time

**Files:**
- Create: `src/main/tuck.js`
- Modify: `src/main/sessions.js` (`toSession`)
- Test: `test/tuck.test.js` (new), `test/sessions.test.js`

**Interfaces:**
- Produces: `TUCK_AFTER_MS` (number); `quietSince({ lastActivityAt, stoppedAt, statusSince, startedAt }) -> number | null` (the latest finite, positive value, else null); `tuckOf({ stage, status, quietSince, hiddenAt, wakeAt }, now, { afterMs = TUCK_AFTER_MS } = {}) -> null | 'hidden' | 'idle'`.
- Produces: sessions gain `statusSince: number | null` (from the file's `statusUpdatedAt`, via `knownTime`).

- [ ] **Step 1: Write the failing tests** in `test/tuck.test.js`:

```js
import test from 'node:test'; import assert from 'node:assert/strict';
import { TUCK_AFTER_MS, quietSince, tuckOf } from '../src/main/tuck.js';
const H = 3_600_000, NOW = 10 * H;
const base = { stage: 'idle', status: 'idle', quietSince: NOW - H, hiddenAt: null, wakeAt: null };

test('TUCK_AFTER_MS is one hour', () => assert.equal(TUCK_AFTER_MS, H));
test('quietSince takes the latest known time and ignores missing ones', () => {
  assert.equal(quietSince({ lastActivityAt: 5, stoppedAt: 9, statusSince: 7, startedAt: 1 }), 9);
  assert.equal(quietSince({ lastActivityAt: null, stoppedAt: undefined, statusSince: 7, startedAt: null }), 7);
  assert.equal(quietSince({}), null);
});
test('idle or turn for a full hour tucks; a minute less does not', () => {
  assert.equal(tuckOf(base, NOW), 'idle');
  assert.equal(tuckOf({ ...base, stage: 'turn' }, NOW), 'idle');
  assert.equal(tuckOf({ ...base, quietSince: NOW - H + 60_000 }, NOW), null);
  assert.equal(tuckOf({ ...base, quietSince: null }, NOW), null);
});
test('working, thinking, needs and a busy session file never auto-tuck', () => {
  for (const stage of ['working', 'thinking', 'needs']) assert.equal(tuckOf({ ...base, stage }, NOW), null);
  assert.equal(tuckOf({ ...base, status: 'busy' }, NOW), null);
});
test('a ✕ hide holds until a wake after it; needs always wins', () => {
  assert.equal(tuckOf({ ...base, stage: 'working', quietSince: NOW, hiddenAt: NOW - 5 }, NOW), 'hidden');
  assert.equal(tuckOf({ ...base, stage: 'working', hiddenAt: NOW - 5, wakeAt: NOW - 9 }, NOW), 'hidden', 'a wake before the hide');
  assert.equal(tuckOf({ ...base, stage: 'working', quietSince: NOW, hiddenAt: NOW - 5, wakeAt: NOW - 1 }, NOW), null);
  assert.equal(tuckOf({ ...base, stage: 'needs', hiddenAt: NOW - 5 }, NOW), null);
});
```

And in `test/sessions.test.js`: `readSessionFiles` on a temp dir (`mkdtempSync`) holding one valid session file with `statusUpdatedAt: 1794810712245` gives `statusSince === 1794810712245`; with `statusUpdatedAt: 0` gives `statusSince === null`.

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/tuck.test.js test/sessions.test.js`
Expected: FAIL (`tuck.js` missing; `statusSince` undefined).

- [ ] **Step 3: Implement** `src/main/tuck.js` (order in `tuckOf`: `needs` → null; a hide with no later wake → `'hidden'`; `idle`/`turn`, status not `busy`, `now - quietSince >= afterMs` → `'idle'`; else null) and add `statusSince: knownTime(o.statusUpdatedAt)` to `toSession`.

- [ ] **Step 4: Run them to see them pass**

Run: `node --test test/tuck.test.js test/sessions.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/tuck.js src/main/sessions.js test/tuck.test.js test/sessions.test.js
git commit -m "feat: tuck rule (one quiet hour, ✕ hides until a wake)"
```

### Task 2: The store applies tucking

**Files:**
- Modify: `src/main/store.js` (`onEvent`, `setSessions`, `computeAgents`, `snapshot`, `stageKey`, new `hide`)
- Test: `test/store.test.js`

**Interfaces:**
- Consumes: Task 1's `quietSince`, `tuckOf`; sessions' `statusSince`.
- Produces: `store.hide(id: string) -> void` (ignored while the chat's stage is `needs`; records `now()`); each AgentView gains `tuck: null | 'hidden' | 'idle'`; `snapshot()` returns `{ agents, tucked, card, next, counts }` where `agents` = views with `tuck === null`, `tucked` = the rest (same order), `counts.total = agents.length`; `stageKey()` includes each chat's tuck state; `detail(id)` still works for tucked chats.
- Wake time per chat (`wakeAt`): set to `ev.at` on a non-synthetic `UserPromptSubmit`; set to `now()` in `setSessions` when a known session's status goes from not-`busy` to `busy`. In `computeAgents`, a chat whose stage is `needs`, or whose `wakeAt` is after its hide, loses the hide. A forgotten session loses its hide.

- [ ] **Step 1: Write the failing tests** (use the file's `setup`, `S`, `ev`; one hour = `3_600_000`):

```js
test('v1.3: a session idle for an hour moves to tucked; counts cover visible rows only', () => {
  const { store, set } = setup(1000);
  store.setSessions([S('s1', { status: 'idle', statusSince: 1000 }), S('s2', { status: 'busy', statusSince: 1000 })]);
  set(1000 + 3_600_000);
  const snap = store.snapshot();
  assert.deepEqual(snap.agents.map((a) => a.id), ['s2']);
  assert.deepEqual(snap.tucked.map((a) => [a.id, a.tuck]), [['s1', 'idle']]);
  assert.equal(snap.counts.total, 1);
});
test('v1.3: a ✕-hidden working chat stays hidden through tool events; a real prompt brings it back, a task-notification does not', () => {
  const { store, set } = setup(1000);
  store.setSessions([S('s1', { status: 'busy' })]);
  store.onEvent(ev('s1', 'PreToolUse', 1000, { toolName: 'Read', toolInput: { file_path: 'a.js' } }));
  store.hide('s1');
  set(2000); store.onEvent(ev('s1', 'PreToolUse', 2000, { toolName: 'Read', toolInput: { file_path: 'b.js' } }));
  assert.equal(store.snapshot().tucked[0].tuck, 'hidden');
  set(3000); store.onEvent(ev('s1', 'UserPromptSubmit', 3000, { raw: { prompt: '<task-notification>done</task-notification>' } }));
  assert.equal(store.snapshot().tucked.length, 1);
  set(4000); store.onEvent(ev('s1', 'UserPromptSubmit', 4000, { raw: { prompt: 'next thing' } }));
  assert.deepEqual(store.snapshot().agents.map((a) => a.id), ['s1']);
});
test('v1.3: a hidden chat that asks comes back and stays back after the question goes; hide is ignored while it asks', () => {
  const { queue, store } = setup();
  store.setSessions([S('s1')]);
  store.hide('s1');
  queue.add({ id: 'a', sessionId: 's1', kind: 'permission', payload: { tool_name: 'Bash' } });
  assert.deepEqual(store.snapshot().agents.map((a) => a.id), ['s1']);
  store.hide('s1');
  assert.equal(store.snapshot().tucked.length, 0, 'no hiding a chat that is asking');
  queue.answer('a', { decision: 'allow' });
  assert.equal(store.snapshot().tucked.length, 0, 'the old hide is gone for good');
});
test('v1.3: a hidden chat without hooks wakes when its session file turns busy', () => {
  const { store, set } = setup(1000);
  store.setSessions([S('s1', { status: 'idle' })]);
  store.hide('s1');
  assert.equal(store.snapshot().tucked.length, 1);
  set(2000); store.setSessions([S('s1', { status: 'busy' })]);
  assert.deepEqual(store.snapshot().agents.map((a) => a.id), ['s1']);
});
test('v1.3: stageKey changes when a chat crosses the one-hour line with no event', () => {
  const { store, set } = setup(1000);
  store.setSessions([S('s1', { status: 'idle', statusSince: 1000 })]);
  const before = store.stageKey();
  set(1000 + 3_600_000);
  assert.notEqual(store.stageKey(), before);
});
```

Before running, check `queue.answer`'s real signature in `src/main/queue.js` and use it (the test needs the card gone, by any real path).

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/store.test.js`
Expected: FAIL (`store.hide` is not a function / no `tucked`).

- [ ] **Step 3: Implement** in `src/main/store.js` as the Interfaces block says: a `hidden` Map (id → hiddenAt), `s.wakeAt`, `tuck` on each view from `tuckOf({ stage, status: sess.status, quietSince: quietSince({ lastActivityAt: s.lastActivityAt, stoppedAt: s.stoppedAt, statusSince: sess.statusSince, startedAt: sess.startedAt }), hiddenAt, wakeAt: s.wakeAt ?? null }, t)`, the split in `snapshot()`, and `:${a.tuck ?? ''}` appended per chat in `stageKey()`.

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: PASS, no existing test broken (existing `counts` assertions have no tucked chats).

- [ ] **Step 5: Commit**

```bash
git add src/main/store.js test/store.test.js
git commit -m "feat: store tucks quiet chats and keeps ✕ hides until a wake"
```

### Task 3: Main process — hide, the tucked list's open state, panel rules

**Files:**
- Modify: `src/main/wiring.js` (`panelTarget`), `src/main/main.js` (state, IPC, `hudState`, snapshot push), `src/preload.cjs`
- Test: `test/wiring.test.js`

**Interfaces:**
- Consumes: Task 2's `store.hide`, `snapshot().tucked`.
- Produces: `panelTarget(selectedId, snapshot, { collapsed, visible, hasCard, tuckOpen })` — a chat in `snapshot.tucked` is a target only when `tuckOpen` is true (rules for `agents` unchanged). IPC `hud:hideAgent(id: string)` and `hud:showTucked(on: boolean)`; `window.hud.hideAgent(id)`, `window.hud.showTucked(on)`. The snapshot sent to the HUD carries `tuckOpen: boolean` and the full `tucked` list.

- [ ] **Step 1: Write the failing test** in `test/wiring.test.js`:

```js
test('v1.3: a tucked chat is a panel target only while the tucked list is open', () => {
  const snap = { agents: [{ id: 'a' }], tucked: [{ id: 't' }] };
  const hud = { collapsed: false, visible: true, hasCard: false };
  assert.equal(panelTarget('t', snap, { ...hud, tuckOpen: true }), 't');
  assert.equal(panelTarget('t', snap, { ...hud, tuckOpen: false }), null, 'folding the list closes its panel');
  assert.equal(panelTarget('a', snap, { ...hud, tuckOpen: false }), 'a');
  assert.equal(panelTarget('gone', snap, { ...hud, tuckOpen: true }), null, 'a ✕-hidden chat with the list folded, or one that left');
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test test/wiring.test.js`
Expected: FAIL on the first assertion.

- [ ] **Step 3: Implement**
  - `panelTarget`: also search `snapshot.tucked` when `tuckOpen`.
  - `main.js`: `let tuckOpen = false;` added to what `hudState()` returns; `fromHud('hud:hideAgent', …)` → `store.hide(String(id))`, then `select(null)` if it was `pick.selected`, then `push()`; `fromHud('hud:showTucked', …)` → `tuckOpen = !!on; push();`; the `win.webContents.send('snapshot', …)` object adds `tuckOpen`.
  - `preload.cjs`: `hideAgent: (id) => ipcRenderer.send('hud:hideAgent', String(id))`, `showTucked: (on) => ipcRenderer.send('hud:showTucked', !!on)`.

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/wiring.js src/main/main.js src/preload.cjs test/wiring.test.js
git commit -m "feat: hide and tucked-list IPC; panel follows what is on screen"
```

### Task 4: HUD renderer — ✕, the tucked line and tucked rows

**Files:**
- Modify: `src/renderer/hud.js` (`renderRow`, `renderParty`, click handler in `boot`), `src/renderer/hud.css`
- Test: `test/hud-render.test.js`

**Interfaces:**
- Consumes: snapshot `{ agents, tucked, tuckOpen }` (Task 3); `api.hideAgent`, `api.showTucked`.
- Produces: `renderRow(agent, { ask, selected = false, tucked = false })` — a `<button type="button" class="hide" data-act="hide" data-session="…" aria-label="Hide … from the HUD">✕</button>` unless the row's mood is `needs` or `tucked` is true; tucked rows get class `tucked`. `renderParty` adds, after the rows, `<button type="button" class="tuck-line" data-key="tuck" data-act="tucked" aria-expanded="…">` with the Global Constraints copy, then (when `tuckOpen`) a `data-key="tucked"` `data-deep` block of tucked rows.

- [ ] **Step 1: Write the failing tests** (use the file's `agent()` helper):

```js
test('v1.3: rows carry a ✕ except when asking or tucked; it is escaped and names the chat', () => {
  assert.match(renderRow(agent({ id: 'x"1', display: 'arsenal · e0' })), /data-act="hide" data-session="x&quot;1"[^>]*aria-label="Hide arsenal · e0 from the HUD"/);
  assert.doesNotMatch(renderRow(agent({ mood: 'needs' })), /data-act="hide"/);
  const t = renderRow(agent(), { tucked: true });
  assert.doesNotMatch(t, /data-act="hide"/);
  assert.match(t, /class="row [^"]*\btucked\b/);
});
test('v1.3: the tucked line shows the count and folds/unfolds; tucked rows only when open', () => {
  const snap = { agents: [agent({ id: 'a' })], tucked: [agent({ id: 't1' }), agent({ id: 't2' })], counts: { total: 1, needs: 0 } };
  const folded = renderParty({ ...snap, tuckOpen: false });
  assert.match(folded, /data-act="tucked" aria-expanded="false">── 2 tucked away · show ──/);
  assert.doesNotMatch(folded, /row:t1/);
  const open = renderParty({ ...snap, tuckOpen: true });
  assert.match(open, /aria-expanded="true">── 2 tucked away · hide ──/);
  assert.match(open, /data-key="row:t1"/);
  assert.doesNotMatch(renderParty({ ...snap, tucked: [] }), /tuck-line/);
});
test('v1.3: nothing visible but chats tucked → "All quiet — every chat is tucked away."', () => {
  assert.match(renderParty({ agents: [], tucked: [agent({ id: 't' })], counts: { total: 0, needs: 0 } }), /All quiet — every chat is tucked away\./);
  assert.match(renderParty({ agents: [], tucked: [], counts: { total: 0, needs: 0 } }), /No agents are running\./);
});
```

(If `agent()` sets mood through another field than `mood`, adapt the `needs` case to the helper's real field — the rule is "no ✕ while `moodOf(a) === 'needs'`".)

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/hud-render.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement** the markup above; in `boot`'s click handler add `case 'hide': call('hideAgent', el.dataset.session)` and `case 'tucked': call('showTucked', el.getAttribute('aria-expanded') !== 'true')`. CSS in `hud.css`, in the file's existing tokens: `.row .hide` hidden until `.row:hover` / `:focus-within` (keyboard reachable via `:focus-visible`), small and muted; `.row.tucked` dimmed like `.row.idle`; `.tuck-line` a quiet full-width text button. No new animation.

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/hud.js src/renderer/hud.css test/hud-render.test.js
git commit -m "feat: ✕ on rows and the tucked-away line in the HUD"
```

### Task 5: See it working, then rebuild the installer

**Files:** none changed unless the check finds a defect.

- [ ] **Step 1: Run the dev HUD** — `node scripts/dev.mjs --quit` first if one runs, then `npm run dev` (spike-folder settings only; never the user's global settings).
- [ ] **Step 2: Check by eye**, with the user's chats as they are: a chat idle over an hour sits under the tucked line; `show` lists it dimmed and its panel opens; `hide` folds the list and closes that panel; hovering a row shows ✕ and clicking it hides the row (and its panel, if open). Do not drive the user's desktop with scripted clicks.
- [ ] **Step 3: Rebuild** — `node scripts/dev.mjs --quit`, then `npm run build:win`; confirm `dist/Agent HUD Setup 0.1.0.exe` has today's time and `grep -c "tucked away" dist/win-unpacked/resources/app.asar` prints 1 or more.
