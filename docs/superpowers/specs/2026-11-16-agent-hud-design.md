# Agent HUD — design

Status: draft for approval · 16 November 2026 · folder `C:\Consortis_projects\agent-hud` (not a git repo yet)

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
║  One hero facing six foes at once. The HUD watches every running agent   ║
║  at once, and the build has several separate fronts: hook server,        ║
║  session list, class engine, party-frame UI and installer.               ║
╟──────────────────────────────────────────────────────────────────────────╢
║  ROGUES GALLERY                                                          ║
║  ◆ GREEN GOBLIN   A held hook could hang an agent if the IDE dialog      ║
║                   does not show while the HUD waits (untested)           ║
║  ◆ CHAMELEON      A typed reply reaches Claude as Stop-hook feedback,    ║
║                   not as a normal user message                           ║
║  ◆ THE SPOT       Hooks live in global settings, so they touch every     ║
║                   Claude session on this machine                         ║
║  ◆ MYSTERIO       Session files and status values are undocumented       ║
║                   and can go stale after a crash                         ║
╚══════════════════════════════════════════════════════════════════════════╝
```

## 1. Intent

The user runs several Claude Code agents at once across different projects:
in VS Code, in the Claude desktop app, sometimes in the CLI. Today they find
out an agent is waiting on them only by tab-hunting.

The Agent HUD is a small always-on-top window that shows every running agent
as a fantasy character. Each character's class shows the kind of work the
agent is doing. When an agent needs the user, the HUD shows the question,
and the user answers it in the HUD without switching windows.

It must stay small: a HUD, not a dashboard.

## 2. Goals, non-goals, anti-goals

**Goals**
- See at a glance every running Claude Code session on this machine, which
  project it is in, and what it is doing right now.
- Answer from the HUD:
  - permission prompts;
  - Claude's multiple-choice questions;
  - a typed reply right after an agent finishes, for agents the user has
    marked "wait for my reply".
- Make it fun: each agent is Claude's pixel critter dressed as a fantasy
  class, in the user's QuestBound visual style.

**Non-goals (for v1)**
- Starting, stopping or creating sessions from the HUD.
- Showing transcripts, diffs or tool output beyond one short activity line.
- Cloud sessions. They do not read local settings, so local hooks never fire
  for them.
- macOS and Linux builds. Windows 11 only for now. Don't block a later port.
- Replacing Pixel Agents. It keeps running alongside the HUD.

**Anti-goals: things that would make it a failure even if it works**
- It steals keyboard focus from the editor or terminal.
- An agent hangs because the HUD is holding its question and the user didn't
  see it.
- It gets big. The HUD is about 270 px wide and only as tall as its rows.
- It nags. The "needs you" cue pulses three times, then glows steadily.
- It slows Claude down noticeably on every tool call.

## 3. Constraints and facts the design rests on

- **Platform.** Windows 11. Node 20 is installed. The user already ships
  Electron 44.7.2 apps with electron-builder 26.15.3, signing and an updater
  (`C:\Consortis_projects\arsenal-desktop`). There is no Rust toolchain.
- **Existing hooks.** `~/.claude/settings.json` already has command hooks on
  nearly every event for Pixel Agents (`~/.pixel-agents/hooks/claude-hook.js`),
  plus two PostToolUse hooks of the user's own. The HUD must merge its hooks
  in without disturbing any of these.
- **Documented hook facts** (code.claude.com/docs/en/hooks.md):
  - **HTTP hooks exist.** Config is `type: "http"`, `url`, `headers`,
    `allowedEnvVars`, `timeout` (default 600 s) and `onFailure`.
  - **HTTP responses.** A 2xx response with a JSON body is read like a
    command hook's output, so it can carry a decision. A non-2xx response or a
    connection failure is a non-blocking error unless `onFailure: "block"`.
  - **PermissionRequest.** Input: `tool_name`, `tool_input`,
    `permission_suggestions`. Output:
    `hookSpecificOutput.decision.behavior` = `allow` | `deny`, with optional
    `updatedPermissions` (`addRules` etc.) on allow and `message` on deny.
  - **AskUserQuestion.** A PreToolUse hook answers it by returning
    `permissionDecision: "allow"` plus `updatedInput` containing the original
    `questions` and an `answers` map (question text → chosen label; for
    multi-select, an array or a comma-joined string).
  - **Stop.** Returning `{"decision":"block","reason":"…"}` makes Claude keep
    going with the reason. The input carries `stop_hook_active` and
    `last_assistant_message`. After 8 consecutive blocks Claude Code
    overrides the block; the counter resets on each tool call.
  - **Notification types** include `permission_prompt`, `idle_prompt`,
    `elicitation_dialog`, `agent_needs_input` and `agent_completed`.
- **Session list.** `claude agents --json` is the documented list of running
  sessions; its schema is not yet verified. The `~/.claude/sessions/<pid>.json`
  files are undocumented. Each holds `pid`, `sessionId`, `cwd`, `kind`,
  `entrypoint` (`claude-vscode`, `claude-desktop`, …), `name` and
  `status` (`busy` / `idle` seen so far).

## 4. Approaches considered

### How the user answers
- **Chosen: in the HUD.** The user wanted this. Permission prompts and
  multiple-choice questions use documented mechanisms. Typed replies work
  only in a window after a turn ends (section 7.3).
- **Rejected: jump to the window.** Clicking a character brings its VS Code
  or desktop window forward, and the user answers there. Reliable, but not
  what the user wants. It stays as the fallback ("open window") on every card.

### Layout
These were mocked up at actual size.
- **Chosen: party frames.** A narrow column docked at the bottom-right
  screen edge, one row per agent. The waiting agent's row opens into its
  answer card; one card is open at a time and the rest queue. It shows each
  agent's activity in words, grows downward and stays off the bottom of the
  screen.
- **Rejected: campfire strip.** Characters stand in a bottom-centre bar and
  questions appear as scrolls above them. Only names fit, it gets too wide
  past about 5 agents, and it covers where the user types.

### Shell
- **Chosen: Electron.** The mockups' HTML, CSS and sprite engine port
  directly. The user already has the Electron build, signing and update
  pipeline. Node in the main process makes the hook server trivial. The cost
  is about a 100 MB installer and roughly 150 MB of memory.
- **Rejected:**
  - Tauri: smaller, but needs a new toolchain and pipeline.
  - A panel inside the Claude desktop app: can't float over VS Code.
  - PowerShell or WinForms: poor for animated pixel art and form inputs.
  - Godot: great sprites, but clumsy text input.

### Class rule
- **Chosen: sticky, by main work.** Classes are decided from recent activity
  with hysteresis. A session's class changes when its work really changes and
  stays put otherwise.
- **Rejected:**
  - Live per tool call: flickers.
  - Fixed per session: goes stale when the work moves on.

## 5. What the user decided

1. **Answers happen in the HUD** for all three kinds of question. Each card
   also has an "open window" link.
2. **Characters**
   - **Look.** Claude Code's pixel critter on a 24×24 grid, drawn at 2×
     (about 52 px) in the HUD, in fantasy costume. It uses the QuestBound
     house style:
     - Background: forest night `#18221f`. Panels: `#2c3a34` and `#3a4a42`.
     - Accents: gold `#e0b45c` (darker `#c9973f`, lighter `#edcb85`).
     - Text: parchment `#f0e9da`, with sage `#a9b3a6` for muted text.
     - Fonts: IM Fell English for display and names, Alegreya Sans for UI
       text.
     - Critter: orange `#D97757`.
   - **Reference implementation.** Monet's mockup
     `.superpowers/brainstorm/1378-1794812926/content/character-roster.html`
     holds the sprite engine and all 12 class definitions (the `GR` module
     and the `CLASSES` array). The sprite engine does auto outline, 3-tone
     shading, glow layers and merged-run SVG rects.
   - **The 12 classes.** All are kept, with their task mapping:

     | Class | Work | Signals |
     |---|---|---|
     | Pathfinder | exploring code | Read, Grep, Glob · Explore subagent |
     | Star-Reader | planning | Plan subagent · plan mode · ExitPlanMode |
     | Runesmith | editing code | Edit, Write, NotebookEdit |
     | Alchemist | tests and builds | Bash commands matching test/build/lint · test-writer |
     | Hexbreaker | debugging | PostToolUseFailure · failing Bash exit codes · systematic-debugging skill |
     | Arbiter | code review | change-reviewer · review-lead · code-review skill |
     | Illuminator | UI and visual design | artist · brush · paint · Monet · design skills |
     | Loremaster | research and docs | WebSearch, WebFetch · editing `.md` files |
     | Herald | git, PRs, deploys | Bash `git push/commit` · `gh` · `az` · Azure DevOps MCP tools |
     | Cartographer | GIS and survey work | GIS file types (.shp, .geojson, .gpkg, .tif, .dxf) · topcon-deliverables |
     | Vaultkeeper | databases | SQL files · psql · migration commands |
     | Summoner | running sub-agents | Agent / Task tool calls · active subagents ≥ 2 |

   - **Moods.** Every class has the same four:

     | Mood | Treatment |
     |---|---|
     | Working | animated |
     | Needs you | holds up a scroll; a gold "!" seal pulses 3× on arrival, then glows steadily |
     | Idle | sits, dimmed, with "z" |
     | Done | happy, with a pennant and sparkles |

     The Runesmith mood frames in the roster mockup are the reference.
