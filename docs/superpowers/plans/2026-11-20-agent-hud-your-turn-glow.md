# "Your turn" Glow Implementation Plan

🕷️

```
╔═════════════╦══════════════════════════════════════════════╦═════════════╗
║ MARVEL      ║                                              ║  APPROVED   ║
║ COMICS      ║     A M A Z I N G   S P I D E R - M A N      ║   BY THE    ║
║ GROUP       ║                  #229 - 230                  ║ COMICS CODE ║
║ 60¢ · 1982  ║                                              ║  AUTHORITY  ║
╠═════════════╩══════════════════════════════════════════════╩═════════════╣
║                                                                          ║
║      " N O T H I N G  C A N  S T O P  T H E  J U G G E R N A U T "       ║
║                                                                          ║
║                     ROGER STERN  ◆  1982  ◆  TIER 2                      ║
║                       a few files, one clear seam                        ║
╟──────────────────────────────────────────────────────────────────────────╢
║  WHY THIS ISSUE                                                          ║
║  A small two-parter: a finish flash that always plays, and a quiet glow  ║
║  that waits for you. The stubborn blocker is the keyed patch that swaps  ║
║  a row out from under its flash.                                         ║
╟──────────────────────────────────────────────────────────────────────────╢
║  ROGUES GALLERY                                                          ║
║  ◆ SANDMAN        a row redrawn mid-flash loses its class                ║
║  ◆ MYSTERIO       Node tests render HTML; no DOM proves the              ║
║                   flash survives a redraw (live check does)              ║
║  ◆ CHAMELEON      reading the chat in its own window is not              ║
║                   "seen": only the HUD and panel can tell                ║
║  ◆ GREEN GOBLIN   a glow that never clears and turns into                ║
║                   noise, so every way out must clear it                  ║
╚══════════════════════════════════════════════════════════════════════════╝
```

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A finished chat's row always flashes (rows and collapsed faces), then stays softly lit until the user has seen it.

**Architecture:** The store marks an agent `unseen` when its stage changes into `turn` and clears it on leaving `turn`, on `markSeen(id)`, and on ✕. Main calls `markSeen` for the agent whose details the panel shows, on every push. The renderer draws `unseen` into the row and face HTML. It keeps the transient flash in a set that it re-applies after every `patch()`.

**Tech Stack:** Electron 44, ES modules, `node --test` (Node 20).

**Spec:** `docs/superpowers/specs/2026-11-20-agent-hud-your-turn-glow-design.md`

## Global Constraints

- Snapshot field: `agents[].unseen` (boolean). CSS class on rows and faces: `unseen`. The flash class stays `glow-done`.
- `unseen` is set only on a stage *change* into `turn`. The first sighting of a chat already in `turn` is not unseen (M8). It lives in memory only.
- Clears: leaving `turn`; `markSeen(id)`; `hide(id)` (✕).
- Tucked rows never carry `unseen`. A row carries it only while in "Your turn" (`inTurn`).
- No infinite animation on `.row.unseen` / `.face.unseen`; nothing loop-animates `box-shadow` (M4). Respect reduced motion.
- Nothing time-based enters a row's HTML (I1): the flash is a DOM class, never rendered.
- Sound, the "Your turn" chip and the pennant are unchanged.
- Test names for this feature carry the ID `v1.7`.

## Review Focus

