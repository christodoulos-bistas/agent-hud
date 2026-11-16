# Agent HUD v1.1 — Details Panel and Stages Implementation Plan

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
║  A two-parter: stages and stuck detection in the store, then a detail    ║
║  panel beside the HUD. One stubborn blocker: a second always-on-top      ║
║  window that must follow the HUD without stealing focus or clicks.       ║
╟──────────────────────────────────────────────────────────────────────────╢
║  ROGUES GALLERY                                                          ║
║  ◆ GREEN GOBLIN   A second always-on-top window that steals focus or     ║
║                   swallows clicks over the editor                        ║
║  ◆ MYSTERIO       Stuck hints that cry wolf on long, healthy builds      ║
║  ◆ SANDMAN        A panel chasing a HUD that moves, grows and collapses  ║
║  ◆ MORBIUS        Per-event history and live timers redrawing too often  ║
╚══════════════════════════════════════════════════════════════════════════╝
```

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every HUD row a stage chip (Thinking / Working / Needs you / Your turn / Idle / ⚠ Stuck?). Clicking a character opens a detail panel beside the HUD that shows the agent's task, current step, recent steps and stuck reason.

**Architecture:**
- **Steps:** a new pure module, `steps.js`, turns hook events into a per-session step log (task, open and closed steps, helpers).
- **Stages:** a new pure module, `stages.js`, derives each agent's stage and stuck flag from that log plus the existing store state.
- **Store:** exposes the results through `snapshot()` and a new `detail(id)`.
- **Panel:** a second frameless, non-focusable Electron window (`panel.html`). The main process owns which agent is selected, places the panel beside the HUD with a pure `panelBounds()` function, and pushes `detail` to it.

**Tech Stack:** Electron 44.7.2, Node 20 (`node --test`, `node:assert/strict`), plain ES modules, no new dependencies.

**Spec:** `C:\Consortis_projects\agent-hud\docs\superpowers\specs\2026-11-16-agent-hud-details-design.md`. Read it, including §6.6 "Calls made after the builder check". It extends v1 (`…-agent-hud-design.md`); the v1 code is on branch `agent-hud-v1`. The visual reference is mockup option B, `.superpowers/brainstorm/1378-1794812926/content/hud-detail.html`.

## Global Constraints

- **Data source:** hooks only. No transcript reading, no new dependencies, Windows 11, Electron 44.7.2.
- **Stage chips:** the text is exactly `Thinking`, `Working · <t>`, `Needs you`, `Your turn`, `Idle · <t>`, `⚠ Stuck?`. Durations format as `45s` (under 60 s), `12m` (under 60 min), `2h`.
- **Stage order:** needs → turn → thinking → working → idle. The working window is 20 s of activity, or session `status === 'busy'`, or an open step.
- **Stuck triggers:**
  - **repeating:** the last 3 closed main-thread steps have the same `label` and are all failed (interrupted steps never count);
  - **long:** an open main-thread step has run more than **300 000 ms**, except an open `Agent`/`Task` step while the session has an active helper;
  - **silent:** the session is busy or thinking, there has been no event from any thread for more than **180 000 ms**, and there are no open steps and no active helpers.
  - Stuck is evaluated only for thinking or working. It is a hint only.
- **Limits:**
  - **History:** keep **20** main-thread steps per session.
  - **Text lengths:** task text and error excerpt **300** characters each, whitespace collapsed.
  - **Lifetime:** history is dropped when the session is forgotten.
- **Closing steps without a Post event:** a non-synthetic `UserPromptSubmit`, a `Stop` or a `SessionEnd` closes every open main-thread step with `ok: null, interrupted: true`. A `SubagentStop` closes that helper's step.
- **Panel window:**
  - Frameless, transparent, always on top, `skipTaskbar`, **non-focusable**, `resizable: false`.
  - Same `webPreferences` as the HUD: `sandbox: true, contextIsolation: true, nodeIntegration: false`. Same CSP.
  - Width **340 px**, an **8 px** gap from the HUD, height capped at **60%** of the work area.
  - It opens left of the HUD, or right of it when the HUD's centre is in the left half of its work area. If neither side fits, it goes on the side with more room and is clamped inside the work area.
- **Clicks:** clicking a sprite or name toggles the panel; the name no longer opens the window. The handed-back link `Waiting in its window — open ↗` and the panel's `open window ↗` still call `openWindow`.
- **Panel closing:** the panel closes on ✕, on a second click on the same agent, on collapse, on hide, on quit, or when its agent leaves the list.
- **Pushes:** after events (existing throttle), plus a 1 s tick that pushes only when any agent's stage or stuck flag changed. Clocks tick in the renderers. The panel ticks only while open.
- **Escaping:** every displayed string goes through `esc()`. Long commands and errors wrap, never truncated with an ellipsis.
- **Panel copy:**
  - A session with no recorded task shows the task `Started before the HUD`.
  - A `needs` agent's panel shows `Waiting for your answer in the HUD`.

## Review Focus

1. **A session already running when the HUD started** (no task, no steps) must render a valid row and panel ("Started before the HUD", started time from the session file) without throwing. → Task 2 and Task 5 tests.
2. **A `PostToolUse` without `tool_use_id`** (or with an unknown one) must close the oldest open step with the same tool and agent, and never create a phantom step. → Task 2 test.
3. **A long foreground `Agent` call with an active helper** must not show ⚠ Stuck?. → Task 3 test.
4. **The selected agent disappears** (session ended, list re-polled) → the panel must close rather than show stale data. → Task 6 test of `panelTarget`.
5. **HTML in a task prompt, a command or an error excerpt** must render as text in the panel and the row. → Task 4 and Task 5 tests.

---

## File Structure

```
src/main/steps.js           NEW  per-session step log from hook events (pure)
src/main/stages.js          NEW  stage + stuck derivation (pure)
src/renderer/format.js      NEW  fmtDuration, shared by main and renderer (pure)
src/main/store.js           MOD  feeds steps; AgentView gains stage fields; detail(id); stageKey()
src/main/wiring.js          MOD  panelBounds(), panelTarget() (pure)
src/main/main.js            MOD  panel window, selection, IPC, 1 s stage tick
src/preload.cjs             MOD  window.hud gains selectAgent, rowOffset
src/preload-panel.cjs       NEW  window.panel API
src/renderer/hud.js         MOD  stage chip, select clicks, row offset reports, live chip clocks
src/renderer/hud.css        MOD  chip styles; needs chip carries the seal pulse
src/renderer/panel.html     NEW
src/renderer/panel.css      NEW
src/renderer/panel.js       NEW  renderPanel() (pure) + bootPanel()
spikes/panel-focus.mjs      NEW  throwaway focus spike (Task 1)
spikes/SPIKES.md            MOD  spike 6 result
test/steps.test.js, test/stages.test.js, test/panel-render.test.js   NEW
test/store.test.js, test/hud-render.test.js, test/wiring.test.js     MOD
```

---

### Task 1: Panel focus spike (gate)

Decides whether panel buttons work in a non-focusable window without pulling focus from the editor (spec §7 risk 1, §6.6 call 1).

**Files:**
- Create: `spikes/panel-focus.mjs`
- Modify: `spikes/SPIKES.md` (add "Spike 6 — non-focusable panel clicks")

**Interfaces:**
- Produces: one ledger fact, `PANEL_CLICK_MODE = 'plain' | 'pointerdown-focus'`, recorded in SPIKES.md. Task 6 reads it.

- [ ] **Step 1: Write `spikes/panel-focus.mjs`.** It is an Electron entry, run with `npx electron spikes/panel-focus.mjs`.
  - It opens a 340×200 window: `frame: false`, `alwaysOnTop: true`, `focusable: false`, `skipTaskbar: true`, sandboxed.
  - The window loads an inline `data:` page with one button. The button's click sends IPC, and main prints `CLICKED <ms>` to stdout.
  - Main also polls `BrowserWindow.getFocusedWindow()` every 200 ms and prints `FOCUSED` if it ever becomes this window.
  - It quits after 20 s.
- [ ] **Step 2: Drive it without a human.** While it runs, a PowerShell snippet (`Add-Type` with user32 `SetCursorPos` / `mouse_event`) clicks the button's screen centre. Use `GetForegroundWindow` with `GetWindowText` to record the foreground window title before and after the click.
  - **plain:** `CLICKED` printed, no `FOCUSED`, and the foreground title unchanged.
  - **pointerdown-focus:** anything else.
- [ ] **Step 3: Record the result.** Add "Spike 6" to `SPIKES.md` with the command output and the chosen mode, then commit: `git add spikes/panel-focus.mjs spikes/SPIKES.md && git commit -m "chore: spike non-focusable panel clicks"`.

---

### Task 2: Step log

**Files:**
- Create: `src/main/steps.js`
- Test: `test/steps.test.js`

**Interfaces:**
- Consumes: the normalized event `{ sessionId, event, toolName, toolInput, cwd, at, raw }` (v1), and `activityLine(ev)` from `src/main/store.js`, for the present-tense `doing` text.
- Produces:
  - `stepLabel(toolName, toolInput) -> string` (past/neutral tense):

    | Tool | Label |
    |---|---|
    | `Read` | `Read <basename>` |
    | `Edit` / `Write` / `NotebookEdit` | `Edited <basename>` |
    | `Bash` / `PowerShell` | the command, first 80 chars, whitespace collapsed |
    | `Grep` | `Searched code for “<pattern>”` |
    | `Glob` | `Listed files <pattern>` |
    | `WebSearch` | `Searched the web for “<query>”` |
    | `WebFetch` | `Read <hostname>` |
    | `Agent` / `Task` | `Sent a <subagent_type> helper` |
    | anything else | `toolName` |

  - `createStepLog({ cap = 20 } = {}) -> { push(ev), forget(sessionId), view(sessionId) }`
  - `view(id) -> { task: string|null, taskAt: number|null, stepCount: number, current: Step|null, steps: Step[] /* closed main-thread, newest first, ≤ cap */, open: Step[] /* main-thread open */, helpers: [{ agentId, agentType, doing: string|null }], lastEventAt: number|null }`
  - `Step = { id: string|null, tool, label, doing, why: string|null, startedAt, endedAt: number|null, ok: true|false|null, interrupted: boolean, error: string|null, agentId: string|null, agentType: string|null }`
  - `current` is the most recently started open main-thread step.

**The rules this task decides** (spec §6.1, §6.6 calls 4–5):
- **Opening and closing steps:**
  - `PreToolUse` opens a step.
  - `PostToolUse` closes it with `ok: true`; `PostToolUseFailure` closes it with `ok: false`.
  - Matching is by `raw.tool_use_id`. Without one (or with an unknown id), the oldest open step with the same `tool` and `agentId` is closed.
  - A Post event that matches nothing is ignored.
- **Error text:** the first non-empty of `raw.error`, `raw.tool_response.stderr`, `raw.tool_response.error`, `raw.tool_response.message`, or `raw.tool_response` if it is a string. Whitespace is collapsed and the result is capped at 300 chars.
- **Why line:** `why` is `tool_input.description` when it is a string.
- **Task boundaries:**
  - A non-synthetic `UserPromptSubmit` (trimmed `raw.prompt` not starting with `<task-notification>`) sets `task` (300 chars), `taskAt = at` and `stepCount = 0`, and closes open main-thread steps as interrupted.
  - `Stop` and `SessionEnd` close open main-thread steps as interrupted.
- **Helpers:**
  - Events with `raw.agent_id` are helper events and never enter `steps` or `open`.
  - `SubagentStart` adds a helper; the helper's `PreToolUse` sets its `doing`.
  - `SubagentStop` removes the helper.
- **Counting and freshness:** `stepCount` increments on every main-thread `PreToolUse`. `lastEventAt` updates on every event of any thread.

- [ ] **Step 1: Write the failing tests** in `test/steps.test.js`. Use a helper `ev(event, at, { tool, input, raw })` with `sessionId: 's1'`.
  - `Pre then Post with the same tool_use_id → one closed ok step, label "Edited updater.js", why from description`
  - `Post without tool_use_id closes the oldest open step of the same tool; unmatched Post is ignored (no phantom step)`
  - `PostToolUseFailure → ok false, error = first 300 chars of tool_response.stderr, whitespace collapsed`
  - `non-synthetic UserPromptSubmit sets task, resets stepCount, closes open steps as interrupted (ok null, interrupted true)`
  - `synthetic "<task-notification>" prompt changes nothing`
  - `Stop and SessionEnd close open main-thread steps as interrupted`
  - `helper events (raw.agent_id) never enter steps; SubagentStart adds a helper, its PreToolUse sets doing, SubagentStop removes it`
  - `cap: 25 closed steps → steps.length 20, newest first`
  - `view of an unknown session → task null, steps [], current null, helpers [] (Review Focus 1)`
  - `stepLabel for each tool in the table`
- [ ] **Step 2:** Run `node --test test/steps.test.js`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement `src/main/steps.js`.** Use a per-session `{ task, taskAt, stepCount, open: [], closed: [], helpers: Map, lastEventAt }`.
- [ ] **Step 4:** Run `node --test test/steps.test.js`, then `npm test`. Expected: all PASS.
- [ ] **Step 5:** `git add src/main/steps.js test/steps.test.js && git commit -m "feat: per-session step log from hook events"`

---

### Task 3: Stages, stuck flag and store integration

**Files:**
- Create: `src/main/stages.js`
- Modify: `src/main/store.js`
- Test: `test/stages.test.js`, `test/store.test.js`

**Interfaces:**
- Consumes: `createStepLog` and its `view` (Task 2); the existing store internals (`moodOf` result, `stoppedAt`, `lastActivityAt`, session `status`, `engine.activeSubagents`).
- Produces:
  - **`stages.js`:**
    - `stageOf({ mood, view, status, now }) -> 'needs'|'turn'|'thinking'|'working'|'idle'`
      - `mood` is v1's `moodOf` result.
      - `needs` and `done` map straight to `needs` and `turn`.
      - Otherwise: `thinking` when `view.taskAt` is set, no step has started at or after `taskAt`, and `view.open` is empty.
      - Otherwise `working` when the mood is working or `view.open.length > 0`.
      - Otherwise `idle`.
    - `stuckOf({ stage, view, status, now }, { repeatN = 3, longMs = 300000, silentMs = 180000 } = {}) -> null | { reason: 'repeating'|'long'|'silent', detail: string }`
      - `repeating` → `the same step failed 3 times in a row: <label>`.
      - `long` → `<label> has been running for <N> min`.
      - `silent` → `no activity for <N> min`.
  - **`src/renderer/format.js` (new, DOM-free):** `fmtDuration(ms) -> string` (`45s` / `12m` / `2h`). It's the single copy: `stages.js` imports it from `'../renderer/format.js'`, and the renderer imports it in Tasks 4–5.
  - **`store.js`:**
    - `AgentView` gains `stage`, `stuck`, `stageSince`, `currentStepStartedAt`, `lastActivityAt`. When the stage is `thinking` or `working`, `mood` is forced to `working`.
    - `store.detail(id) -> null | { id, display, cls, stage, stuck, task, startedAt, stepCount, current, steps, helpers }`:
      - `task` is `null` when none was recorded.
      - `startedAt` is `view.taskAt`, else the session file's `startedAt`.
    - `store.stageKey() -> string`: a stable string of every agent's `id:stage:stuck.reason`, used by main's 1 s tick.
    - `setSessions` forgets the step log alongside `engine.forget`.

- [ ] **Step 1: Write the failing tests.**
  - **`test/stages.test.js`:**
    - `priority: needs beats everything; done → turn; prompt with no step → thinking; open step → working even if mood idle; else idle`
    - `repeating: 3 closed failed steps with the same label → stuck; a success or a different label in between → null; interrupted steps don't count`
    - `long: open Bash step started 300001 ms ago → stuck long; 299999 → null`
    - `long exemption: open Agent step 10 min old with an active helper → null (Review Focus 3); same with no helper → stuck`
    - `silent: status busy, no event for 180001 ms, no open steps, no helpers → stuck silent; with an active helper → null`
    - `stuck is null for needs, turn and idle`
    - `fmtDuration: 45000→"45s", 720000→"12m", 7200000→"2h"`
  - **`test/store.test.js` additions:**
    - `AgentView carries stage, stuck, stageSince, currentStepStartedAt, lastActivityAt`
    - `stageSince only changes when the stage changes`
    - `detail(id): task/current/steps/helpers from the log; session started before the HUD → task null, startedAt from the session file (Review Focus 1)`
    - `stageKey changes when a long step crosses 5 min with no new event (fake clock)`
    - `forgetting a session drops its step log`