3. **Class rule.** Sticky: the class follows the agent's main work over the
   last couple of minutes and changes only when the work does.
4. **Layout.** Party frames. The reference is
   `.superpowers/brainstorm/1378-1794812926/content/hud-layout.html`, option A
   and the three answer cards.
5. **Shell.** Electron, Windows 11.
6. **Replies are opt-in per agent.** Each row has a "wait for my reply"
   toggle, off by default.
   - **Toggle on:** when that agent finishes, the HUD holds it open for up to
     9 min for a typed reply.
   - **Toggle off:** the agent finishes normally and its row just shows Done.
   - **Why opt-in:** holding every agent would make every turn on the
     machine look busy until the user replies.
7. **Hold time for questions is 1 minute.** The HUD holds a permission
   prompt or multiple-choice question for 60 s from when it arrives. After
   that it hands the question back to the agent's own window, which asks as
   usual. The HUD is the quick way to answer, not the only one.

### Proposals the user saw and didn't object to
- Sub-agents appear as tiny familiars beside their parent's sprite, not as
  their own rows.
- Each row has a name tag: project folder name plus the session's short name
  (e.g. `arsenal · e0`).
- One question open at a time. The rest queue first-in, first-out, with a
  "Next: …" line.
- The HUD stays above other windows and never steals focus. Clicking a name
  jumps to that agent's window.