1. **A chat finishes while its own details are open:** it flashes, never stays lit (Task 3, main's push path).
2. **✕ a lit row, then the chat starts and finishes a new turn:** it comes back and lights again. ✕ alone never leaves a stale `unseen` that shows after the chat un-tucks for some other reason (Task 1).
3. **A row redrawn mid-flash** (a helper flips it to Working and back): no `glow-done` left stuck on a row after the flash, with or without reduced motion (Task 2).
4. **Collapse or expand mid-flash:** no throw; the flash moves to whichever element now represents the chat (Task 2).
5. **HUD start with chats in "Your turn":** nothing is lit and nothing flashes; a renderer reload keeps what the store has lit (spec, "Claude's calls"), without flashing (Tasks 1 and 2).

---

### Task 1: The store knows which finished chats are unseen

**Files:** Modify `src/main/store.js` (`computeAgents`, `hide`, new `markSeen`, the returned API). Test `test/store.test.js`.

**Interfaces:**
- Produces: `agents[].unseen: boolean` (also on `tucked[]` entries, always `false` there is fine); `store.markSeen(id) -> boolean` (true when it cleared a flag). `store.hide(id)` also clears it.

- [ ] **Step 1: Failing tests** (use the file's `setup`, `S`, `ev` helpers)

```js
test('v1.7: unseen is set when a chat moves into "Your turn", not when first seen already there', () => {
  const { store, set } = setup(1000);
  store.setSessions([S('s1')]);
  store.onEvent(ev('s1', 'PostToolUse', 1000));
  set(1010); store.onEvent(ev('s1', 'Stop', 1010));
  assert.equal(store.snapshot().agents[0].stage, 'turn');
  assert.equal(store.snapshot().agents[0].unseen, false, 'first sighting already in turn: not lit (M8)');
  set(1020); store.onEvent(ev('s1', 'UserPromptSubmit', 1020, { raw: { prompt: 'go' } }));
  assert.equal(store.snapshot().agents[0].unseen, false);
  set(1030); store.onEvent(ev('s1', 'Stop', 1030));
  assert.equal(store.snapshot().agents[0].unseen, true);
  assert.equal(store.snapshot().agents[0].unseen, true, 'stays across snapshots');
  set(1040); store.onEvent(ev('s1', 'UserPromptSubmit', 1040, { raw: { prompt: 'again' } }));
  assert.equal(store.snapshot().agents[0].unseen, false, 'a new turn clears it');
});
test('v1.7: markSeen clears once and reports it; unknown ids are false', () => {
  const { store, set } = setup(1000);
  store.setSessions([S('s1')]);
  store.onEvent(ev('s1', 'UserPromptSubmit', 1000, { raw: { prompt: 'go' } }));
  store.snapshot();
  set(1010); store.onEvent(ev('s1', 'Stop', 1010));
  assert.equal(store.snapshot().agents[0].unseen, true);
  assert.equal(store.markSeen('s1'), true);
  assert.equal(store.snapshot().agents[0].unseen, false);
  assert.equal(store.markSeen('s1'), false);
  assert.equal(store.markSeen('nope'), false);
});
test('v1.7: ✕ clears unseen; the next finished turn lights it again', () => {
  const { store, set } = setup(1000);
  store.setSessions([S('s1')]);
  store.onEvent(ev('s1', 'UserPromptSubmit', 1000, { raw: { prompt: 'go' } }));
  store.snapshot();
  set(1010); store.onEvent(ev('s1', 'Stop', 1010));
  assert.equal(store.snapshot().agents[0].unseen, true);
  store.hide('s1');
  assert.equal(store.snapshot().tucked[0].unseen, false);
  set(1020); store.onEvent(ev('s1', 'UserPromptSubmit', 1020, { raw: { prompt: 'more' } }));
  assert.equal(store.snapshot().agents[0].unseen, false);
  set(1030); store.onEvent(ev('s1', 'Stop', 1030));
  assert.equal(store.snapshot().agents[0].unseen, true);
});
```

- [ ] **Step 2: Run** `node --test test/store.test.js` → FAIL (`unseen` undefined, `markSeen` not a function).
- [ ] **Step 3: Implement.** Keep a `Set` of unseen ids. In `computeAgents`'s existing `stages` transition block: when a previous record exists and the new stage is `turn`, add it; when the new stage is not `turn`, delete it. Also delete it in `hide(id)`, and wherever a forgotten session's state is dropped in `setSessions`.
- [ ] **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Commit:** `feat: the store marks finished chats unseen until seen`

---

### Task 2: Rows and faces draw it; the flash survives redraws

**Files:** Modify `src/renderer/hud.js` (`renderRow`, `face`, new exported `keepFlashing`, `boot`'s render and `animationend`), `src/renderer/hud.css`. Test `test/hud-render.test.js`.

**Interfaces:**
- Consumes: `agents[].unseen` (Task 1).
- Produces: `keepFlashing(prev: Set<string>, fresh: Set<string>, now: Set<string>) -> Set<string>` = (prev ∩ now) ∪ fresh. These are the ids still mid-flash. `now` is the set of agents in "Your turn".

- [ ] **Step 1: Failing tests** (use the file's `agent` helper)

```js
test('v1.7: an unseen "Your turn" row and face carry the unseen class; tucked or not-in-turn rows do not', () => {
  const lit = agent({ id: 't', mood: 'done', stage: 'turn', unseen: true });
  assert.match(renderRow(lit), /class="row done[^"]*\bunseen\b/);
  assert.ok(!renderRow(lit).includes('glow-done'), 'the flash stays a DOM class (I1)');
  assert.ok(!/\bunseen\b/.test(renderRow(agent({ id: 't', mood: 'done', stage: 'turn', unseen: false })).match(/class="row[^"]*"/)[0]));
  assert.ok(!/\bunseen\b/.test(renderRow(lit, { tucked: true }).match(/class="row[^"]*"/)[0]));
  assert.ok(!/\bunseen\b/.test(renderRow(agent({ id: 'w', mood: 'working', stage: 'working', unseen: true })).match(/class="row[^"]*"/)[0]));
  const col = renderParty({ agents: [lit], cards: [] }, { collapsed: true });
  assert.match(col, /class="face done unseen"/);
});
test('v1.7: keepFlashing keeps mid-flash ids still in turn and adds fresh ones', () => {
  const s = (...a) => new Set(a);
  assert.deepEqual([...keepFlashing(s('a', 'b'), s('c'), s('a', 'c'))].sort(), ['a', 'c']);
  assert.equal(keepFlashing(s(), s(), s()).size, 0);
});
test('v1.7 M4: the unseen glow never animates; collapsed faces get the finite finish flash', async () => {
  const fs = await import('node:fs');
  const css = fs.readFileSync(new URL('../src/renderer/hud.css', import.meta.url), 'utf8');
  assert.match(css, /\.row\.unseen\s*\{[^}]*box-shadow/);
  assert.match(css, /\.face\.unseen\s*\{/);
  for (const m of css.matchAll(/([^{}]+)\{([^}]*animation[^}]*)\}/g)) {
    assert.doesNotMatch(m[1], /\.unseen/, `nothing animates the unseen glow: ${m[1].trim()}`);
  }
  assert.match(css, /\.face\.glow-done\s*\{[^}]*animation:\s*done-pulse[^;}]*\b2\b/, 'faces flash twice, like rows');
});
```

- [ ] **Step 2: Run** `node --test test/hud-render.test.js` → FAIL.
- [ ] **Step 3: Implement.**
  - `renderRow`: add ` unseen` to the row class when `a.unseen && !tucked && inTurn(a)`. `face`: the same check gives `class="face ${mood} unseen"`.
  - CSS: `.row.unseen` is a static soft green-gold inset `box-shadow`, fainter than `.row.glow-ask::after` (e.g. `rgba(190, 200, 100, .35)` 1px ring + `.15` inner). `.face.unseen` is a soft green-gold radial background (same shape as `.face.needs`). `.face.glow-done` gets the static style (outside the motion block) and `animation: done-pulse 1.2s ease-out 2` inside `prefers-reduced-motion: no-preference`.
  - `boot`: `st.flash = new Set()`. After `newlyFinished`, set `st.flash = keepFlashing(st.flash, done.fresh, done.now)`. Then for every id in `st.flash`, `rowEl(id)?.classList.add('glow-done')`. This runs after every `patch()`, so a redrawn row or a collapse switch gets it back. With reduced motion (`animationName === 'none'`) a 3 s timer removes the class *and* deletes the id. On `animationend` for `done-pulse`, delete the id (from `data-key` after the `:`) and remove the class. Keep the M8 rule: the first snapshot only seeds.
- [ ] **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Commit:** `feat: unseen "Your turn" rows stay softly lit; the finish flash survives redraws and shows on faces`

---

### Task 3: Main marks the open chat seen; live check

**Files:** Modify `src/main/main.js` (`pushNow`), `test/main-order.test.js`, `spikes/SPIKES.md`.

**Interfaces:** Consumes `store.markSeen(id) -> boolean` (Task 1), existing `panelNow(snap).detailId`.

- [ ] **Step 1: Failing test** in `test/main-order.test.js` (same source-reading style as its existing tests):

```js
test('v1.7: every push marks the chat whose details are open as seen, before the snapshot is sent', () => {
  const body = src.slice(src.indexOf('const pushNow'), src.indexOf('const push = createThrottle'));
  const seen = body.indexOf('store.markSeen(');
  assert.ok(seen > 0, 'pushNow calls store.markSeen');
  assert.ok(seen < body.indexOf("webContents.send('snapshot'"), 'before the snapshot goes out');
});
```

(Adapt `src` to however that file already loads `main.js`.)
- [ ] **Step 2: Run** `node --test test/main-order.test.js` → FAIL.
- [ ] **Step 3: Implement** in `pushNow`, after `pick` is settled: `const shown = panelNow(snap).detailId; if (shown != null && store.markSeen(String(shown))) snap = store.snapshot();` (make `snap` a `let`). Then `anchor`, the send, `placePanel(snap)` and so on use the fresh snapshot.
- [ ] **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Live check** (isolated dev HUD as in the hooks-follow plan: temp `AGENT_HUD_USER_DATA` with `{"claudeHooksWanted": true}`, `AGENT_HUD_PORT=47911`, `AGENT_HUD_NO_FIRST_RUN=1`; back up and restore the spike settings file). Drive a long-lived stream-json Claude session in `C:\Consortis_projects\agent-hud-spike`. Check, using screenshots or temporary renderer logging that is removed before committing:
  - (a) the turn ends with no panel open: flash, then stays lit;
  - (b) select that row: the glow goes;
  - (c) the turn ends while that chat's details are open: flash, not lit afterwards;
  - (d) collapsed: the face flashes, then stays softly lit.
  
  Add `## Live check - "Your turn" glow (v1.7)` to `spikes/SPIKES.md` with a results table.
- [ ] **Step 6: Commit:** `feat: opening a chat's details marks its finished turn seen`