- [ ] **Step 2:** Run `node --test test/stages.test.js test/store.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement `src/main/stages.js` and the store changes.** In the store:
  - feed `steps.push(ev)` inside `onEvent`;
  - keep `{ stage, since }` per session to compute `stageSince`;
  - compute `stage` and `stuck` in `snapshot()` with `now()`.
- [ ] **Step 4:** Run `node --test test/stages.test.js test/store.test.js`, then `npm test`. Expected: all PASS.
- [ ] **Step 5:** `git add src/main/stages.js src/renderer/format.js src/main/store.js test/stages.test.js test/store.test.js && git commit -m "feat: stages and stuck hints in the store"`

---

### Task 4: HUD row chips and select clicks

**Files:**
- Modify: `src/renderer/hud.js`, `src/renderer/hud.css`, `src/preload.cjs`
- Test: `test/hud-render.test.js`

**Interfaces:**
- Consumes:
  - the new `AgentView` fields (Task 3);
  - `snapshot.selected` (string id or null, pushed by main in Task 6);
  - `fmtDuration` from `src/renderer/format.js` (Task 3).
- Produces:
  - **`window.hud` gains:**
    - `selectAgent(sessionId: string, rowY: number)` → IPC `hud:selectAgent`;
    - `rowOffset(sessionId: string, rowY: number)` → IPC `hud:rowOffset`.
    - `rowY` is the row's vertical centre in CSS px from the top of `#hud-root`.
  - **`renderChip(agent, nowMs) -> string`** (pure, exported). Chip markup is `<span class="st <stage|stuck>">…</span>` with the Global Constraints text:
    - working time = `now - currentStepStartedAt`, else `now - stageSince`;
    - idle time = `now - lastActivityAt`.
  - **`renderRow`:**
    - The right-hand mark becomes the chip.
    - The `needs` chip carries the existing seal arrival pulse (class `call`) instead of the separate seal.
    - Pennant and zee marks are removed.
    - The sprite box and the name get `data-act="select" data-session=<id>`.
    - The name loses `data-act="open"`. The handed-back link keeps it.
    - A row whose id equals `snapshot.selected` gets class `selected`.