- Fix Brush's three weak sprite spots during the build: the Loremaster's
  low-contrast cap, the Arbiter's tent-like cowl, and the Illuminator's
  comet-like brush strokes.

## 6. How it fits together

```
Claude Code sessions (VS Code, desktop, CLI)
   │  HTTP hooks (user settings), POST JSON
   ▼
HUD main process (Electron / Node)
   ├─ hook server     127.0.0.1:<port>, holds blocking requests open
   ├─ session list    `claude agents --json` + ~/.claude/sessions fallback
   ├─ class engine    events → rolling activity → sticky class + mood
   ├─ answer queue    pending questions, FIFO, one active
   └─ IPC ──► HUD window (renderer)
                 party frames, sprites, answer cards
```

### 6.1 Hook wiring
- **Install.** On first run, after the user agrees, the HUD adds its hooks
  to `~/.claude/settings.json`:
  - Back up the file first.
  - Merge entries in; never replace other hooks.
  - Mark its entries so they can be found again, for example by the URL
    path `/agent-hud/`.
  - Uninstall removes exactly those entries.
- **Events and how each is handled:**

  | Event | Matcher | HUD behaviour |
  |---|---|---|
  | SessionStart, SessionEnd | all | update session list; respond at once |
  | UserPromptSubmit | all | mark working; respond at once |
  | PreToolUse | all except AskUserQuestion | activity signal; respond at once, no decision |
  | PreToolUse | `AskUserQuestion` | **blocking**: choice card |
  | PostToolUse, PostToolUseFailure | all | activity / failure signal; respond at once |
  | PermissionRequest | all | **blocking**: permission card |
  | Notification | all | mood signal (needs you, idle); respond at once |
  | Stop | all | **blocking only if** that session's "wait for my reply" toggle is on (reply card); otherwise respond at once and show Done |
  | SubagentStart, SubagentStop | all | familiars; Summoner signal; respond at once |

