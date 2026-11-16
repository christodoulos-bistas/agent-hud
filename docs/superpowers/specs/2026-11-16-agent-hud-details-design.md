# Agent HUD — agent details and stages (v1.1) — design

Status: draft for approval · 16 November 2026 · builds on `2026-11-16-agent-hud-design.md` (v1, implemented on branch `agent-hud-v1`)

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

## 1. Intent

The user runs several Claude Code agents in parallel. The HUD already shows
each one's class and a one-line activity. What the user still can't tell
without switching windows is:

- **whether an agent is stuck**, or
- **which step it's on**.

Two additions answer both:

1. **A stage chip on every row**: a clear, coloured status in place of
   today's small grey "· working / finished / idle" text.
2. **A detail panel** that opens beside the HUD when you click a character.
   It shows the task, the current step with a live timer, recent steps with
   ✓/✗ and the error text, any helper agents, and a "Stuck?" reason when
   one applies.

## 2. Goals, non-goals, anti-goals

**Goals**
- See every agent's stage at a glance: Thinking, Working, Needs you, Your
  turn, Idle, plus a ⚠ Stuck? hint.
- Click any character to see what it's doing now, what it did recently,
  and whether it's going round in circles.
- Get a "Stuck?" hint without opening anything.

**Non-goals**
- Reading Claude's session transcripts, or showing Claude's own running
  commentary. The user chose hooks only.
- History from before the HUD started. A session already running when the
  HUD starts shows only what happens after that.
- Stopping, interrupting or restarting agents from the HUD. "Stuck?" is a
  hint, never an action.
- Showing file diffs or full tool output.

**Anti-goals: failure even if it works**
- The panel steals keyboard focus, or leaves an invisible area that
  swallows clicks over the editor.
- "Stuck?" fires on healthy work often enough that the user stops trusting
  it.
- The HUD itself changes size or layout when a panel opens. The user
  picked the beside-the-HUD panel so that it wouldn't.
- Memory grows without bound.

## 3. Constraints

- Everything comes from the HUD's existing hook events (spec v1 §6.1;
  payload facts in `spikes/SPIKES.md`):
  - PreToolUse: `tool_name`, `tool_input` (Bash/PowerShell include a
    `description`), `tool_use_id`.
  - PostToolUse: adds `tool_response`, `duration_ms`.
  - PostToolUseFailure.
  - UserPromptSubmit: `prompt`; synthetic `<task-notification>` prompts
    are not tasks.
  - Stop: `last_assistant_message`, `background_tasks`.
  - SubagentStart/Stop: `agent_id`, `agent_type`. Subagent events share
    the parent's `session_id` and carry `agent_id`/`agent_type`.
- Same house style, escaping, CSP and sandboxing as v1. Every displayed
  string goes through `esc()`.
- The HUD stays 272 px wide (72 px collapsed), draggable with snapping. The
  panel must work wherever the user has put the HUD, on any monitor.
- Windows 11, Electron 44.7.2, no new dependencies.

## 4. Approaches considered

**Where the panel opens** (mocked up at actual size:
`.superpowers/brainstorm/1378-1794812926/content/hud-detail.html`)
- **Chosen: B, beside the HUD.** A ~340 px panel next to the HUD,
  pointing at the character. It has room for long commands and error text,
  and the HUD keeps its size.
- **Rejected: A, inside the HUD.** The row unfolds into a drawer. That
  makes the HUD taller, and the 272 px width is too narrow for error text.

**Where the step history comes from**
- **Chosen: hooks only.** The HUD records steps as its hooks report them
  and keeps them in memory. It's fast, already flowing, and doesn't depend
  on any internal file format.
- **Rejected for now: hooks plus transcript.** This would fill in history
  from before the HUD started and add Claude's commentary, but it reads an
  undocumented format that an update could break. It can be added later
  without changing what the panel shows.

**How the panel is drawn**
- **Chosen: its own small window.** A second frameless, always-on-top,
  non-focusable window placed beside the HUD.
- **Rejected: widening the HUD window to hold the panel.** When closed, the
  transparent extra width would swallow clicks. Electron's
  click-through-transparent workaround is fragile.

## 5. What the user decided

1. **Stages** replace the row's grey status text with a coloured chip. The
   look follows the mockup.

   | Chip | Meaning |
   |---|---|
   | Thinking | A task was sent; no step yet |
   | Working · `<time on current step>` | Running steps |
   | Needs you | A permission or question is waiting |
   | Your turn | It finished and waits for the next message |
   | Idle · `<time since last activity>` | Nothing for a while |
   | ⚠ Stuck? | A hint on top of Working or Thinking |