- [ ] **Step 1: Write the failing tests** in `test/hud-render.test.js`.
  - `renderChip: thinking → "Thinking"; working with step started 2 min ago → "Working · 2m"; needs → "Needs you"; turn → "Your turn"; idle 25 min → "Idle · 25m"; stuck → "⚠ Stuck?"`
  - `renderRow: name and sprite carry data-act="select"; name has no data-act="open"; handed-back link still data-act="open"`
  - `renderRow escapes HTML in activity and display (Review Focus 5)`
  - `selected row gets class "selected"`
- [ ] **Step 2:** Run `node --test test/hud-render.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Click handling in `boot`:** `case 'select'` computes the row's centre relative to `#hud-root` and calls `selectAgent`.
  - **After each render:** if `snap.selected` is set, compute that row's centre and call `rowOffset` when it changed by ≥ 1 px.
  - **Live clocks:** the existing 1 s `tick` already re-renders, so the chip clocks stay live.
  - **CSS:** chip styles come from the mockup (`.st.think/.work/.needs/.turn/.idle/.stuck`), and the `.row.selected` highlight uses a gold left rail.
  - **`preload.cjs`:** add the two methods, with `String`/`Number` coercion as for the others.
- [ ] **Step 4:** Run `node --test test/hud-render.test.js`, then `npm test`. Expected: all PASS.
- [ ] **Step 5:** `git add src/renderer/hud.js src/renderer/hud.css src/preload.cjs test/hud-render.test.js && git commit -m "feat: stage chips and select clicks on HUD rows"`