- **Failure behaviour.** When the HUD isn't running, every hook fails fast
  with "connection refused". It is non-blocking, so Claude carries on
  exactly as without the HUD.
- **Hook timeouts:**
  - Default 600 s.
  - The HUD's own hold times stay well under that:
    - **Questions (permission and choice):** 60 s from arrival. This is the
      user's decision.
    - **Replies:** 9 min, and only for opted-in sessions.
  - The HUD always answers before the hook times out.
- **Which sessions get blocking cards.** Only sessions whose session file
  says `kind: "interactive"`. For any other session, every hook responds at
  once with no decision.
- **Local security:**
  - The server listens on 127.0.0.1 only.
  - Hooks send a per-install secret header, via `headers` plus
    `allowedEnvVars` or written literally into settings; the builder's call.
  - Requests without the secret get a 403.

### 6.2 Answer handling
- **Permission card.**
  - Allow returns `behavior: "allow"`. "Always allow … here" adds
    `updatedPermissions` with an `addRules` entry built from the request's
    `permission_suggestions`.
  - Deny returns `behavior: "deny"` with a short message.
  - Open window releases the hook with an empty 2xx body, so the normal
    dialog takes over.
- **Choice card.**
  - Renders `tool_input.questions`: header chip, question, 2–4 options with
    descriptions, multi-select where `multiSelect` is set, and a
    "Something else…" free-text field.
  - Answer returns `permissionDecision: "allow"` and `updatedInput` =
    original `questions` + `answers`.
  - Free text goes in as that question's answer string.
  - Open window releases with an empty body.
- **Hand-back after 60 s.** A permission or choice question not answered
  within 60 s of arrival is released with an empty 2xx body, and the agent's
  window asks as usual.
  - The row keeps its seal and changes to "Waiting in its window —
    open ↗".
  - The clock runs from arrival, not from when the card opens. That's how
    long the agent has been blocked.
  - The HUD keeps holding while collapsed; the seal stays visible on the
    collapsed column.
- **Reply card (Stop, opted-in sessions only).**
  - Shows the first ~200 characters of `last_assistant_message`, a text box,
    and a countdown.
  - Send returns `decision: "block"` with `reason` = the typed text.
  - If the timer runs out, or the user clicks "No reply" or "open window",
    the HUD returns an empty body and Claude stops normally.
  - If `stop_hook_active` is true, the HUD still offers the reply. It is
    user-driven, so it can't loop on its own.
- **Queue.** Pending requests are held in order of arrival, except that
  permission and choice cards always go ahead of reply cards. Those block
  work under a 60 s clock; replies are optional. Only the first item shows
  as an open card. The others show their row's "!" or "?" seal and the
  "Next: …" line. Answering in the native window instead resolves the HUD's
  pending item: the hook connection closes, or the next event for that
  session arrives. The HUD then drops the card.

### 6.3 Session list and identity
- **Polling.** Run `claude agents --json` every few seconds. Fall back to
  reading `~/.claude/sessions/*.json` if the command is missing or its schema
  differs. Merge with hook events by `session_id`.
- **Display name.** Project folder name from `cwd`, plus the short session
  name.
- **Stale sessions.** A session whose pid is dead disappears from the list.

### 6.4 Class and mood engine
- **Rolling window.** Each session keeps a rolling window of weighted
  activity signals over about the last 2 minutes. The signals are listed in
  section 5's class table.
