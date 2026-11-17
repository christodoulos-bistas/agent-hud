# Agent HUD — Open Window to the Exact Chat — Implementation Plan

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

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Open window" opens the exact chat in the Claude app, the Codex app or VS Code.

**Architecture:** A pure `chatLinkFor(session, opts)` in `src/main/focus.js` returns the chat's link (and, for VS Code, the window step to run first); `openWindow` in `src/main/main.js` runs the step, waits, opens the link with `shell.openExternal`, and falls back to today's command if that fails.

**Tech Stack:** Electron 44 main process, plain ES modules, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-17-agent-hud-open-chat-design.md`

## Global Constraints

- Links: `claude://code/continue?session=<id>` (entrypoint `claude-desktop`); `codex://threads/<id>` (entrypoint `codex`, host `desktop`); `vscode://anthropic.claude-code/open?session=<id>` (entrypoint `claude-vscode`), always after running `code.cmd <cwd>` and waiting **1500 ms**.
- No link unless the id matches `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`; the id is passed through `encodeURIComponent`.
- `canOpen` and every other `openCommandFor` result stay as they are.
- `shell.openExternal` rejection → today's command for that chat.

## Review Focus

1. A VS Code chat whose window isn't the last-used one → the window step must run before the link (test: the plan for `claude-vscode` has the code.cmd step and 1500 ms wait).
2. A session id that isn't a UUID (e.g. contains `&` or `/`) → no link built (test).
3. A Claude-in-terminal chat or a Codex chat hosted in VS Code → no link, today's behaviour (test).

---

### Task 1: `chatLinkFor` in focus.js

**Files:** Modify `src/main/focus.js`; Test `test/focus.test.js`

**Interfaces:**
- Produces: `chatLinkFor(session, { codeCmd } = {}) -> null | { url: string, first?: { cmd: string, args: string[] }, waitMs?: number }` and `VSCODE_LINK_WAIT_MS = 1500`.

- [ ] **Step 1: Write the failing tests:** claude-desktop → `{ url: 'claude://code/continue?session=<id>' }`; codex desktop → `{ url: 'codex://threads/<id>' }`; claude-vscode with codeCmd and cwd → `{ first: { cmd: codeCmd, args: [cwd] }, waitMs: 1500, url: 'vscode://anthropic.claude-code/open?session=<id>' }`; claude-vscode without codeCmd or cwd → null; codex host vscode/cli/unknown → null; claude CLI (`entrypoint: 'cli'`) → null; non-UUID ids (`'abc'`, `'<uuid>&x=1'`, `''`) → null for every entrypoint; null session → null.
- [ ] **Step 2: Run** `node --test test/focus.test.js` → FAIL (no export).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` → all pass.
- [ ] **Step 5: Commit** — `feat: chat links for the Claude app, the Codex app and VS Code`

### Task 2: `openWindow` opens the link

**Files:** Modify `src/main/main.js`

**Interfaces:**
- Consumes: Task 1's `chatLinkFor`, `VSCODE_LINK_WAIT_MS`; existing `openCommandFor`, `spawnQuiet`, `OPEN_OPTS`, `sessionById`, `log`.

- [ ] **Step 1: Implement** in `openWindow(sessionId)`: if `openCommandFor` is null, return (unchanged). Else take `chatLinkFor(s, OPEN_OPTS)`; none → today's `spawnQuiet(c.cmd, c.args)`. With a link: if `first`, `spawnQuiet(first.cmd, first.args)`; after `waitMs ?? 0` ms, `shell.openExternal(url)`; on rejection log it and, unless `first` already ran, `spawnQuiet(c.cmd, c.args)`. Import `shell` from electron.
- [ ] **Step 2: Verify** `node --check src/main/main.js` and `npm test` → all pass.
- [ ] **Step 3: Commit** — `feat: open window jumps to the exact chat`
