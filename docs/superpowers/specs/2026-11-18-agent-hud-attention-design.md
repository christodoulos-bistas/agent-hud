# Agent HUD — attention: bubble stack, sounds, finish recap, plan card, chat records (v1.4) — design

Status: approved by the user · 18 November 2026 · branch `attention` (from `main` 6226363)

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

## Context

Everything works; the user asked what could be better. A coworker suggested (1) a sound — default and
custom — when an agent finishes or needs input, and (2) compact bubbles for agents waiting on permission
or input, so you see at a glance who needs attention and click one to get the full card. Claude added a
finish recap and a reply-to-any-agent idea. The user then added (3) **everything done on the HUD must
pass on to the chats, Claude and Codex**: plan acceptance, choices, every answer — both answerable from
the HUD *and* recorded in the chat.

- **Release 1 (this design):** bubble stack + sounds + finish recap + plan card + chat records.
- **Release 2: reply to any finished agent.** Gated on a spike of the session file's undocumented
  `messagingSocketPath` (v1 spec §7 "later"). The spike runs during release 1; its own design follows
  only if it works.

Today (v1.2, `docs/superpowers/specs/2026-11-16-agent-hud-alerts-design.md`) a question pops the full
panel open on its agent; only one card shows, others wait behind a "Next: …" line, though the queue
already holds all of them concurrently with independent clocks (`src/main/queue.js`). ExitPlanMode has no
card of its own (only a class signal, `src/main/classes.js`, and `USER_WAITS` in `src/main/stages.js`); it
reaches the HUD as a generic permission card with Allow/Deny. HUD answers leave no visible trace in the
chat except a deny's "Denied from Agent HUD" (`src/main/answers.js`).

## Decided with the user

1. **Bubble stack beside the HUD.** A question opens the side panel by itself in a **compact mode**: one
   bubble per waiting agent. Clicking a bubble grows it **in place** into the full card; the others stay
   compact.
2. **Reuse the existing panel window** (not a new window).
3. **Sounds** for "needs you" and "finished", default plus custom.
4. **Finish recap** line on finished agents.
5. **✕ hides the stack; a glowing row's click or a new question brings it back.**
6. **Everything passes to the chats — both:** every prompt answerable from the HUD (incl. a real plan
   card) **and** the chat records what was chosen.
7. **Plan cards hold for 9 minutes** (like replies), then hand back to the chat.
8. Reply-to-any-agent as a separate release after a spike.

## Claude's calls (user can override)

### Bubble stack
- **Bubbles only for questions** (permission, choice, plan, opted-in reply). Finishing gets glow + sound +
  recap, no bubble.
- **A bubble shows:** the agent's face and name, the kind icon (`!` permission, `?` choice, `▤` plan,
  `↩` reply), one short line (permission: tool + short command/file, reusing `stepLabel`/`activityLine`
  in `src/main/steps.js`; choice: first question's header + "N options"; plan: "Plan ready · N lines";
  reply: first words of the last message), and a countdown ring from `addedAt + hold` (clock runs from
  arrival).
- **Bubbles sit in one contiguous block**, not each aligned to its row: gaps would be transparent window
  area that swallows clicks (the problem v1.1 rejected). Hovering a bubble lights up its row in the HUD.
  The panel's arrow points at the first waiting row.
- **Order:** the queue's order (permission/choice/plan before reply, then arrival).
- **Never auto-expands**, even with one question — compact first is the point.
- **Expanded card:** one at a time. Expanding another collapses the first. Answering/releasing removes
  the bubble; if others remain the stack stays, else the panel returns to what it showed before (or
  closes if it opened by itself) — today's `autoSelect` "before" rule.
- **With an agent's details already open,** the stack sits at the top of that panel and the details stay
  below.
- **Expanding a bubble selects that agent** (builder check): its row is highlighted, the arrow points at
  it, and its details show below the stack — today's "a question switches the panel" rule, now on
  expand. When the last card goes, `before` is restored. Cards live only in the stack: `detail.card` and
  the details' "its question opens here after the current one" note are removed.
