# Agent HUD — open window goes to the exact chat — short design

Status: approved by the user in conversation · 17 November 2026 · branch `codex-support` (before its merge)

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
║                     ROGER STERN  ◆  1982  ◆  TIER 2                      ║
║                       a few files, one clear seam                        ║
╟──────────────────────────────────────────────────────────────────────────╢
║  WHY THIS ISSUE                                                          ║
║  A small two-parter: chat links for each app, then one stubborn blocker  ║
║  - a VS Code link lands in whichever window was used last.               ║
╟──────────────────────────────────────────────────────────────────────────╢
║  ROGUES GALLERY                                                          ║
║  ◆ GREEN GOBLIN    the wrong VS Code window opens a second copy of a     ║
║                    live chat                                             ║
║  ◆ THE JACKAL      that duplicate chat writing the same session          ║
║  ◆ ELECTRO         a race between the window coming forward and the      ║
║                    link arriving                                         ║
║  ◆ CHAMELEON       a session id that isn't one, smuggled into a link     ║
╚══════════════════════════════════════════════════════════════════════════╝
```

## Intent

"Open window" should take the user to the chat itself, wherever it lives — VS Code, the Claude app or the
Codex app — not just bring an app or window forward and leave them to find the chat.

## Decided with the user

- Exact chat, not just the app.

## Facts (17 Nov tests)

- Claude app: `claude://code/continue?session=<Claude Code session id>` opened that exact chat (tested on this
  session). The app's own jump list builds the same link from the same id.
- Codex app: `codex://threads/<thread id>` opened that exact thread (tested). A Codex thread id is the
  `session_id` its hooks send (rollout `id === session_id`).
- VS Code: the Claude Code extension handles `vscode://anthropic.claude-code/open?session=<id>` (uuid-checked)
  with `createPanel(sessionId)`: if that window already holds the chat (tab, sidebar or remembered tab) it
  reveals it; otherwise it opens the chat there — so a link that lands in the wrong window opens a second copy
  of a live chat. VS Code hands a link to the window used last. Not tested live: the scratch folder's window
  was in Restricted Mode (untrusted), which disables the extension.

## Design

| Chat | Open window does |
| --- | --- |
| `claude-desktop` | open `claude://code/continue?session=<id>` |
| `codex`, host `desktop` | open `codex://threads/<id>` |
| `claude-vscode` | run `code.cmd <cwd>` (bring that chat's window forward, as today), wait 1.5 s, then open `vscode://anthropic.claude-code/open?session=<id>` |
| `codex` host `vscode`, CLI chats, anything else | unchanged (today's behaviour) |

- Links open with Electron's `shell.openExternal`. If it rejects, fall back to today's command for that chat
  (Claude app focus, Codex app focus, or nothing extra for VS Code since its window step already ran).
- The id must be a UUID (8-4-4-4-12 hex) or no link is built (today's behaviour applies); the id is URL-encoded.
- The button's visibility (`canOpen`) is unchanged.

## Approaches

1. Chat links per app, with VS Code's window step first (chosen) — exact chat; the window step prevents the
   duplicate-copy case.
2. Keep app/window focus only — rejected by the user.
3. VS Code link alone — rejected: in the wrong window it opens a duplicate of a live chat.

## Left to the builder

Names beyond the plan's, where the 1.5 s constant lives.