- **Switching.** The class switches only when another class leads the
  current one by a clear margin and holds that lead for some seconds
  (hysteresis). The exact weights and thresholds are tuned by the builder.
- **Starting class.** A new session starts as Pathfinder until signals
  arrive.
- **Mood priority:**
  1. **Needs you:** a blocking request is pending, or a Notification of a
     needs-input type arrived.
  2. **Done:** a Stop was received and no new prompt or tool activity has
     come in since. With the reply toggle on, the reply card shows while its
     window is open.
  3. **Working:** tool or prompt activity in the last ~20 s, or the session
     status is busy.
  4. **Idle:** none of the above.

### 6.5 Window behaviour
- **Window.**
  - Frameless, transparent and always on top.
  - Docked bottom-right of the primary display by default, about 272 px
    wide.
  - Height follows content, capped at about 60% of the screen; beyond that
    it scrolls.
  - No taskbar button; a tray icon instead.
- **Focus.**
  - Never steals focus. Shown inactive; updates don't activate it.
  - The window takes focus only when the user clicks into a card's text
    field or button.
- **Collapse.** The header's "–" shrinks the HUD to a column of faces. A
  needs-you seal stays visible when collapsed.
- **Open window / click a name.** Best effort, in this order:
  1. For VS Code sessions, focus the VS Code window for that `cwd`.
  2. For desktop sessions, bring the Claude app forward.
  3. Otherwise open the folder.
- **Sound.** None in v1. Pixel Agents already plays sounds.

## 7. Risks and the spikes to run first

Settle these with throwaway tests before building the UI. Each one can
change the design.

1. **Dialog during a held PermissionRequest or AskUserQuestion.** In VS
   Code, the desktop app and the CLI: while the HUD holds the hook, does the
   native dialog or picker show in parallel?
   - **Expectation:** the picker probably does not show for AskUserQuestion,
     since it is held in PreToolUse.
   - **Either way:** the 60 s hand-back (decision 7) applies.
   - **If it does show in parallel:** check that answering natively closes
     the HUD's card cleanly.
   - **Also confirm:** an empty 2xx response falls through to the normal
     dialog.
2. **AskUserQuestion answering.** Check that PreToolUse `updatedInput.answers`
   is honoured in VS Code and the desktop app, including multi-select and a
   free-text "other".
3. **Stop-hook reply (opted-in sessions only).**
   - Check that Claude continues with the typed text.
   - See how it appears in the transcript and the IDE.
   - Check what happens if the user types in the IDE while the Stop hook is
     held. If that prompt is lost or stuck, release the Stop hook as soon as
     the session gets a UserPromptSubmit event; if that isn't possible, warn
     on the toggle.
   - Check the interaction with the 8-continuation cap.
4. **`claude agents --json`.** Check its output and that it lists VS Code and
   desktop sessions.
5. **HUD not running.** Measure what a refused HTTP hook costs per tool call,
   and whether it adds visible error noise to sessions.
Already settled during review: Pixel Agents' hook, including the one on
PermissionRequest, only forwards events and returns nothing to Claude. It
can't conflict with the HUD's decisions.

Later, not v1: each session file has an undocumented `messagingSocketPath`.
It might deliver replies without holding Stop. Investigate only after v1
ships.

## 8. Left to the builder
- Project structure, the IPC shape and state management. Keep it small:
  plain JS or TS, no framework required.
- Exact weights and thresholds for the class engine.
- Port number strategy (fixed or chosen at start-up) and how hooks find it.
- The installer and update channel. Reuse arsenal-desktop's approach if
  convenient. Start with Windows login is opt-in, from the tray menu.
- The sprite polish items in section 5 and any further sprite refinement,
  keeping the 24×24 grid, the outline, the top-left light and the
  silhouettes distinct at 2×.
- Tests: the class engine, answer encoding (exact JSON for each card) and
  settings merge/unmerge must have unit tests. The settings merge must be
  proven not to touch other hooks.