- **Closing the stack (user's decision):** the panel's ✕ hides the stack (and any details). Held
  questions keep their clocks and their rows keep the gold glow. Clicking a glowing "Needs you" row (or
  its collapsed face) reopens the stack, as does any newly arrived question id. State: `stackHidden`
  plus the set of card ids seen when it was hidden; a card id outside that set clears `stackHidden`.
  Clicking a non-waiting row while the stack is hidden opens that agent's details only.
- **Collapsed HUD:** the stack opens beside the collapsed column, as cards do today.
- **The HUD's "Next: …" line goes away** (the stack shows everything). Row glow and "Needs you" chip stay.
- Focus rules unchanged: panel never takes focus by itself; only a click into a text box does, given back
  after send/release (`releaseFocusOf`, `setInteractive`). 500 ms arming guard stays on card buttons and
  applies to bubbles too (a bubble appearing under the cursor must not take a click).

### Sounds
- **"Needs you":** once per newly arrived question (new queue item id). Several arriving in the same
  push → one sound.
- **"Finished":** when a visible (not tucked/✕-hidden) agent's stage enters `turn`. Several at once → one
  sound. "Needs you" wins if both fire in the same push.
- **No sound** for the first snapshot after HUD start, while the HUD is hidden, or while muted.
- **Defaults are synthesized with WebAudio** in the HUD renderer (a short two-note chime for needs, a
  softer rising pair for finished) — no shipped audio files.
- **Custom:** tray → "Sounds" submenu: `Mute` (checkbox), `Needs-you sound: Choose… / Default`,
  `Finished sound: Choose… / Default`. Choose opens a file dialog (`.wav .mp3 .ogg`, ≤ 2 MB). Paths saved in
  `config.json` (`sounds: { muted, needs, finished }`). Main reads the file and sends bytes over IPC; the
  renderer plays it via a Blob URL. A missing/unreadable file falls back to the default silently (logged).
- Volume follows the system; no volume setting. Pixel Agents may also play sounds; the user can mute
  either.

### Finish recap
- **Per-task counters in the step log** (`createStepLog`, `src/main/steps.js`), reset on a non-synthetic
  `UserPromptSubmit` alongside `stepCount`: `files` (Set of edited paths: Edit/Write/NotebookEdit,
  apply_patch paths), `commands` (Bash/PowerShell Pre count), `failed` (PostToolUseFailure of a
  Bash/PowerShell call only, so "(1 failed)" means a failed command), `helpers` (SubagentStart count),
  `endedAt` (Stop time). **Helpers' edits and commands count too** (builder check): the helper branch of
  `steps.push` feeds the counters before it returns. Independent of the 20-step cap.
- **Text:** `Done in 4m 12s · 6 files edited · 12 commands (1 failed) · 2 helpers`; zero parts are
  omitted; nothing done → `Done in 8s · no tool steps`.
- **Task started before the HUD:** prefix `Since the HUD started:` and omit the duration.
- **Shown** in the row's second line while stage is `turn` (replacing the activity text after the class),
  and as the first line of the panel's Finished section. Exposed as `recap` on AgentView/detail only when
  stage is `turn`.

### Plan card (Claude only)
- **New card kind `plan`** for ExitPlanMode, held **9 min** (user's decision), on the same path the spike
  finds it arrives on (PermissionRequest with `tool_name: "ExitPlanMode"`, or PreToolUse like
  AskUserQuestion).
- **Expanded card shows** the plan text (`tool_input.plan`) as plain text with line breaks kept and
  headings bold, scrolling inside the card (no full markdown renderer); and three actions mirroring the
  chat's dialog:
  - **Approve · auto-accept edits** → allow + switch the session to `acceptEdits`;
  - **Approve · ask before edits** → allow + `default` mode;
  - **Keep planning** + feedback box → deny with the feedback as the message Claude reads.
  - plus "open window ↗" (release now).
  Exact encodings come from spike 3; if mode switching can't be expressed from a hook, the two approve
  buttons collapse into one **Approve** and the card says the mode stays as set in the chat.
- Codex has no plan-approval hook, so no plan card on Codex rows.

### Chat records
- **Every HUD answer carries a one-line record** in the hook response's top-level `systemMessage`
  (documented common output field), built in `answers.js`:
  - `Agent HUD · Allowed: npm test` / `Agent HUD · Always allowed here: npm test` /
    `Agent HUD · Denied: npm test`
  - `Agent HUD · Answered: Which DB? → Postgres` (multiple questions joined with `; `)
  - `Agent HUD · Plan approved (auto-accept edits)` / `Agent HUD · Keep planning: <feedback, first 120>`
  - `Agent HUD · You replied: <first 80 chars>`
  - Releases, hand-backs and "open window" send **no** record (the chat asks itself).
- **Per-host gate (spike 4):** the field is added only for hosts where the spike saw it render and the
  answer still take effect. A host where it doesn't render or breaks the answer gets no record — never a
  broken answer. **Codex gets it only if Codex accepts the field without failing closed** (THE SPOT).
- The record text goes through the same trimming as card text (no newlines, capped).

## Approaches (picked by the user)

- **Chosen: reuse the panel window with a stack mode.** Existing placement (`panelBounds`), target
  (`panelTarget`), selection (`autoSelect`/`userSelect`), focus and `renderCard` carry over.
- Rejected: a separate bubble window — another always-on-top window to place and keep from stealing
  focus; more on screen.
- Rejected by the user: bubbles inside HUD rows; a badge-only row change.
- Chat records: `systemMessage` is the only documented hook path to show the user text; no transcript
  writing (undocumented format, rejected in v1.1 for the same reason).

## Non-goals / anti-goals

- No OS toast notifications, no stats dashboard, no keyboard shortcuts (not chosen).
- Codex's own questions (`request_user_input`) and plan approval stay unanswerable: no hook exists.
- Anti-goal: a question that can't be reached before its hold runs out (the Goblin) — the stack must show
  every held item, always.
- Anti-goal: a record field that makes any host reject or ignore the answer itself.
- Anti-goal: the panel taking focus or swallowing clicks; the HUD growing.
- Anti-goal: a sound storm (start-up, many agents finishing at once, every Notification).

## How it fits (critical files)

- `src/main/answers.js` — encoders take a `record` option and add `systemMessage` when the host allows;
  new `planApprove(mode)` / `planKeepPlanning(feedback)`.
- `src/main/hook-server.js` — route ExitPlanMode to a `plan` card (Claude only, interactive only); pass
  the host/source so encoders know whether to add the record.
- `src/main/queue.js` — per-kind hold: `plan` uses the 9-min hold (like `reply`) but sorts with
  questions, not after replies.
- `src/main/store.js` — snapshot gains `cards` (lean list of all held items: id, kind, sessionId,
  display, cls, source, short line, expiresAt); `next` removed; AgentView/detail gain `recap`;
  `activeCard` becomes the expanded card (full payload) only.
- `src/main/steps.js` — per-task recap counters + `recapOf(view, now)` pure formatter.
- `src/main/wiring.js` — `autoSelect` reworked into a stack-aware state: `{ selected, auto, before,
  stackHidden, hiddenCardIds, expandedCardId }` (the stack shows whenever `cards.length > 0` and not
  hidden); `panelTarget` allows a stack-only panel; `encodeAnswer` handles `plan` and records; new pure
  `soundCues(prevSnapshot, snapshot, { first, hidden, muted })` → `{ needs, finished }`.
- `src/main/main.js` — sound cues to the HUD; tray "Sounds" submenu; file dialog; read custom file
  (size/extension checked); `panel:expandCard(id)`, `panel:hoverCard(id|null)` → `hud:highlight`; HUD
  `webPreferences.autoplayPolicy: 'no-user-gesture-required'`.
- `src/renderer/cards.js` — `renderBubble`; `renderCard` gains the plan kind; reused for the expanded
  bubble.
- `src/renderer/panel.js`, `panel.css` — compact stack, in-place expand, countdown rings,
  stack-above-details layout; every string through `esc()`.
- `src/renderer/hud.js`, `hud.css` — drop the Next line; row highlight cue; recap in the sub-line;
  WebAudio player + Blob playback.
- `src/renderer/index.html` — CSP adds `media-src blob:`.
- `src/preload.cjs`, `src/preload-panel.cjs` — new channels, sender-checked as today.

## Spikes first (before the code that depends on them; results in `spikes/SPIKES.md`)

1. **Audio** from a non-focused, sandboxed, always-on-top renderer with `autoplayPolicy` set: plays on
   Windows without a user gesture (default chime + Blob file).
2. **Hover in the non-focusable panel** reaches the renderer (row highlight). If not, drop the highlight.
3. **ExitPlanMode:** which hook carries it (PermissionRequest vs PreToolUse), the `tool_input` shape, and
   whether allow + `updatedPermissions` `setMode` (`acceptEdits` / `default`) switches the mode, and
   deny + message comes back to Claude as "keep planning" feedback. Also: does the chat show its own
   approval dialog while the hook is held (the Scorpion for a 9-min hold; still-pending v1 spike 1)?
   If the chat shows nothing during the hold, report it to the user before building the plan card.
4. **`systemMessage` per host:** VS Code panel, Claude desktop app, CLI, Codex (Desktop + TUI) — does it
   render, and does the decision still take effect alongside it? Codex: does an unknown/extra field fail
   the hook closed?
5. **Release 2 spike (parallel, no product code):** read a live session file's `messagingSocketPath`;
   probe what it accepts (read-only first, then a test message to a throwaway scratch session).

Spikes 3–4 need a human in VS Code / the desktop app / Codex: the plan prepares the probe scripts
(extending `spikes/hook-probe.mjs`) and a checklist; Spider-Man runs the clicks.

## After approval — steps

1. Create branch `attention` from `main`; save this design to
   `docs/superpowers/specs/2026-11-18-agent-hud-attention-design.md` and commit.
2. *(Done in planning: builder check ran on the bubble/sound/recap parts; its three questions are
   answered above.)*
3. Invoke `superpowers:writing-plans` → `docs/superpowers/plans/2026-11-18-agent-hud-attention.md`.
   Sequence: spikes 1–4 → recap counters (TDD) → sound cues (TDD) → stack selection state (TDD) →
   answers: records + plan encoders (TDD) → hook-server/queue plan routing (TDD) → panel stack + plan
   card render → HUD changes → tray Sounds menu → live check. Spike 5 alongside.
4. Execute the plan (subagent-driven, TDD as in previous releases).

## Verification

- `npm test` — new unit tests:
  - steps: recap counters (files dedup incl. apply_patch, commands, failed shell commands only, helpers'
    edits/commands included, reset on real prompt and not on `<task-notification>`, correct beyond 20
    steps), `recapOf` text incl. "Since the HUD started".
  - wiring: `soundCues` (first snapshot silent, hidden/muted silent, one cue for many, needs beats
    finished, tucked agents' finish silent); stack selection (new card opens stack, expand/collapse,
    answer last → back to `before`, user selection during stack stands, stack with details open, expand
    selects that agent, ✕ hides the stack, a waiting row's click or a new card id reopens it, an
    already-held card id does not).
  - answers: exact JSON per card kind with and without the record; record text per kind (allow, always,
    deny, choice, plan approve ×2, keep planning, reply); no record on release; Codex gets no
    `systemMessage` unless enabled.
  - hook-server/queue: ExitPlanMode → `plan` card for Claude interactive only; never for Codex; 9-min
    hold; sorts with questions.
  - store: `cards` lists every held item in queue order; `next` gone; `recap` only at `turn`.
  - render: bubble and plan-card HTML escaping (command, question header, plan text, last message),
    countdown attributes, recap sub-line, CSP includes `media-src blob:`.
- Live check with `npm run dev` (clear `ELECTRON_RUN_AS_NODE` first — see memory): two scratch sessions
  each trigger a permission → two bubbles, one chime; expand one, Allow → the chat shows
  "Agent HUD · Allowed: …"; the other still counts down and hands back at 60 s; ✕ hides the stack, the
  glowing row brings it back; plan mode in a scratch session → plan bubble, approve with auto-accept →
  chat shows the record and Claude proceeds in accept-edits; "Keep planning" with feedback → Claude
  revises; a Codex permission from the HUD → Codex runs it (record only if spike 4 allowed); finish a
  turn → finished sound + recap; custom .wav from the tray, mute/unmute; editor keeps focus throughout.
