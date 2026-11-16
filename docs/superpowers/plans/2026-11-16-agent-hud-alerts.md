# Agent HUD v1.2 — Question Pop-Open and Finish Glow Implementation Plan

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
║  A two-parter: questions pop the panel open, finished agents glow. One   ║
║  stubborn blocker: typing an answer in a panel that must never take      ║
║  focus on its own, and give it straight back afterwards.                 ║
╟──────────────────────────────────────────────────────────────────────────╢
║  ROGUES GALLERY                                                          ║
║  ◆ GREEN GOBLIN   A popped-open panel that grabs focus while you type    ║
║                   in your editor                                         ║
║  ◆ THE SPOT       Moving the cards out of the HUD breaks v1 answering    ║
║  ◆ SANDMAN        Selection flipping between auto-opened and chosen      ║
║  ◆ ELECTRO        A question arriving mid-click on another card          ║
╚══════════════════════════════════════════════════════════════════════════╝
```

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make waiting questions impossible to miss and easy to answer. They open the detail panel by themselves, with the answer card inside it. A finished agent glows and shows Claude's last message.

**Architecture:**
- **Shared card code.** The v1 card rendering and interaction code moves out of `hud.js` into a shared `cards.js`, so the panel can host the cards.
- **Main process.** A pure `autoSelect()` in `wiring.js` decides when a question opens or switches the panel and when it returns to what was open before. Main forwards the active card with the detail, and handles panel answers through the same path as HUD answers.
- **Glows.** CSS on the HUD rows, triggered by pure "newly in stage" helpers.

**Tech Stack:** Electron 44.7.2, Node 20 (`node --test`), plain ES modules, no new dependencies.

**Spec:** `C:\Consortis_projects\agent-hud\docs\superpowers\specs\2026-11-16-agent-hud-alerts-design.md`. It builds on the v1 and v1.1 specs in the same folder. The code is on branch `agent-hud-v1`.

## Global Constraints

- **Question pop-open:** when a card becomes active, the panel opens beside the HUD on that agent, with the card at the top. The HUD renders **no** cards any more, only rows and the `Next: …` line.
- **Holds unchanged:** 60 000 ms for permission and choice, 540 000 ms for replies. Answer encoding is unchanged, and so is the 500 ms arming guard on answer buttons.
- **One question at a time.** If the panel showed another agent, it switches to the question. After the answer or release it returns to the previous selection, or closes if it opened by itself. A manual selection (or ✕) while a question is open wins until the next *new* question.
- **Collapsed HUD:** a question still opens the panel, placed next to the collapsed face.
- **Focus:**
  - The panel window stays `focusable: false` except while the user types. A `pointerdown` in an `input` or `textarea` inside a card calls `panel:setInteractive(true)` (`setFocusable(true)` + `focus()`).
  - Sending, releasing or the card disappearing calls `setInteractive(false)` (`setFocusable(false)`, then `blur()` only if the panel had focus). This is the HUD's v1 pattern.
- **Question glow:** the asking row glows gold with 3 strong pulses, then a slow, steady "breathe" (about a 2.4 s cycle) until it's answered.
- **Finish glow:** on entering stage `turn`, the row glows briefly in green-gold (2 pulses). The `Your turn` chip carries the pennant sprite.
- **Reduced motion:** `prefers-reduced-motion` → no animation, only a static glow.
- **Finished section:** while the stage is `turn`, the panel shows **Finished** with Claude's last message: Stop's `last_assistant_message`, whitespace collapsed, at most **600** characters, escaped. Nothing auto-opens on finish.
- **Unchanged:** a hidden HUD holds no questions, there is no sound, and answering in the agent's own window still works. Never write `~/.claude/settings.json`.

## Review Focus

1. **A higher-priority question arrives while the user is typing a reply.** The typed text must not be lost; drafts are kept per card id. → Task 1 test.
2. **The user picks another agent (or ✕) while a question is open.** Their choice stands, and the panel doesn't snap back until a different question arrives. → Task 3 test.
3. **The question is answered natively in the agent's window.** The card vanishes, and the panel returns to the previous selection or closes. → Task 3 test.
4. **The HUD is collapsed when a question arrives.** `panelTarget` must allow the panel. → Task 3 test.
5. **HTML in Claude's last message or a card's command** renders as text. → Task 4 and Task 1 tests.

---

## File Structure

```
src/renderer/cards.js        NEW  card rendering + card interaction controller (moved from hud.js)
src/renderer/cards.css       NEW  card styles shared by index.html and panel.html
src/renderer/hud.js          MOD  imports cards.js; Task 3 stops rendering cards; Task 4 glow triggers
src/renderer/hud.css         MOD  glow animations (Task 4); card styles move to cards.css
src/renderer/panel.js/.css   MOD  card at top, finished section, focus calls
src/preload-panel.cjs        MOD  answer, release, setInteractive
src/main/steps.js            MOD  lastMessage
src/main/store.js            MOD  detail.card, detail.lastMessage
src/main/wiring.js           MOD  autoSelect(), userSelect(), panelTarget() exception
src/main/main.js             MOD  auto-select wiring, panel answer IPC, panel focus
```

---

### Task 1: Move the card code into `cards.js` (no behaviour change)

**Files:**
- Create: `src/renderer/cards.js` and `src/renderer/cards.css`.
- Modify: `src/renderer/hud.js`, `src/renderer/hud.css` and `src/renderer/index.html` (add the `cards.css` link).
- Test: `test/hud-render.test.js` (fix the imports), plus the new `test/cards.test.js`.

**Interfaces:**
- Produces (in `cards.js`, DOM-free at import):
  - **Moved unchanged from `hud.js`:** `renderCard`, `replyLeftMs`, `picksFrom`, `actionsArmed`, `clickAllowed`, `ARM_MS`.
  - **`hud.js` re-exports them,** so existing imports keep working.
  - **`createDrafts() -> { get(cardId): string, set(cardId, text), drop(cardId) }`:** typed reply and "Something else…" text per card id.
  - **`mountCards(host, { api, doc, onInteractive }) -> { show(card, nowMs), clear() }`:** `host` is the element that receives the card.
    - It handles every card action: allow/deny (and the "always" box), pick, answer, send, noreply, open-card, and Enter. Each one calls `api.answer`, `api.release` or `api.openWindow` with exactly the v1 answer objects.
    - It also handles arming, settling (the double-submit guard), the reply countdown, and restoring drafts when a card re-appears.
    - `onInteractive(on)` is called on `pointerdown` in an input or textarea (`true`), and on send, release or the card going away (`false`).
- **HUD wiring:** the HUD's `boot` uses `mountCards` for its card slot. Visible behaviour is identical to now.

- [ ] **Step 1: Write the failing tests** in `test/cards.test.js`:
  - `createDrafts keeps text per card id; drop clears it`
  - `renderCard from cards.js equals hud.js's re-export for permission, choice and reply (same string)`
  - `renderCard escapes HTML in command and question text (Review Focus 5)`
