# Agent HUD v1.4 — Attention: Bubble Stack, Sounds, Finish Recap, Plan Card, Chat Records — Implementation Plan

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
║  Several foes at once, fought one by one: bubble stack, sounds, finish   ║
║  recap, a plan card and chat records are separate fronts, each landing   ║
║  in the store, the answers and the panel; a reply spike runs alongside.  ║
╟──────────────────────────────────────────────────────────────────────────╢
║  ROGUES GALLERY                                                          ║
║  ◆ GREEN GOBLIN  reworking the panel's selection logic leaves a question ║
║                  nobody can open before its hold runs out                ║
║  ◆ THE SPOT      a chat-record field Codex rejects, failing the answer   ║
║                  closed in a chat that worked before                     ║
║  ◆ SANDMAN       stack, open card and details shifting mid-click as      ║
║                  questions come and go                                   ║
║  ◆ ELECTRO       sounds firing twice, or for every agent at HUD start    ║
║  ◆ CHAMELEON     autoplay policy or CSP silently muting the renderer     ║
║  ◆ MYSTERIO      a recap that miscounts long tasks (20-step cap)         ║
║  ◆ SCORPION      a 9-minute plan hold with no dialog in the chat         ║
╚══════════════════════════════════════════════════════════════════════════╝
```

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every waiting question shows as a compact bubble in a stack beside the HUD (click to expand into
its card), sounds announce questions and finishes, finished agents show a recap, ExitPlanMode gets a real
plan card, and every HUD answer leaves a record in the Claude or Codex chat.

**Architecture:** The queue already holds all questions at once; the store now publishes all of them
(`cards`) instead of one active card. A pure stack state machine in `wiring.js` replaces `autoSelect`;
main pushes a new `stack` message to the existing panel window, which renders bubbles above the agent's
details and mounts the one expanded card with the existing `mountCards`. Answers gain an optional
`systemMessage` record and a `plan` kind; sounds are decided by a pure cue function in the HUD renderer
and played with WebAudio or a custom file sent from main.

**Tech Stack:** Electron 44.7.2 (main + sandboxed preloads + renderers), plain ES modules, `node:test`.
No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-18-agent-hud-attention-design.md`

## Global Constraints