2. **The detail panel opens beside the HUD (layout B)** when the user
   clicks a character's sprite or name. It shows:
   - **Task:** the last real prompt.
   - **Now:** the current step, its "why" line, and a live elapsed timer.
     After a failure it shows **Last:** with the error excerpt instead.
   - **Recent steps:** newest first, each with ✓/✗ and how long ago.
   - **Helpers:** active subagents with their type and current step.
   - **Footer:** started N min ago, N steps, and **open window ↗**.
   - **Stuck reason:** when "Stuck?" applies, an amber line at the top
     says why.
3. **Clicking a name no longer jumps to the window.** Jumping moves to the
   panel's **open window ↗** button.
4. **Hooks only** for history.

### Proposals the user saw without objecting (the builder treats these as decided)
- **"Stuck?" triggers.** Any one is enough:

  | Trigger | Condition |
  |---|---|
  | Repeating | The same step failed 3 times in a row |
  | Long step | One step has been running over 5 minutes |
  | Silent | Busy, but no event for 3 minutes |

- It's a hint only; the HUD never stops anything.
- When the HUD sits in the left half of its screen, the panel opens on its
  right instead.

## 6. How it works

### 6.1 Step history (store)
- **One step per tool call.**
  - A `PreToolUse` opens a step. The next `PostToolUse` or
    `PostToolUseFailure` closes it, matched by `tool_use_id` (fallback:
    the oldest open step with the same tool and agent).
- **Step record:**
  - `id`, `tool`, `label`;
  - `why`: `tool_input.description` when present, otherwise none;
  - `startedAt`, `endedAt`;
  - `ok` (true, false, or null while running);
  - `error`: the first ~300 characters of the failure text from
    `tool_response` (stderr, error or message), trimmed to plain text;
  - `agentId`, `agentType` for helper steps.
- **Label.** The same wording as today's activity line, in past tense when
  done: "Edited updater.js", "Read point.ts", "npm test",
  "Searched code for “keepLast”".
- **Task.** The last non-synthetic `UserPromptSubmit` prompt (first ~300
  characters). It resets the task's step count and start time.