- [ ] **Step 2:** Run `node --test test/cards.test.js`. Expected: FAIL (module not found).
- [ ] **Step 3: Move the code.** Do it as a pure move. Keep `hud.js` importable in Node, and keep every existing `hud-render` test green.
- [ ] **Step 4:** Run `npm test`. Expected: all PASS.
- [ ] **Step 5:** `git add src/renderer test && git commit -m "refactor: card code moves to cards.js"`

---

### Task 2: Last message and the card in the detail

**Files:**
- Modify: `src/main/steps.js` and `src/main/store.js`.
- Test: `test/steps.test.js` and `test/store.test.js`.

**Interfaces:**
- Produces:
  - **`view(id).lastMessage`** (string or null). It's set from a main-thread `Stop`'s `raw.last_assistant_message`, with whitespace collapsed and capped at 600 chars, and cleared by a non-synthetic `UserPromptSubmit`.
  - **`store.detail(id)` gains two fields:**
    - `lastMessage`: the view's value, but only while the stage is `turn`, else null;
    - `card`: the snapshot's active card when `card.sessionId === id`, else null. It has the same shape as `snapshot().card`, including `expiresAt` and `canOpen`.

- [ ] **Step 1: Write the failing tests:**
  - `Stop sets lastMessage (collapsed, 600 cap); a new real prompt clears it; helper Stop ignored`
  - `detail.lastMessage only while stage is turn`
  - `detail.card is the active card for that session, null for others`