- Question hold stays `HOLD_MS = 60000`; reply hold `REPLY_MS = 540000`; **plan hold `PLAN_MS = 540000`** (user's decision).
- Queue order: permission, choice and plan cards in arrival order, then reply cards.
- Plan cards: Claude only, interactive sessions only. Codex never gets `plan`, `choice` or `reply` cards.
- Records start with `Agent HUD · ` and are one line of at most 160 characters (newlines collapsed). No record on release, hand-back, timeout or "open window".
- A record is added only for hosts in `RECORD_HOSTS`, which Task 2's spike sets. The default is an empty set, meaning no records.
- Sounds: none on the first snapshot after start, none while the HUD is hidden, none while muted. At most one cue per snapshot, and `needs` beats `finished`.
- Custom sounds: `.wav` (`audio/wav`), `.mp3` (`audio/mpeg`) and `.ogg` (`audio/ogg`), at most `2 * 1024 * 1024` bytes.
- Every string rendered as HTML goes through `esc()`. The CSP stays strict apart from adding `media-src blob:` to the HUD page.
- The panel never takes focus by itself (`focusable: false`, `releaseFocusOf`). The 500 ms arming (`ARM_MS`) applies to every answer button, the plan card's included.
- Main-process handlers stay wrapped by `guarded`, `fromHud` or `fromPanel`, so a throw is logged and never shows an error box.
- Dev runs: clear `ELECTRON_RUN_AS_NODE` before launching Electron from Claude's shell (`env -u ELECTRON_RUN_AS_NODE npm run dev`).

## Review Focus

1. **A card that disappears while expanded** (answered in its own window, timed out, or its session gone). The stack collapses it, the details go back to `before`, and a focused text box gives the focus back. Pinned in Task 8 (`stackUpdate` drops a vanished `expandedId`) and Task 11 (the panel ends interactive mode when the expanded card goes).
2. **Many questions at once (8 or more).** Every one gets a bubble and none is dropped; the panel scrolls inside its 60% cap. Pinned in Task 11 (`renderStack` with 9 summaries renders 9 bubbles).
3. **A huge or hostile plan** (100 KB, HTML, `<script>`). It is escaped, then cut at 20,000 characters with a hint to open the window. Pinned in Task 10.
4. **A custom sound file deleted or renamed after it was chosen.** Main logs it and sends `null`, and the renderer plays the default. Pinned in Task 13 (`readSoundFile` returns `null` for a missing file) and Task 12 (the player falls back when the audio element errors).
5. **The HUD restarted while agents already wait or are finished.** No sound plays. Pinned in Task 12 (`soundCue(null, snap)` only seeds and returns no cue).

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `spikes/*`, `spikes/SPIKES.md` | spikes 10–14: probes and results | modify / create |
| `src/main/steps.js` | per-task recap counters, `recapOf` | modify |
| `src/main/answers.js` | `withRecord`, plan encoders, `PLAN_EVENT`, `PLAN_MODES`, `RECORD_HOSTS` | modify |
| `src/main/records.js` | `recordText(item, response)`, `recordAllowed(session)` | create |
| `src/main/bubbles.js` | `bubbleLine(item)`: a bubble's short line | create |
| `src/main/queue.js` | per-kind hold incl. `plan`; `expiresAt` stamped on items | modify |
| `src/main/hook-server.js` | route ExitPlanMode → `plan` | modify |
| `src/main/store.js` | `cards` summaries, `cardById`, `recap`; drop `card`/`next` | modify |
| `src/main/wiring.js` | stack state machine, `panelShows`, `encodeAnswer` with records and plan, `soundFileOk`, `readSoundFile` | modify |
| `src/main/main.js` | stack, highlight and anchor wiring, IPC, Sounds tray menu, custom sound files, autoplay | modify |
| `src/preload.cjs`, `src/preload-panel.cjs` | new channels | modify |
| `src/renderer/cards.js` | `renderBubble`, plan card, `PLAN_MS` | modify |
| `src/renderer/panel.js`, `panel.css` | stack above the details, ring tick, hover | modify |
| `src/renderer/sounds.js` | `soundCue`, `createPlayer` | create |
| `src/renderer/hud.js`, `hud.css`, `index.html` | drop the Next line, recap sub-line, highlight, needs face reopens the stack, sounds, CSP | modify |

---

### Task 1: Spike — audio and hover in the HUD's windows (spikes 10–11)

**Files:** Create `spikes/audio-hover.mjs` (throwaway Electron script); modify `spikes/SPIKES.md`.

- [ ] **Step 1: Write `spikes/audio-hover.mjs`.** It's an Electron main process that opens two windows with the HUD's options: frameless, transparent, always on top, shown with `showInactive()`, `sandbox: true`, `webPreferences.autoplayPolicy: 'no-user-gesture-required'`, and the CSP `default-src 'self'; media-src blob:` (the page is written to a temp file).
  - **Window A:** 3 s after load it plays a WebAudio two-note chime (660 Hz then 880 Hz, 120 ms each, gain 0.15), then a Blob URL made from a generated 0.3 s WAV. It logs `AudioContext.state` and the `<audio>` play promise result.
  - **Window B** (`focusable: false`): logs `pointerenter`/`pointerleave` on a 200×100 box.
- [ ] **Step 2: Run it** with `env -u ELECTRON_RUN_AS_NODE npx electron spikes/audio-hover.mjs` while the user keeps typing in the editor. Expected:
  - the log shows `running` and a resolved play promise;
  - both sounds are heard;
  - hovering window B logs enter/leave;
  - the editor keeps focus.
- [ ] **Step 3: Record** the results in `spikes/SPIKES.md` as "Spike 10 — audio from an inactive window" and "Spike 11 — hover in a non-focusable window", yes/no each. If hover fails, write `HOVER_OK = false` there; Task 11 then skips the hover highlight.
- [ ] **Step 4: Commit** `git add spikes && git commit -m "spike: audio and hover in inactive HUD windows"`

### Task 2: Spike — ExitPlanMode and chat records per host (spikes 12–13, needs Spider-Man)

**Files:** Modify `spikes/hook-probe.mjs`, `spikes/SPIKES.md`.

- [ ] **Step 1: Add probe modes** to `spikes/hook-probe.mjs`, which already logs every payload to `hooks.jsonl`:
  - `--mode plan-allow-auto`: on a `PermissionRequest` with `tool_name === 'ExitPlanMode'`, reply `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow","updatedPermissions":[{"type":"setMode","mode":"acceptEdits","destination":"session"}]}},"systemMessage":"Agent HUD · Plan approved (auto-accept edits)"}`. Log a `PreToolUse` ExitPlanMode without answering it.
  - `--mode plan-keep`: on the same event, reply `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"deny","message":"Keep planning: add a rollback step"}},"systemMessage":"Agent HUD · Keep planning: add a rollback step"}`.
  - `--mode plan-hold --holdMs 60000`: hold the ExitPlanMode request without answering.
  - `--mode record`: answer every `PermissionRequest` with allow plus `"systemMessage":"Agent HUD · Allowed: <tool>"`. For Codex, use the same body behind the Codex bridge (the `spikes/codex/receiver.mjs` pattern).
- [ ] **Step 2: Write the checklist** under "Spike 12 — ExitPlanMode" and "Spike 13 — systemMessage per host" in `SPIKES.md`, then hand it to Spider-Man. For each host (VS Code panel, Claude desktop app, CLI): enter plan mode in `C:\Consortis_projects\agent-hud-spike`, ask for a two-step plan, and record:
  1. which event carries ExitPlanMode (PermissionRequest, PreToolUse or both) and its `tool_input` keys;
  2. after `plan-allow-auto`: whether Claude leaves plan mode, whether the mode is accept-edits, and whether the record shows;
  3. after `plan-keep`: whether Claude stays in plan mode and revises using the message;
  4. during `plan-hold`: whether the chat shows its own approval dialog while the hook is held, and whether answering there ends the held request;
  5. `record` mode on a Bash permission: whether the record shows and the command ran;
  6. Codex Desktop and Codex TUI in `record` mode: whether the command ran, whether the record shows, and any "hook failed" text.
- [ ] **Step 3: Write the decisions** under "Decisions" in `SPIKES.md`:
  - `PLAN_EVENT`: `'PermissionRequest'` or `'PreToolUse'`, whichever carried ExitPlanMode and accepted the answer;
  - `PLAN_MODES`: `true` if `setMode` switched the mode, otherwise `false`;
  - `RECORD_HOSTS`: the entrypoints where the record showed **and** the answer still took effect, chosen from `claude-vscode`, `claude-desktop`, `cli` and `codex`.

  **Stop and report to the user before Task 6** if the chat shows nothing to click during `plan-hold`. The 9-minute hold would then leave the chat blank, and the user decides whether to keep it.
- [ ] **Step 4: Commit** `git add spikes && git commit -m "spike: ExitPlanMode hook and systemMessage records per host"`

### Task 3: Spike — Claude's session messaging socket (release 2; parallel; read-only first)

**Files:** Create `spikes/messaging-socket.mjs`; modify `spikes/SPIKES.md`.

- [ ] **Step 1:** The script lists `~/.claude/sessions/*.json`, prints each `messagingSocketPath` and whether it exists (on Windows a named pipe `\\.\pipe\…`). It connects without writing and logs any bytes received within 5 s.
- [ ] **Step 2:** Only against a throwaway session started in `C:\Consortis_projects\agent-hud-spike`: send one newline-terminated JSON `{"type":"user_message","text":"Say PINEAPPLE"}`, then log the response and whether the chat reacts. Never send to any other session.
- [ ] **Step 3:** Record the results as "Spike 14 — messaging socket", ending with `REPLY_ANYWHERE = possible | not possible | unclear`. Commit with `spike: Claude session messaging socket`. No product code comes from this task.

### Task 4: Finish recap counters

**Files:** Modify `src/main/steps.js`, `src/main/store.js`; Test `test/steps.test.js`, `test/store.test.js`

**Interfaces:**
- Produces:
  - `view(id).recap: { files: number, commands: number, failed: number, helpers: number, endedAt: number|null }`;
  - `export function recapOf(recap, taskAt) -> string|null` in `steps.js`;
  - `AgentView.recap` and `detail.recap`: a string while `stage === 'turn'`, otherwise `null`.

- [ ] **Step 1: Write failing tests** in `test/steps.test.js`:

```js
test('recap counts edited files once, commands, failed commands and helpers, helpers included', () => {
  const log = createStepLog({});
  const ev = (event, x = {}) => log.push({ sessionId: 's', event, at: x.at ?? 1000, toolName: x.tool, toolInput: x.input, raw: { tool_name: x.tool, tool_input: x.input, ...x.raw } });
  ev('UserPromptSubmit', { raw: { prompt: 'do it' }, at: 0 });
  ev('PreToolUse', { tool: 'Edit', input: { file_path: 'C:/a/x.ts' } });
  ev('PreToolUse', { tool: 'Write', input: { file_path: 'C:/a/x.ts' } });
  ev('PreToolUse', { tool: 'apply_patch', input: { command: '*** Update File: y.ts\n*** Add File: z.ts' } });
  ev('PreToolUse', { tool: 'Bash', input: { command: 'npm test' } });
  ev('PostToolUseFailure', { tool: 'Bash', input: { command: 'npm test' } });
  ev('PostToolUseFailure', { tool: 'Read', input: { file_path: 'q' } });
  ev('SubagentStart', { raw: { agent_id: 'h1', agent_type: 'Explore' } });
  ev('PreToolUse', { tool: 'PowerShell', input: { command: 'ls' }, raw: { agent_id: 'h1' } });
  ev('PreToolUse', { tool: 'Edit', input: { file_path: 'C:/a/w.ts' }, raw: { agent_id: 'h1' } });
  ev('Stop', { at: 252000, raw: { last_assistant_message: 'done' } });
  assert.deepEqual(log.view('s').recap, { files: 4, commands: 2, failed: 1, helpers: 1, endedAt: 252000 });
});
test('recap resets on a real prompt, not on <task-notification>, and survives the 20-step cap', () => {
  // 25 Bash Pre/Post pairs after one prompt -> commands 25; a <task-notification> prompt keeps 25; a real prompt -> 0
});
test('recapOf formats parts, omits zeros, and marks tasks from before the HUD', () => {
  assert.equal(recapOf({ files: 6, commands: 12, failed: 1, helpers: 2, endedAt: 252000 }, 0), 'Done in 4m 12s · 6 files edited · 12 commands (1 failed) · 2 helpers');
  assert.equal(recapOf({ files: 1, commands: 0, failed: 0, helpers: 0, endedAt: 8000 }, 0), 'Done in 8s · 1 file edited');
  assert.equal(recapOf({ files: 0, commands: 0, failed: 0, helpers: 0, endedAt: 8000 }, 0), 'Done in 8s · no tool steps');
  assert.equal(recapOf({ files: 0, commands: 3, failed: 0, helpers: 0, endedAt: 8000 }, null), 'Since the HUD started: 3 commands');
  assert.equal(recapOf({ files: 0, commands: 0, failed: 0, helpers: 0, endedAt: 3_900_000 }, 0), 'Done in 1h 5m · no tool steps');
  assert.equal(recapOf(null, 0), null);
});
```

  And in `test/store.test.js`: `recap` holds the `recapOf` text for an agent at stage `turn` and is `null` at `working`, both in `snapshot().agents` and in `detail(id)`.
- [ ] **Step 2: Run** `node --test test/steps.test.js test/store.test.js`. Expected: FAIL (`recap` is undefined and `recapOf` isn't exported).
- [ ] **Step 3: Implement.**
  - **Step log:** each session record gets `counts: { files: new Set(), commands: 0, failed: 0, helpers: 0, endedAt: null }`, reset with the task on a non-synthetic `UserPromptSubmit`.
  - **Counting** happens **before** the helper early return:
    - `PreToolUse` for Edit, Write or NotebookEdit adds `file_path || notebook_path`; for apply_patch it adds each of `patchPaths(...)`; for Bash or PowerShell it adds a command;
    - `PostToolUseFailure` for Bash or PowerShell adds a failure;
    - `SubagentStart` adds a helper;
    - a main-thread `Stop` sets `endedAt`.
  - **`view()`** returns `recap`, with `files` as the Set's size.
  - **`recapOf`:**
    - the duration is `endedAt - taskAt`, written as `Ns` under 60 s, `Mm Ss` under an hour, otherwise `Hh Mm`;
    - the parts come in this order: files, commands (with ` (N failed)` when N > 0), helpers, each singular when it is 1;
    - no parts gives `no tool steps`;
    - `taskAt == null` gives `Since the HUD started: ` followed by the parts, with no duration.
  - **Store:** `recap: stage === 'turn' ? recapOf(view.recap, view.taskAt) : null` on the AgentView and in `detail`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat: finish recap counters per task"`

### Task 5: Chat records and plan encoders

**Files:** Modify `src/main/answers.js`, `src/main/wiring.js`, `src/main/main.js`; Create `src/main/records.js`; Test `test/answers.test.js` (new), `test/wiring.test.js`

**Interfaces:**
- Consumes: Task 2's `PLAN_EVENT`, `PLAN_MODES` and `RECORD_HOSTS`, copied into `answers.js` as exported constants with a comment pointing at SPIKES.md.
- Produces:
  - `answers.js`:
    - `export const PLAN_EVENT`, `export const PLAN_MODES`, `export const RECORD_HOSTS` (a `Set`);
    - `export function withRecord(response, text)`: returns a copy of `response` with a top-level `systemMessage` when `text` is a non-empty string, otherwise `response` itself; never mutates its input;
    - `export function planApprove(mode)` and `export function planKeepPlanning(feedback)`.
  - `records.js`:
    - `export function recordText(item, response) -> string|null`;
    - `export function recordAllowed(session) -> boolean`: `RECORD_HOSTS.has('codex')` when `session.source === 'codex'`, otherwise `RECORD_HOSTS.has(session.entrypoint)`; `false` for anything missing.
  - `wiring.js`: `encodeAnswer(item, response, { record = false } = {})` gains a `'plan'` case. When `record` is true and the encoding isn't `null`, it wraps the result with `withRecord(encoded, recordText(item, response))`.

- [ ] **Step 1: Write failing tests.**

```js
// test/answers.test.js
test('withRecord adds systemMessage without touching the decision', () => {
  const base = permissionAllow();
  assert.deepEqual(withRecord(base, 'Agent HUD · Allowed: npm test'), { ...base, systemMessage: 'Agent HUD · Allowed: npm test' });
  assert.equal(withRecord(base, null), base);
  assert.equal('systemMessage' in base, false);
});
// planApprove / planKeepPlanning, for the PLAN_EVENT value the spike set:
//   'PermissionRequest': approve -> decision allow, plus updatedPermissions
//     [{ type:'setMode', mode, destination:'session' }] when PLAN_MODES;
//     keep -> decision deny, message 'Keep planning: <feedback>' ('Keep planning' when empty).
//   'PreToolUse': approve -> { hookSpecificOutput: { hookEventName:'PreToolUse', permissionDecision:'allow' } };
//     keep -> permissionDecision 'deny', with permissionDecisionReason as above.

// test/wiring.test.js
test('recordText per kind', () => {
  const bash = { kind: 'permission', payload: { tool_name: 'Bash', tool_input: { command: 'npm test' } } };
  assert.equal(recordText(bash, { kind: 'allow' }), 'Agent HUD · Allowed: npm test');
  assert.equal(recordText(bash, { kind: 'allow', always: true }), 'Agent HUD · Always allowed here: npm test');
  assert.equal(recordText(bash, { kind: 'deny' }), 'Agent HUD · Denied: npm test');
  const edit = { kind: 'permission', payload: { tool_name: 'Edit', tool_input: { file_path: 'C:/p/src/a.ts' } } };
  assert.equal(recordText(edit, { kind: 'allow' }), 'Agent HUD · Allowed: Edit a.ts');
  const ch = { kind: 'choice', payload: { tool_input: { questions: [{ question: 'Which DB?' }, { question: 'Port?' }] } } };
  assert.equal(recordText(ch, { kind: 'choice', picks: { 'Which DB?': 'Postgres', 'Port?': ['5432', '5433'] } }), 'Agent HUD · Answered: Which DB? → Postgres; Port? → 5432, 5433');
  const plan = { kind: 'plan', payload: {} };
  assert.equal(recordText(plan, { kind: 'plan', approve: 'acceptEdits' }), 'Agent HUD · Plan approved (auto-accept edits)');
  assert.equal(recordText(plan, { kind: 'plan', approve: 'default' }), 'Agent HUD · Plan approved (ask before edits)');
  assert.equal(recordText(plan, { kind: 'plan', keep: true, feedback: 'add\nrollback' }), 'Agent HUD · Keep planning: add rollback');
  assert.equal(recordText({ kind: 'reply', payload: {} }, { kind: 'reply', text: 'x'.repeat(200) }), `Agent HUD · You replied: ${'x'.repeat(80)}…`);
  assert.ok(recordText(bash, { kind: 'allow', always: true }).length <= 160);
});
// encodeAnswer: record false -> no systemMessage; record true -> systemMessage; an invalid response
//   with record true -> null.
// encodeAnswer plan: approve 'acceptEdits' | 'default'; keep with and without feedback; without
//   PLAN_MODES both approves give the same plain approve.
// recordAllowed: follows RECORD_HOSTS by entrypoint, Codex by source; an unknown session -> false.
```

- [ ] **Step 2: Run** `node --test test/answers.test.js test/wiring.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **What a permission's record names:** Bash and PowerShell → the command; Edit, Write, NotebookEdit and Read → `<Tool> <basename>`; anything else → the tool name.
  - **Trimming:** collapse whitespace. Cap feedback at 120 characters and replies at 80, adding `…` when cut. Cap the whole record at 160.
  - **`encodeAnswer`, plan case:** `approve` must be `'acceptEdits'` or `'default'`; without `PLAN_MODES`, both encode the plain approve. `keep: true` takes an optional string `feedback`. Anything else → `null`.
  - **Caller in `main.js`** (`answerCard`): `encodeAnswer(item, response, { record: recordAllowed(sessionById(item.sessionId) ?? { source: item.source }) })`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat: chat records on HUD answers; plan answer encoders"`

### Task 6: Plan cards in the hook server and queue

**Files:** Modify `src/main/queue.js`, `src/main/hook-server.js`, `src/main/store.js`, `src/main/main.js`; Test `test/queue.test.js`, `test/hook-server.test.js`

**Interfaces:**
- Consumes: `PLAN_EVENT` (Task 5).
- Produces:
  - `createQueue({ holdMs, replyMs, planMs = 540000, ... })`;
  - every added item gets `addedAt` and **`expiresAt = addedAt + hold for its kind`**;
  - `list()` order: non-reply kinds in arrival order, then replies;
  - a new hook-server card kind `'plan'`, whose `payload` is the hook body.

- [ ] **Step 1: Write failing tests.**
  - **Queue** (fake timers):
    - a `plan` item is released at `planMs` and recorded in `handedBack`;
    - it sorts ahead of an earlier `reply`;
    - `expiresAt === addedAt + hold` for every kind.
  - **Hook server** (the existing fake-queue harness):
    - ExitPlanMode on `PLAN_EVENT` from an interactive Claude session is held as `plan`;
    - the same from a non-interactive session, or from Codex, gets an empty 200 and nothing is held;
    - if `PLAN_EVENT === 'PreToolUse'`, a later `PermissionRequest` for ExitPlanMode is not held (like AskUserQuestion, I4);
    - if `PLAN_EVENT === 'PermissionRequest'`, ExitPlanMode is never held as a `permission` card;
    - each of these releases a held plan: a main-thread `PostToolUse` for ExitPlanMode, a non-synthetic `UserPromptSubmit`, and a `Stop` with no background tasks running.
- [ ] **Step 2: Run** `node --test test/queue.test.js test/hook-server.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Queue:** `holdFor(kind)` returns `replyMs` for `reply`, `planMs` for `plan`, and `holdMs` otherwise.
  - **Hook server:**
    - `releaseMainQuestions` covers `permission`, `choice` and `plan`;
    - the PostToolUse release also matches `plan` items by session, `ExitPlanMode` and the main thread;
    - the `plan` routing branch sits before the `permission` branch.
  - **main.js:** add `const PLAN_MS = 540000` and pass `planMs: PLAN_MS` to `createQueue`.
  - **Store:** `activeCard` reads `item.expiresAt` instead of computing it from the hold times.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat: ExitPlanMode becomes a plan card held 9 minutes"`

### Task 7: The store publishes every held card

**Files:** Create `src/main/bubbles.js`; Modify `src/main/store.js`; Test `test/bubbles.test.js` (new), `test/store.test.js`

**Interfaces:**
- Produces:
  - `bubbles.js`: `export function bubbleLine(item) -> string`, at most 60 characters plus `…`.
  - `store.snapshot()` → `{ agents, tucked, cards: CardSummary[], counts }`, with **no `card` and no `next`**.
    - `CardSummary = { id, kind, sessionId, display, cls, source, line, expiresAt, canOpen }`, in `queue.list()` order.
  - `store.cardById(id) -> FullCard|null`.
    - `FullCard = { id, kind, sessionId, display, cls, source, payload, expiresAt, canOpen, planModes }`; `planModes` is `PLAN_MODES` on plan cards.
  - `store.detail(id)`: drops `card`, keeps `hasCard` (true while any of its questions is held) and carries `recap` (Task 4).

- [ ] **Step 1: Write failing tests.**
  - **`bubbleLine`:**
    - Bash `{ command: 'npm  publish --tag next' }` → `'Bash: npm publish --tag next'`;
    - Edit `{ file_path: 'C:/x/src/a.ts' }` → `'Edit: a.ts'`;
    - WebFetch `{ url: 'https://docs.x.com/a' }` → `'WebFetch: docs.x.com'`;
    - a 200-character command → its first 60 characters + `…`;
    - choice with one question `{ header: 'DB', question: 'Which DB?', options: [a, b, c] }` → `'DB · 3 options'`; with 3 questions → `'DB · 3 options · +2 more'`; with no header → the question text;
    - plan `{ plan: 'a\nb\n\nc' }` → `'Plan ready · 3 lines'` (non-empty lines);
    - reply `{ last_assistant_message: 'All done here' }` → `'All done here'`; empty → `'wants a reply'`.
  - **Store**, with three held items arriving as permission (s1), reply (s2), choice (s3):
    - `snapshot().cards` lists permission, choice, reply, with `line` and `expiresAt` filled in;
    - `snapshot().card` and `snapshot().next` are `undefined`;
    - `cardById(choiceId).payload` is the hook body;
    - `detail('s1').card` is `undefined` and `detail('s1').hasCard` is `true`.
- [ ] **Step 2: Run** `node --test test/bubbles.test.js test/store.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `bubbleLine` (reuse `patchPaths`; basename via `path.win32.basename`) and the store changes. Update existing store tests that read `snap.card` or `snap.next` to use `cards[0]`.
- [ ] **Step 4: Run** `npm test`. Main-side tests must PASS. HUD and panel render tests may still fail on `card`/`next`: Tasks 11 and 12 update them. Say so in the commit message.
- [ ] **Step 5: Commit** `git commit -am "feat: store publishes every held question as a bubble summary"`

### Task 8: Stack selection state machine

**Files:** Modify `src/main/wiring.js`; Test `test/wiring.test.js`

**Interfaces:**
- Produces pure functions. Each returns a new state, and `cards` is always a `CardSummary[]`.
  - `StackState = { selected: {id,rowY}|null, auto: boolean, before: {id,rowY}|null, expandedId: string|null, hidden: boolean, seen: string[] }`, and `export const STACK_INIT`.
  - `stackUpdate(state, cards)`, run on every push:
    - if `expandedId` has vanished, set it to `null`, and when `auto`, restore `selected = before` and set `auto = false`;
    - while `hidden`, any card id not in `seen` sets `hidden = false, seen = []`;
    - no cards at all also sets `hidden = false, seen = []`.
  - `stackExpand(state, cardId, cards)`:
    - an unknown id changes nothing;
    - the id already in `expandedId` collapses it (`expandedId = null`, restore `before` when `auto`);
    - otherwise it sets `expandedId = cardId`, `selected = { id: card.sessionId, rowY }` (keeping the old `rowY` for the same agent, else `null`), `auto = true`, and `before = state.auto ? state.before : state.selected`.
  - `stackHide(state, cards)` → `{ ...STACK_INIT, hidden: cards.length > 0, seen: <card ids> }`.
  - `stackShow(state)` → `hidden = false, seen = []`.
  - `userSelect(state, sel, cards = [])` replaces the current one:
    - sets `selected = sel`, `auto = false`, `before = null`;
    - collapses `expandedId` when its card belongs to another session than `sel?.id`;
    - if `hidden` and `sel`'s agent has a card, sets `hidden = false, seen = []`.
  - `stackVisible(state, cards)` = `cards.length > 0 && !state.hidden`.
  - `panelShows(state, snapshot, { collapsed, visible, tuckOpen }) -> { stack: boolean, detailId: string|null }`:
    - nothing shows when `!visible`;
    - `stack` is `stackVisible(...)`;
    - `detailId` follows today's `panelTarget` rule for `state.selected`, where `hasCard` means the selected agent owns the expanded card.
  - `anchorOf(state, cards)` = `state.selected?.id ?? cards[0]?.sessionId ?? null`: the row the panel's arrow points at.
  - Remove `autoSelect` and `hudCard`; keep `closeApplies`.

- [ ] **Step 1: Write failing tests**, one per rule above, plus these sequences:
  - (a) two cards arrive → the stack is visible, nothing is selected, and `anchorOf` is the first card's session;
  - (b) the user has s9's details open and expands s1's card → `selected` s1, `before` s9; the card is then answered → `selected` is s9 again;
  - (c) expand A, then expand B → `expandedId` is B and `before` is still the original selection;
  - (d) `stackHide` with cards [a, b] → hidden; `stackUpdate` with [a, b] stays hidden; with [a, b, c] it becomes visible;
  - (e) while hidden, `userSelect` on a waiting row makes the stack visible; on a non-waiting row it stays hidden and that agent's details show;
  - (f) with the HUD collapsed, `detailId` is set only for the expanded card's agent.
- [ ] **Step 2: Run** `node --test test/wiring.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement**, and delete the old `autoSelect`/`hudCard` code and tests.
- [ ] **Step 4: Run** `node --test test/wiring.test.js`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat: stack selection state for the bubble stack"`

### Task 9: Main process wiring for the stack

**Files:** Modify `src/main/main.js`, `src/preload.cjs`, `src/preload-panel.cjs`

**Interfaces:**
- Consumes: Task 7 (`snapshot().cards`, `cardById`) and Task 8 (the stack functions).
- Produces these IPC messages:
  - main → panel `'stack'`: `{ cards: CardSummary[], expanded: FullCard|null, visible: boolean }`;
  - main → panel `'detail'`: unchanged shape, and `null` when `detailId` is null;
  - main → HUD `'snapshot'` gains `cards`, `anchor` (`anchorOf`) and `highlight` (a session id or `null`); `selected` is unchanged;
  - panel → main: `panel:expandCard(id)`, `panel:hoverCard(id|null)` and `panel:hideStack()`, alongside the existing ones;
  - HUD → main: `hud:showStack()`. `hud:rowOffset(id, y)` now stores `anchorRow = { id, rowY }` for whichever id the HUD reports (it reports `snap.anchor`);
  - preloads: `window.panel` gains `onStack(fn)`, `expandCard(id)`, `hoverCard(id)` and `hideStack()`; `window.hud` gains `showStack()`.

- [ ] **Step 1: Replace `pick`** with `let pick = STACK_INIT` and add `let anchorRow = null`. `pushNow` does this, in order:
  - `pick = stackUpdate(pick, snap.cards)`;
  - close a user selection whose agent has left, as today, now through `panelShows(...).detailId`;
  - send the HUD snapshot with the new fields;
  - call `placePanel(snap)`, `pushDetail()` and `pushStack()`. `pushStack` is throttled like `pushDetail` and skips an unchanged JSON.
- [ ] **Step 2: Update `placePanel`.** It shows the panel when `panelShows` gives `stack || detailId`, with `rowY = anchorRow?.id === anchorOf(pick, snap.cards) ? anchorRow.rowY : null` passed to `panelBounds`. Otherwise it calls `releaseFocusOf` and hides the panel.
- [ ] **Step 3: Add the IPC handlers:**
  - `panel:expandCard` → `stackExpand`;
  - `panel:hideStack` → `stackHide`;
  - `panel:hoverCard` → sets `highlight` to that card's session (or `null`) and calls `push()`;
  - `hud:showStack` → `stackShow`;
  - `hud:selectAgent` → `userSelect(pick, <toggled selection>, snap.cards)`;
  - `hud:hideAgent` and `panel:close` keep their current rules, through `userSelect(pick, null, cards)`.

  Every handler then calls `placePanel(); pushNow();`. `answerCard` and `releaseCard` are unchanged apart from Task 5's `record` option.
- [ ] **Step 4: Verify.**
  - `npm test`: main-side tests PASS (renderer tests may still fail until Tasks 10–12);
  - `env -u ELECTRON_RUN_AS_NODE npm run dev`: the app starts without an error box;
  - POSTing a dev PermissionRequest with `spikes/hook-probe.mjs` makes the panel appear.
- [ ] **Step 5: Commit** `git commit -am "feat: main wires the bubble stack, highlight and anchor"`

### Task 10: Bubbles and the plan card (cards.js)

**Files:** Modify `src/renderer/cards.js`, `src/renderer/panel.css`; Test `test/cards.test.js`

**Interfaces:**
- Produces:
  - `export const PLAN_MS = 540000`. `holdOf` returns it for `plan`, and `cardLeftMs` accepts `plan`.
  - `export function renderBubble(summary, { nowMs, expanded = false }) -> string`: a `<button type="button" class="bub" data-act="expand" data-card="<id>" data-session="<sid>" aria-expanded="<bool>">` containing:
    - the agent's sprite (`spriteSvg(cls, 1, { source })`) and name;
    - a kind icon: `!` permission, `?` choice, `▤` plan, `↩` reply;
    - `line`;
    - a countdown ring, `<i class="ring" data-ring data-expires="<expiresAt>" data-hold="<hold>" style="--p:<0..100>">`.
  - `renderCard` handles `plan`:
    - the plan text in `<div class="plan">`, every line escaped and lines starting with `#` in `<b>`;
    - text over 20,000 characters is cut there and followed by `<p class="plan-more">Open the window to read the rest.</p>`;
    - buttons: with `card.planModes`, `data-act="approve-auto"` "Approve · auto-accept edits" and `data-act="approve-ask"` "Approve · ask before edits"; without it, one `data-act="approve"` "Approve";
    - `<input data-feedback placeholder="What should change?">` with a `data-act="keep"` "Keep planning" button;
    - the timer "Back to its window in".
  - `mountCards` answers a plan card with `{ kind:'plan', approve:'acceptEdits' }`, `{ kind:'plan', approve:'default' }` (also for the single `approve`), or `{ kind:'plan', keep:true, feedback }`. The feedback box calls `onInteractive` the way the reply box does, and its draft is kept per card id. `ARMED_ACTS` gains `approve-auto`, `approve-ask`, `approve` and `keep`.

- [ ] **Step 1: Write failing tests:**
  - a bubble escapes `display` and `line` (an `<img onerror>` stays inert) and carries `data-card`, `aria-expanded` and the ring attributes;
  - a plan card escapes `<script>`, bolds `# Heading`, cuts at 20,000 characters with the hint, and shows two approve buttons or one depending on `planModes`;
  - `clickAllowed('keep', since, since + 100)` is false and `clickAllowed('keep', since, since + 500)` is true;
  - `cardLeftMs` of a plan card without `expiresAt` is `PLAN_MS - elapsed`.
- [ ] **Step 2: Run** `node --test test/cards.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement**, including CSS from the `tokens.css` tokens:
  - `.bub` and `.bub[aria-expanded=true]`;
  - `.ring`, a conic gradient on `--p`;
  - `.plan`: max-height 260 px, `overflow: auto`, `white-space: pre-wrap`.

  Reduced motion turns off the ring's transition.
- [ ] **Step 4: Run** `node --test test/cards.test.js`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat: bubbles and the plan card"`

### Task 11: The panel draws the stack above the details

**Files:** Modify `src/renderer/panel.js`, `src/renderer/panel.css`; Test `test/panel-render.test.js`

**Interfaces:**
- Consumes: the `'stack'` message (Task 9), and `renderBubble`/`renderCard` (Task 10).
- Produces:
  - `export function renderStack(stack, nowMs, cardOpts) -> string`. It returns `''` when `!stack?.visible`. Otherwise it returns `<div class="stack" data-key="stack" data-deep>` containing:
    - a header: `<span>N waiting</span><button data-act="hide-stack" aria-label="Hide the questions">✕</button>`;
    - for each summary, a `<div class="bub-wrap" data-key="bub:<id>" data-deep>` holding `renderBubble`;
    - inside the expanded summary's wrapper only, after its bubble, `<div class="card-slot" data-key="card:<id>" data-sticky>` + `renderCard(stack.expanded, cardOpts)`.
  - `renderPanel(detail, nowMs)` no longer renders a card slot, and `needsNote` returns `''` when `d.hasCard`.
  - `finishedBlock(d)` puts `d.recap` first, as `<p class="recap">` under the "Finished" label and above the last message. With a recap but no last message, the label and the recap still show.
  - The panel root is `renderStack(...) + (detail ? renderPanel(...) : '')`.
  - `panelAction` adds `'expand'` → `{ call: 'expandCard', id: <data-card> }` and `'hide-stack'` → `{ call: 'hideStack' }`.

- [ ] **Step 1: Write failing tests:**
  - 9 summaries render 9 `.bub` elements;
  - the expanded one has a card slot right after its bubble, and the others have none;
  - an invisible stack renders `''`;
  - `renderPanel` with `hasCard` has neither a needs note nor a card slot;
  - `panelAction('expand', …)` returns the card id;
  - a stack with a `null` detail renders only the stack;
  - a `turn` detail with `recap: 'Done in 8s · 1 file edited'` shows it under "Finished", before the last message, and escaped.
- [ ] **Step 2: Run** `node --test test/panel-render.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement `bootPanel`:**
  - keep `stack` and `detail`, and render on either message through the same render gate;
  - call `cards.show(stack?.expanded ?? null, now)`, so an expanded card that vanishes ends interactive mode exactly as a vanished `detail.card` did;
  - the 1 s tick also updates each `[data-ring]`'s `--p` from `data-expires` and `data-hold`;
  - `pointerenter`/`pointerleave` on a `.bub` call `hoverCard(id|null)`; skip this if Task 1 recorded `HOVER_OK = false`;
  - on a newly expanded id, scroll its bubble into view with `scrollIntoView({ block: 'nearest' })`, replacing `shouldScrollTop`.
- [ ] **Step 4: Run** `npm test`. Expected: the panel tests PASS.
- [ ] **Step 5: Commit** `git commit -am "feat: panel shows the bubble stack above the agent's details"`

### Task 12: HUD renderer — rows, highlight, reopening the stack, sounds

**Files:** Create `src/renderer/sounds.js`; Modify `src/renderer/hud.js`, `src/renderer/hud.css`, `src/renderer/index.html`; Test `test/sounds.test.js` (new), `test/hud-render.test.js`

**Interfaces:**
- Produces:
  - `sounds.js`:
    - `export function soundCue(prev, snap) -> { cue: 'needs'|'finished'|null, state: { cards: Set<string>, turn: Set<string> } }`:
      - `prev === null` only seeds the state and returns `cue: null`;
      - `needs` when any `snap.cards` id is new;
      - otherwise `finished` when an agent in `snap.agents` has `stage === 'turn'` and wasn't in `prev.turn`. This is the same rule as `hud.js`'s `newlyFinished`, but `sounds.js` must not import `hud.js` (`hud.js` imports `sounds.js`). Only visible `agents` count, never `tucked`;
      - `cue` is forced to `null` when `snap.sound?.muted || snap.sound?.quiet`, but `state` still advances.
    - `export function createPlayer({ makeContext, makeAudio, makeUrl, revokeUrl }) -> { play(cue), setCustom(cue, file|null) }`, where `file = { bytes: Uint8Array, mime }`:
      - the default synth plays two 120 ms notes: `needs` 660 Hz then 880 Hz at gain 0.15, `finished` 523 Hz then 784 Hz at gain 0.1;
      - a custom file plays through `makeAudio(blobUrl)`. A rejected `play()` or an `error` event falls back to the synth for that cue.
  - `renderRow(agent, { ask, selected, tucked, highlighted })`: adds the class `hl` when highlighted. At stage `turn` with `agent.recap`, the sub-line reads `<cls> · <recap>` instead of "finished".
  - `renderParty`:
    - takes each row's `ask` from that session's first `snap.cards` entry;
    - drops the Next line and `nextLine`;
    - gives a needs face in the collapsed HUD `data-act="ask"`.
  - `boot`:
    - the `ask` action calls `call('showStack')`;
    - `syncRowOffset` reports `snap.anchor` instead of `snap.selected`.

- [ ] **Step 1: Write failing tests.**

```js
test('soundCue seeds on the first snapshot and plays nothing', () => {
  const r = soundCue(null, { cards: [{ id: 'c1' }], agents: [{ id: 'a', stage: 'turn' }] });
  assert.equal(r.cue, null);
});
// soundCue: a new card -> needs; needs beats finished; a tucked agent finishing is silent;
//   muted or quiet -> null cue, but the state still advances.
// createPlayer: falls back to the synth when the custom audio's play() rejects.
```

  And in `test/hud-render.test.js`:
  - no `.queue` element, even with three cards;
  - the `hl` class on a highlighted row;
  - the recap sub-line;
  - the needs face has `data-act="ask"`;
  - a row's `ask` comes from `cards`.
- [ ] **Step 2: Run** `node --test test/sounds.test.js test/hud-render.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - In `boot`, keep `st.sound = null`. After each snapshot render, `({ cue, state } = soundCue(st.sound, snap))`, then `player.play(cue)` when `cue` is set.
  - Create the player on the first non-null cue, with one `AudioContext`.
  - Listen with `onSoundFile((cue, file) => player.setCustom(cue, file))`; the preload side comes in Task 13.
  - In `index.html`, append `; media-src blob:` to the CSP.
- [ ] **Step 4: Run** `npm test`. Expected: the whole suite PASSES.
- [ ] **Step 5: Commit** `git commit -am "feat: HUD rows show recaps, highlight, reopen the stack, and play sounds"`

### Task 13: Sounds menu, custom files, autoplay

**Files:** Modify `src/main/main.js`, `src/main/wiring.js`, `src/preload.cjs`; Test `test/wiring.test.js`

**Interfaces:**
- Produces:
  - `wiring.js`:
    - `export function soundFileOk(filePath, size) -> { ok: true, mime } | { ok: false, reason }`: the extension check ignores case, the size must be at most 2 MiB, and the reasons are `'type'` and `'size'`;
    - `export function readSoundFile(filePath, { readFile = fs.readFileSync, stat = fs.statSync } = {}) -> { bytes, mime } | null`: `null` on any error or when `soundFileOk` fails.
  - Config: `sounds: { muted: boolean, needs: string|null, finished: string|null }`, defaulting to `{ muted: false, needs: null, finished: null }`.
  - The HUD snapshot gains `sound: { muted, quiet: !<HUD visible> }`.
  - main → HUD `'sound-file'` `(cue, file|null)`, and preload `onSoundFile(fn)`.

- [ ] **Step 1: Write failing tests:**
  - `soundFileOk('a.WAV', 10)` → `{ ok: true, mime: 'audio/wav' }`;
  - `.mp3` → `'audio/mpeg'`, `.ogg` → `'audio/ogg'`;
  - `'a.flac'` → `{ ok: false, reason: 'type' }`;
  - a size of `2 * 1024 * 1024 + 1` → `{ ok: false, reason: 'size' }`;
  - `readSoundFile` with a `stat` that throws → `null`.
- [ ] **Step 2: Run** `node --test test/wiring.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Tray "Sounds" submenu:**
    - `Mute` (checkbox);
    - `Needs-you sound` with `Choose…` and `Default` (checked when no file is set);
    - `Finished sound`, the same.
  - **`Choose…`** opens `dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Sounds', extensions: ['wav', 'mp3', 'ogg'] }] })`:
    - a file that fails `readSoundFile` gets a `dialog.showMessageBox` naming the type or size limit, and nothing changes;
    - a good file is saved to the config and sent with `'sound-file'`, then `refreshMenu()` runs.
  - **On the HUD's `did-finish-load`**, send both saved sounds (`null` for the default or an unreadable file, which is logged).
  - **HUD `webPreferences`**: `autoplayPolicy: 'no-user-gesture-required'`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat: sounds menu with custom files and mute"`

### Task 14: Live check and docs

**Files:** Modify `spikes/SPIKES.md` (a "v1.4 live check" section) and `docs/superpowers/specs/2026-11-18-agent-hud-attention-design.md` (status → implemented, plus any changes the spikes forced).

- [ ] **Step 1:** Run `npm test`. Every test must pass. Paste the summary line into the commit message.
- [ ] **Step 2:** Run `env -u ELECTRON_RUN_AS_NODE npm run dev`, with dev hooks pointed at `C:\Consortis_projects\agent-hud-spike` (`AGENT_HUD_SETTINGS_PATH`, as in earlier releases). Spider-Man works through this checklist and each result is recorded:
  1. Two scratch sessions each ask for a permission → two bubbles and one chime, and the editor keeps focus.
  2. Expanding one shows its card, with its row highlighted and its details below. Allow → the chat shows `Agent HUD · Allowed: …` (if that host is in `RECORD_HOSTS`).
  3. The other bubble counts down and hands back at 60 s ("Waiting in its window").
  4. ✕ on the stack hides it. Clicking the glowing row brings it back, and so does a new question.
  5. Plan mode in a scratch session → a plan bubble reading "Plan ready · N lines".
     - Approve with auto-accept → the record shows and Claude continues in accept-edits.
     - Keep planning with feedback → Claude revises the plan.
  6. A Codex permission answered from the HUD runs (with a record only if `codex` is in `RECORD_HOSTS`).
  7. Finishing a turn plays the finished sound and shows the recap on the row and in the panel.
  8. Tray → Sounds:
     - choose a custom `.wav` and hear it;
     - delete the file and restart the HUD → the default sound plays;
     - Mute silences everything.
- [ ] **Step 3: Commit** `git commit -am "chore: v1.4 attention live check"`
