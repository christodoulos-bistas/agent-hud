# Agent HUD — tuck idle chats and hide with ✕ (v1.3) — short design

Status: approved by the user in conversation · 17 November 2026 · builds on `main` + `hud-early-helpers`

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

## Intent

The HUD is meant to stay small, but a row only leaves it when its chat's process ends. Desktop chats keep
a process for a long time (on 17 Nov, "Consortis GIS site down" had been idle about 20 h and was still
listed). Chats the user isn't using should get out of the way: on their own after a quiet hour, or at
once with a ✕ — and come back the moment they matter again.

## Goals (as approved)

- **Auto-tuck.** A chat quiet for **1 hour** tucks away. "Quiet" covers stage `idle` and stage `turn`
  (finished, "Your turn" unanswered). A chat that is working, thinking or asking (`needs`) never tucks.
- **✕ hides.** Hovering a row shows a ✕; clicking hides that chat at once, whatever its stage — except
  that a row asking the user something (`needs`) has no ✕.
- **Coming back.** A hidden or tucked chat returns when it **asks the user something** (stage `needs`) or
  **starts a new turn** (a real, non-synthetic `UserPromptSubmit`; for a chat without hooks, its session
  file's status going `idle` → `busy`). Tool use and finishing do not bring a ✕-hidden chat back.
- **The tucked line.** Under the rows: `── N tucked away · show ──` (shown only when N > 0). Clicking it
  lists the tucked and hidden chats as dimmed rows; their panels open as usual. Clicking again
  (`· hide`) folds the list.
- **Restart.** ✕ hides live in memory only: a HUD restart shows them again, and the one-hour rule
  re-tucks quiet chats by itself.

## Non-goals / anti-goals

- The HUD never closes or kills a real chat; it only hides rows.
- No new settings, no saved hide list, no per-chat "never tuck".
- Anti-goal: a question from a hidden chat that the user never sees (the Green Goblin). `needs` always wins.

## Approaches

1. **Main process decides (chosen).** The store works out each chat's hidden/tucked state and the
   snapshot carries `agents` (visible) and `tucked` (the rest); the HUD window only draws. Main already
   owns selection, the panel and question pop-open, so they stay consistent with what is visible.
2. Renderer-only filtering — rejected: the main process would pop the panel open on rows the HUD hides,
   and counts and selection would disagree with the screen.
3. Saving hides to `config.json` — rejected: the idle rule re-derives tucking after a restart anyway, and
   a saved hide could make a chat disappear for days.

## Decisions for the builder (Claude's calls, marked)

- *(call)* "Quiet since" = the latest of the session's last hook activity, its last Stop, the time its
  session file's status last changed (`statusUpdatedAt`, newly kept by `sessions.js`), and its start time.
  A session whose file says `busy` is never quiet.
- *(call)* The header's "N at work" counts visible rows only; the tucked line carries the rest.
- *(call)* Clicking ✕ on the selected row closes the panel. The panel may show a tucked chat only while
  the tucked list is open (its row is on screen for the arrow); folding the list closes such a panel.
  The open/folded state of the list lives in the main process (like `collapsed`) and rides in the snapshot.
- *(call)* A chat coming back via `needs` drops its ✕ hide for good (answering doesn't re-hide it).
- *(call)* The collapsed HUD (faces) shows visible chats only.
- *(call)* Tucking changes are pushed by the existing stage tick: the tuck state joins `stageKey()`.

## Left to the builder

Exact CSS for the hover ✕, the dimmed tucked rows and the tucked line, in the HUD's existing style
(`hud.css`, tokens) with reduced-motion respected.