- **Limits.** Keep the last **20 main-thread steps** per session. Each
  active helper keeps only its current step. Everything is dropped when
  the session is forgotten (same lifetime as today's store state).
- **Helpers in the panel.** Each active subagent (`agent_id` set) is shown
  with its `agentType` and its latest step label. Helper steps don't appear
  in the main "Recent steps" list.

### 6.2 Stages (store)
- **Order.** Each agent gets one `stage`, with the first match winning:
  1. **needs**: same as today's "needs you" (a pending question,
     a hand-back, or a needs-type Notification).
  2. **turn**: a Stop was received and the agent is not running background
     tasks (today's "done").
  3. **thinking**: a task was sent and no step has started since.
  4. **working**: there's an open step, recent activity (20 s, as today),
     or session status `busy`.
  5. **idle**: anything else.
- **Stuck flag.** `stuck` is `null` or `{ reason: 'repeating' | 'long' | 'silent', detail }`.
  It's evaluated only for `working` and `thinking`:
  - **repeating:** the last 3 closed main-thread steps share the same
    label and all failed.
  - **long:** an open main-thread step started more than 5 min ago.
  - **silent:** the session is `busy` or `thinking`, there have been no
    events from any thread for over 3 min, and there are no open steps and
    no active helpers. An active helper counts as progress.
- **Clearing.** The flag clears as soon as its condition stops holding
  (for example, a successful step or a new event).
- **Timers.** Long and silent depend on time passing, so the store
  re-evaluates on a 1-second tick, not only on events.
- **Moods stay.** Sprite moods map from stages: needs → needs,
  turn → done, thinking/working → working, idle → idle. A stuck agent
  keeps the working mood plus the amber chip.

### 6.3 Snapshot additions
- **`AgentView`** gains:
  - `stage`;
  - `stuck`;
  - `stageSince` (ms timestamp, for the chip's elapsed time);
  - `currentStepStartedAt` (or null).
- **`detail` for the selected session only.** The HUD pushes it on the same
  throttle as snapshots:
  - `{ id, display, cls, stage, stuck, task, startedAt, stepCount }`;
  - `current: step|null`;
  - `steps: step[]` (newest first, up to 20);
  - `helpers: [{ agentType, label }]`.
- **Live times.** The renderer computes elapsed times live from
  timestamps, so the store does not push every second just for clocks. It
  only pushes when the stage or stuck flag changes.

### 6.4 The panel window
- **The window:** a second `BrowserWindow`.
  - Frameless, transparent, always on top, no taskbar button,
    **non-focusable**: it has no text inputs, only buttons.
  - The same sandbox, `contextIsolation`, CSP and sender-checked IPC as
    the HUD.
  - Width 340 px; height follows its content, capped at 60% of the work
    area.
- **Opening and closing:**
  - Clicking a character's sprite or name opens the panel for that agent.
  - Clicking the same agent again closes it, and so does the panel's ✕.
  - Clicking another agent switches the panel to that agent.
  - The panel also closes when its agent leaves the list, and when the HUD
    is hidden, collapsed or quits.
- **Placement:** a pure function, unit-tested.
  - The panel sits to the left of the HUD with an 8 px gap, or to the right
    when the HUD's centre is in the left half of its work area.
  - Vertically, the arrow points at the clicked row; the HUD's renderer
    reports that row's offset.
  - The whole panel is clamped inside the HUD's work area.
- **Following the HUD.** The panel re-places itself whenever the HUD moves,
  re-docks, grows or shrinks.
- **"open window ↗"** in the panel footer does today's `openWindow`.
- **Answer cards are unchanged:** they stay in the HUD, and a waiting
  question still shows on the row and in the HUD card. The panel shows
  "Needs you" with a hint to answer in the HUD.

### 6.5 Renderer
- **HUD rows.** The grey status text becomes the stage chip, using the
  mockup's colours. The class name stays in the row's sub-line, with the
  activity text after it.
- **Panel page.** A separate HTML page, `panel.html`, with the same house
  style; mockup option B is the reference. It shows elapsed times live
  (1 s interval inside the panel only) and wraps long commands and error
  text, never truncating them with an ellipsis.

### 6.6 Calls made after the builder check (my calls; the user can override)

1. **Focus fallback.** Build the panel's focus test first. If buttons in a
   non-focusable window don't take clicks on Windows, use the HUD's
   pattern: focusable on `pointerdown`, then focus released right after
   the click (`releaseFocus`). The panel has no text inputs, so it never
   needs to keep focus.
2. **What a click does.** In the HUD, clicking a sprite or name only toggles
   the panel. The reply toggle, the collapse button and the answer cards
   behave as in v1. A click still opens the panel when the agent has a
   pending question; the panel then shows the details plus "Waiting for
   your answer in the HUD".
3. **Who owns the selection.** The main process owns which agent is
   selected.
   - The HUD sends `hud:selectAgent(id, rowOffset)` (toggle) and
     `hud:rowOffset(id, y)` on re-render.
   - Main closes the panel on collapse, hide, quit, or when the agent
     leaves the list.
   - The panel window gets its own sender-checked IPC: `panel:close`,
     `panel:openWindow`, `panel:reportHeight`.
   - Main pushes `detail` only to the panel window.
4. **Steps that never get a Post event.**
   - When the user rejects or interrupts, or the session ends, these close
     every open main-thread step: a `Stop`, a non-synthetic
     `UserPromptSubmit`, or a `SessionEnd`. They close with
     `ok: null, interrupted: true` and show as "– interrupted".
   - A `SubagentStop` closes that helper's open step.
   - Interrupted steps never count as failures for "repeating".
5. **Partial data.**
   - **Sessions already running when the HUD started:**
     - Task reads "Started before the HUD".
     - "started" uses the session file's `startedAt`.
     - The step count counts only what the HUD saw.
     - A busy session with no history is Working, not Thinking.
   - **Idle** has no extra threshold: it's simply none of the other stages,
     and its chip shows the time since the last activity.
   - **Thinking** times from the task's `UserPromptSubmit`.
6. **Long-step exemption.** An open `Agent`/`Task` step never counts as
   "long" while that session has an active helper. The helper's own
   activity is the progress.
7. **"Repeating" and "Last:".** "Repeating" needs an exact label match. The
   "Last:" line with the error shows until the next step starts.
8. **Panel sizing and placement.**
   - The panel reports its own height; main caps it at 60% of the work area.
   - If neither side fits next to the HUD (a very narrow work area), the
     panel goes on the side with more room and is clamped inside the work
     area. Overlapping the HUD is allowed only then.

## 7. Risks to check early
1. **Clicking a non-focusable second window on Windows.** Its buttons must
   work and must not pull focus from the editor; v1 showed this works for
   the HUD. **Stop and report if they don't.**
2. **`tool_use_id` pairing.** Confirm that PostToolUse/PostToolUseFailure
   carry the same `tool_use_id` as their PreToolUse (SPIKES.md shows it on
   both). Confirm also that failure payloads contain the error text, and
   record which field.
3. **The silent rule while Claude is thinking for a long time** (no tool
   events). 3 minutes may be too eager on hard tasks. If it proves noisy,
   raise it rather than adding complexity.

## 8. Left to the builder
- Exact chip colours and the panel's look, within the mockup.
- Step-label wording per tool, reusing `activityLine` where possible.
- How the HUD reports the clicked row's offset to the main process.
- Whether the panel slides or fades in, respecting reduced motion.
- **Tests required:**
  - store: step pairing, task reset, stage priority, the three stuck rules
    with a fake clock, helper attribution, and the 20-step cap;
  - renderer: chip and panel HTML, including escaping of task, error and
    command text;
  - main: panel placement as a pure function (left, right flip, clamp, and
    following a moved HUD).