---

### Task 5: Panel page

**Files:**
- Create: `src/renderer/panel.html`, `src/renderer/panel.css`, `src/renderer/panel.js`, `src/preload-panel.cjs`
- Test: `test/panel-render.test.js`

**Interfaces:**
- Consumes: the `detail` object (Task 3: `{ id, display, cls, stage, stuck, task, startedAt, stepCount, current, steps, helpers }`); `spriteSvg(classId, scale)` from `sprites.js`; `esc` and `renderChip` from `hud.js`. Import them; `hud.js` must stay DOM-free at import time.
- Produces:
  - **`window.panel`** (from `preload-panel.cjs`): `onDetail(fn)` (IPC `detail`), `close()` → `panel:close`, `openWindow()` → `panel:openWindow`, `reportHeight(px)` → `panel:reportHeight`, and `setInteractive(on)` → `panel:setInteractive`. Task 6 uses the last one only when Spike 6 chose `pointerdown-focus`.
  - **`renderPanel(detail, nowMs) -> string`** (pure). It renders:
    - a header with the sprite (scale 1.5), the name, the class and the chip, plus a ✕ button (`data-act="close"`);
    - an amber stuck line `<b>Repeating:</b> …` when `stuck`;
    - **Task:** the task text in quotes, or `Started before the HUD`;
    - **Now:** `current.doing`, `current.why` and the elapsed time. If the newest closed step failed and no step is open, it shows **Last:** with the label and error instead;
    - **Recent steps:** each with ✓ (ok), ✗ (failed) or – (interrupted), its label, and the time since it ended;
    - **Helpers:** `agentType` and `doing`;
    - a footer: `started <fmt> ago · <n> steps`, plus `open window ↗` (`data-act="open"`);
    - for stage `needs`, the line `Waiting for your answer in the HUD`.
  - **`bootPanel(api = globalThis.panel, doc = globalThis.document)`:**
    - renders on each `detail` and every 1 s while a detail is shown;
    - delegates the clicks;
    - reports its height through a ResizeObserver;
    - ends with `if (typeof document !== 'undefined' && globalThis.panel) bootPanel();`.