- [ ] **Step 2:** Run `node --test test/steps.test.js test/store.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement both changes.**
- [ ] **Step 4:** Run `npm test`. Expected: all PASS.
- [ ] **Step 5:** `git add src/main/steps.js src/main/store.js test/steps.test.js test/store.test.js && git commit -m "feat: last message and active card in the detail"`

---

### Task 3: Questions open the panel; the cards live there

**Files:**
- Modify:
  - `src/main/wiring.js` and `src/main/main.js`;
  - `src/preload-panel.cjs`;
  - `src/renderer/panel.js`, `panel.css` and `panel.html` (add the `cards.css` link);
  - `src/renderer/hud.js`, which stops rendering cards.
- Test: `test/wiring.test.js`, `test/panel-render.test.js` and `test/hud-render.test.js`.

**Interfaces:**
- Consumes: `detail.card` (Task 2), and `mountCards` and `createDrafts` (Task 1).
- Produces:
  - **`autoSelect(state, card) -> state`** in `wiring.js` (pure).
    - `state = { selected: {id,rowY}|null, auto: boolean, before: {id,rowY}|null, cardId: string|null }`; `card` is the snapshot's active card or null.
    - **A new card id** (≠ `state.cardId`) selects `card.sessionId` with `auto: true`. It remembers `before` from the current non-auto selection; if the selection was already auto, it keeps the old `before`.
    - **The card goes away** (null) while `auto`: the selection is restored to `before` (possibly null), with `auto: false`.
    - **The same card id as before** changes nothing.
    - **`userSelect(state, sel) -> state`** (also exported) sets `selected = sel`, `auto: false` and `before: null`. It keeps `cardId`, so the current question doesn't re-open.
  - **`panelTarget(selectedId, snapshot, { collapsed, visible, hasCard })`:** when `hasCard` is true (the selected agent owns the active card), a collapsed HUD still gets the panel. Hidden still means no panel.
  - **Panel IPC:**
    - `window.panel` gains `answer(id, response)` → `panel:answer`, `release(id)` → `panel:release`, and `setInteractive(on)` → `panel:setInteractive`.
    - In main, `panel:answer` and `hud:answer` share one `answerCard(id, response)`; `panel:release` shares one release function.
    - `panel:setInteractive` mirrors the HUD's `setInteractive`/`releaseFocus` for the panel window.
  - **Row offset:** the HUD reports the collapsed face's centre through `hud:rowOffset` when collapsed.

- [ ] **Step 1: Write the failing tests:**
  - **wiring:**
    - `autoSelect: new card opens its agent (auto), remembers the previous manual selection, restores it when the card goes; restores null when nothing was open`
    - `autoSelect: a second card while auto keeps the original before`
    - `userSelect during a question: the manual choice stands until a different card id arrives (Review Focus 2)`
    - `card answered natively (card null) → back to before (Review Focus 3)`
    - `panelTarget: collapsed + hasCard → id; collapsed without card → null; hidden → null (Review Focus 4)`
  - **panel-render:**
    - `renderPanel with detail.card renders the card above the task, with the countdown`
    - `renderPanel without card unchanged`
  - **hud-render:**
    - `renderParty renders no card markup even when snapshot.card is set; the Next line stays`
- [ ] **Step 2:** Run `node --test test/wiring.test.js test/panel-render.test.js test/hud-render.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **In main:** keep the `autoSelect` state and run `autoSelect` with `store.snapshot().card` on every push, before `placePanel`. `hud:selectAgent` and `panel:close` go through `userSelect`.
  - **In panel.js:** mount the card at the top through `mountCards`, wired to `window.panel`, and keep `createRenderGate` around it.
  - **In hud.js:** remove the card slot and `mountCards` from `renderParty`/`boot`. Keep the `Next:` line and the row `ask` text.
- [ ] **Step 4:** Run `npm test`. Expected: all PASS.
- [ ] **Step 5: Smoke check with `npm run dev`.**
  - First run `node scripts/dev.mjs --quit`.
  - Send a held permission to the HUD for a live interactive session id, with a `curl` POST of a `PermissionRequest` carrying the secret from the app's `config.json`.
  - Confirm each item:
    - the panel opens on that agent with the card;
    - Allow returns the allow JSON to curl;
    - the panel closes afterwards;
    - collapsing and then re-sending opens the panel beside the face.
  - Quit the dev build afterwards.
- [ ] **Step 6:** `git add src test && git commit -m "feat: questions open the panel; answer cards live there"`

---

### Task 4: Glows and the Finished section

**Files:**
- Modify: `src/renderer/hud.js`, `src/renderer/hud.css`, `src/renderer/panel.js` and `src/renderer/panel.css`.
- Test: `test/hud-render.test.js` and `test/panel-render.test.js`.

**Interfaces:**
- Consumes: `detail.lastMessage` (Task 2); `MOODS_PENNANT` and the `GR` engine from `sprites.js`.
- Produces:
  - **`newlyIn(agents, prev, pred) -> { now: Set, fresh: Set }`** (pure). It generalises `newlyNeeding`, which stays as a wrapper.
  - **Row classes:**
    - `glow-ask` on every `needs` row: 3 pulses, then breathing.
    - `glow-done`, added once when a row newly enters `turn` and removed on `animationend`.
  - **The `turn` chip** carries a small pennant SVG before `Your turn`.
  - **The panel's Finished section** (`<p class="lbl">Finished</p>`) shows the escaped `lastMessage` while the stage is `turn`.

- [ ] **Step 1: Write the failing tests:**
  - `newlyIn reports fresh ids once`
  - `needs rows carry glow-ask; turn chip contains the pennant svg`
  - `renderPanel shows Finished with the escaped last message only for stage turn (Review Focus 5)`
- [ ] **Step 2:** Run `node --test test/hud-render.test.js test/panel-render.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement the CSS animations.**
  - `@keyframes ask-pulse` (3 iterations, gold `#e0b45c` box-shadow);
  - `@keyframes ask-breathe` (2.4 s infinite, after the pulses through `animation-delay`);
  - `@keyframes done-pulse` (2 iterations, green-gold);
  - all inside `prefers-reduced-motion: no-preference`, with a static glow otherwise.
- [ ] **Step 4:** Run `npm test`. Expected: all PASS.
- [ ] **Step 5:** `git add src/renderer test && git commit -m "feat: question and finish glows; finished section"`
