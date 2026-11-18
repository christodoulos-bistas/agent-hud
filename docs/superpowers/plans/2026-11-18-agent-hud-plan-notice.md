# Agent HUD — plans become notice-and-read — short design + plan

Status: approved by the user in conversation · 18 November 2026 · branch `feat/plan-notice` (from `main` ba8e557)

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
║  Peter puts the suit down: the HUD stops pretending it can approve       ║
║  plans and retires the plan card's buttons, holds and encoders.          ║
╟──────────────────────────────────────────────────────────────────────────╢
║  ROGUES GALLERY                                                          ║
║  ◆ GREEN GOBLIN  a plan bubble that never clears, glowing forever        ║
║  ◆ THE SPOT      removing plan code breaks permission/choice cards       ║
║  ◆ CHAMELEON     Read plan opening a path that is not Claude's plan file ║
╚══════════════════════════════════════════════════════════════════════════╝
```

## Why
Checklist 2026-11-18 (spikes/SPIKES.md, Spike 12): VS Code ignores every hook answer for `ExitPlanMode`
(PermissionRequest allow with or without extras, and PreToolUse allow), re-checked with the installed HUD
quit. The plan card's Approve / Keep planning buttons would do nothing. The user chose notice-and-read.

## Decided with the user
- In every app (VS Code, CLI, desktop) the HUD **never holds** a plan and **never answers** one.
- A **plan bubble** (chime, title, step headings, line count) appears while a plan waits for approval.
- **Read plan ↗** opens the plan file (`tool_input.planFilePath`); **Open chat ↗** jumps to the chat.
- No chat note for plans (none show anywhere anyway: Spike 13).
- **Dismiss** on the plan card clears the notice (added after review): Esc on the chat's plan dialog sends the HUD no event,
  so without it the bubble and the gold glow would stay until the next prompt. A later plan is a new notice and chimes again.
- Re-checked with the user on the installed v1.3 HUD (plan as a plain permission card, Allow from the HUD): VS Code still
  waited on "Accept this plan?". Accept stays out; plans in the CLI and the desktop app are untested (the user is researching).

## Claude's calls
- **Plan notices live in the store**, not the queue (nothing is held). `createPlanNotices()` (new
  `src/main/plans.js`, pure) tracks one notice per session from Claude events, main thread only:
  - **set** on `PreToolUse` or `PermissionRequest` with `tool_name === 'ExitPlanMode'` and no `agent_id`
    (keeps the existing notice's id if one is open for that session; Codex events never set one);
  - **clear** on that session's `PostToolUse`/`PostToolUseFailure` for ExitPlanMode, a non-synthetic
    `UserPromptSubmit`, `Stop`, `SessionEnd`, or any other main-thread `PreToolUse` (Claude moved on).
  - Notice: `{ id: 'plan:<sessionId>:<n>', sessionId, plan, planFilePath, at }`.
- **They ride the existing stack**: `snapshot().cards` = the queue's summaries then the notices as
  `CardSummary { kind: 'plan', holdMs: null, expiresAt: null, line: 'Plan ready · N steps' }` (N = markdown
  headings `#`–`###`, else non-empty lines with "lines"). `cardById` returns a FullCard with
  `payload.tool_input = { plan, planFilePath }`. A session with a notice is stage `needs` (it waits for the
  user). Sounds, the stack, ✕ / reopen, highlight and arming all work unchanged (a new notice id chimes).
- **The plan card is read-only**: the plan's title (first heading), its step headings as a list, the line
  count, **Read plan ↗** (`data-act="read-plan"`) and **Open chat ↗** (`data-act="open-card"`, existing). No
  timer and no ring (`holdMs` null). No answer buttons, no feedback box.
- **Read plan safety**: main opens the file with `shell.openPath` only if `planFileOk(p, home)` — an absolute
  path ending `.md` that resolves inside `<home>/.claude/plans` (case-insensitive on Windows); otherwise it
  falls back to Open chat.
- **Removed**: queue `planMs` and kind `plan`; main `PLAN_MS`; hook-server plan routing (ExitPlanMode is still
  never held as a permission, Claude or Codex); `PLAN_EVENT`, `PLAN_MODES`, `planApprove`,
  `planKeepPlanning`; records' plan case; wiring `encodeAnswer` plan case; cards.js plan answer buttons,
  feedback box and their `ARMED_ACTS`; FullCard `planModes`. Their tests go too.

## Tasks
1. **Main side** (`plans.js` new, `store.js`, `hook-server.js`, `queue.js`, `answers.js`, `records.js`,
   `wiring.js` incl. `planFileOk`, `main.js` incl. `panel:openPlan(cardId)` IPC, `preload-panel.cjs`
   `openPlan(id)`), TDD: notice set/clear rules (each clearing event, subagent ignored, Codex ignored,
   id kept across Pre→PermissionRequest), store cards/cardById/stage needs, hook-server never holds
   ExitPlanMode on either event, `planFileOk` cases (inside plans dir, `..` escape, other dir, non-.md,
   relative, forward slashes, case), removed exports gone.
2. **Renderer** (`cards.js`, `panel.js`, `panel.css`), TDD: read-only plan card markup and escaping,
   headings outline, no ring/timer when `holdMs` null, `read-plan` click calls `openPlan(cardId)`,
   no `answer` ever sent for a plan.
3. **Review + merge**: whole-branch review, `npm test`, live check in the isolated dev HUD (a fake
   PreToolUse ExitPlanMode → bubble + chime → Read plan opens the file; a PostToolUse clears it).