- **`panel.html`:** the same CSP as `index.html`, and it loads `panel.css` plus `<script type="module" src="panel.js">`.

- [ ] **Step 1: Write the failing tests** in `test/panel-render.test.js`.
  - `full detail renders task, Now with why, 5 steps with ✓/✗/– marks, helpers, footer with step count`
  - `stuck renders the amber reason line`
  - `no current step and newest closed step failed → "Last:" with the error text`
  - `task null → "Started before the HUD" (Review Focus 1)`
  - `needs → "Waiting for your answer in the HUD"`
  - `HTML in task, command label and error is escaped (Review Focus 5)`
  - `importing panel.js in Node does not throw`
- [ ] **Step 2:** Run `node --test test/panel-render.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement the four files.** Styles follow mockup option B; long text wraps with `overflow-wrap: anywhere`.
- [ ] **Step 4:** Run `node --test test/panel-render.test.js`, then `npm test`. Expected: all PASS.
- [ ] **Step 5:** `git add src/renderer/panel.* src/preload-panel.cjs test/panel-render.test.js && git commit -m "feat: agent detail panel page"`

---

### Task 6: Panel window, selection and the stage tick

**Files:**
- Modify: `src/main/wiring.js`, `src/main/main.js`
- Test: `test/wiring.test.js`

**Interfaces:**
- Consumes:
  - `store.detail(id)` and `store.stageKey()` (Task 3);
  - the HUD IPC `hud:selectAgent` and `hud:rowOffset` (Task 4);
  - the panel page and `preload-panel.cjs` (Task 5);
  - `PANEL_CLICK_MODE` (Task 1, in `SPIKES.md`).
- Produces (pure, in `wiring.js`):
  - `panelBounds(hud: {x,y,width,height}, workArea, { width = 340, height, rowY, gap = 8, maxFrac = 0.6 }) -> { x, y, width, height, side: 'left'|'right', arrowY }`:
    - Preferred side: left of the HUD, or right when the HUD's centre is in the left half of the work area.
    - If the preferred side doesn't fit, try the other. If neither fits, use the side with more room and clamp `x` inside the work area.
    - Height is capped at `floor(workArea.height * maxFrac)`.
    - `y = clamp(hud.y + rowY - 40, wa.y, wa.y + wa.height - h)`.
    - `arrowY = clamp(hud.y + rowY - y, 16, h - 16)`.
  - `panelTarget(selectedId, snapshot, { collapsed, visible }) -> string|null`: returns `selectedId` only when the HUD is visible, not collapsed, and the id is in `snapshot.agents`; otherwise `null`.

- [ ] **Step 1: Write the failing tests** in `test/wiring.test.js`.
  - `panelBounds: HUD in the right half → panel on the left, 8 px gap, arrow at the row`
  - `panelBounds: HUD in the left half → panel on the right`
  - `panelBounds: preferred side doesn't fit → other side; neither fits → side with more room, clamped inside the work area`
  - `panelBounds: height capped at 60% of the work area; y clamped inside it; arrowY between 16 and height-16`
  - `panelTarget: null when collapsed, hidden, or the agent is not in the snapshot (Review Focus 4); the id otherwise`
- [ ] **Step 2:** Run `node --test test/wiring.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement in `main.js`.**
  - **State:** `selected = { id, rowY } | null` and a lazily created `panelWin`. The panel window uses the Global Constraints options with `preload: preload-panel.cjs` and loads `renderer/panel.html`.
  - **`hud:selectAgent(id, rowY)`:**
    - The same id as the current selection closes the panel; any other id selects it.
    - It then calls `placePanel()`, then `pushNow()` and `pushDetail()`.
  - **`hud:rowOffset(id, rowY)`:** updates `rowY` when the id is selected, then calls `placePanel()`.
  - **`fromPanel(channel, handler)`:** like `fromHud`, but checks `e.sender === panelWin.webContents`. It handles three channels:
    - `panel:close`: clears the selection;
    - `panel:openWindow`: `openWindow(selected.id)`;
    - `panel:reportHeight`: stores the panel content height, then calls `placePanel()`.
  - **Focus mode:** if `PANEL_CLICK_MODE` is `pointerdown-focus`, also handle `panel:setInteractive`, mirroring `setInteractive` and `releaseFocus` for `panelWin`, and have `bootPanel` call it on `pointerdown` and after the click.
  - **`placePanel()`:** shows the panel with `showInactive()` and `setBounds(panelBounds(win.getBounds(), workArea(), …))` when `panelTarget(...)` returns an id; otherwise hides it. Call it at the end of `dock()`, after `setCollapsed`, `hideWindow` and `showWindow`, and on every snapshot push.
  - **`pushNow()`:** also sends `selected: selected?.id ?? null`. If `panelTarget` returns null while `selected` is set, clear `selected`.
  - **`pushDetail()`:** throttled like `push`. Sends `store.detail(selected.id)` on channel `detail` to `panelWin`.
  - **Stage tick:** `setInterval(() => { const k = store.stageKey(); if (k !== lastStageKey) { lastStageKey = k; push(); pushDetail(); } }, 1000)`.
  - **Quit:** destroys `panelWin`.
- [ ] **Step 4:** Run `npm test`. Expected: every test passes.
- [ ] **Step 5: Smoke check with `npm run dev`.** Confirm each item:
  - The rows show chips.
  - Clicking a character opens the panel beside the HUD, and clicking it again closes it.
  - Dragging the HUD to the left half flips the panel to the right.
  - Collapsing closes the panel.
  - Typing in another window isn't interrupted when you click the panel's ✕.
  - The global `~/.claude/settings.json` is untouched.
- [ ] **Step 6:** `git add src/main/wiring.js src/main/main.js test/wiring.test.js && git commit -m "feat: detail panel window beside the HUD"`
