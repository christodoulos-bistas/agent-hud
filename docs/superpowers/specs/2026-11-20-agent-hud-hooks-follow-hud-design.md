# Agent HUD — Claude hooks follow the HUD (no red lines while it is closed) — short design

Status: draft for approval · 20 November 2026 · from `main` b25b1bb

🕷️

```
╔═════════════╦══════════════════════════════════════════════╦═════════════╗
║ MARVEL      ║                                              ║  APPROVED   ║
║ COMICS      ║     A M A Z I N G   S P I D E R - M A N      ║   BY THE    ║
║ GROUP       ║                  #229 - 230                  ║ COMICS CODE ║
║ 60¢ · 1982  ║                                              ║  AUTHORITY  ║
╠═════════════╩══════════════════════════════════════════════╩═════════════╣
║                                                                          ║
║      " N O T H I N G  C A N  S T O P  T H E  J U G G E R N A U T "       ║
║                                                                          ║
║                     ROGER STERN  ◆  1982  ◆  TIER 2                      ║
║                       a few files, one clear seam                        ║
╟──────────────────────────────────────────────────────────────────────────╢
║  WHY THIS ISSUE                                                          ║
║  A small two-parter with one stubborn blocker: take the hooks out on     ║
║  quit, put them back on start; a crash is the Juggernaut that still      ║
║  leaves them in until the next start.                                    ║
╟──────────────────────────────────────────────────────────────────────────╢
║  ROGUES GALLERY                                                          ║
║  ◆ GREEN GOBLIN   another tool edits settings.json at the same           ║
║                   moment and one of the two edits is lost                ║
║  ◆ SCORPION       a crash, kill or Windows shutdown skips quit;          ║
║                   the red lines return until the next start              ║
║  ◆ CHAMELEON      the desktop app may not pick up live edits the         ║
║                   way the CLI engine does (untested)                     ║
║  ◆ THE SPOT       user settings touch every chat on the machine          ║
╚══════════════════════════════════════════════════════════════════════════╝
```

## Intent

With the HUD closed, its HTTP hooks in `~/.claude/settings.json` fail on every event in every Claude chat:
red `hook failed · ECONNREFUSED` lines in the CLI, "A hook gave no usable answer" / "stop hook reported a
problem" in the apps (SPIKES.md Spike 13). The user wants that noise gone. Second of the four improvements
agreed on 20 November 2026.

## Facts (20 November 2026)

- HTTP hooks have no quiet-failure setting: `onFailure` is `continue` (today) or `block` (code.claude.com/docs/en/hooks).
- Command hooks that exit 0 are silent, but through the HUD's exe they cost ~70 ms per event (measured), ~140 ms
  per tool call — against the v1 anti-goal "slows Claude down noticeably on every tool call".
- Claude Code picks up hook edits live. Spike (one long-lived headless session, scratch project, settings
  edited between turns): hooks **added** mid-session fired on the next turn, no prompt; hooks to a **dead port**
  reproduced the notice; hooks **removed** mid-session — nothing fired, no notice. Docs: "Direct edits to hooks
  in settings files are normally picked up automatically by the file watcher."

## Approaches

- **Chosen: the hooks follow the HUD.** The HUD removes its Claude hooks when it quits and puts them back when
  it starts. Zero cost while closed, no change to how hooks work while open. User handed the how ("what do you
  suggest"); this is Claude's pick.
- Rejected: command-hook bridge for Claude (like Codex) — silent, but ~140 ms per tool call.
- Rejected: a stub listener that outlives the HUD — the HUD under another name.
- Not needed: Codex hooks are already a fail-open command bridge (silent), and re-adding them would re-trigger
  Codex's hook trust. Codex is untouched.

## Design

- **Wanted vs. present.** New config flag `claudeHooksWanted` (boolean). "Install hooks" (first run or tray)
  sets it true; tray "Remove hooks" and the uninstaller's `--remove-hooks` set it false. Migration: on the first
  start of this version, if the flag is missing, it becomes `claudeInstalled()` (hooks present now ⇒ wanted).
- **Start** (`start()`, before the hook server listens is fine; after it is also fine — builder's call): if
  wanted and the target isn't blocked, `installHooks` quietly — no balloon, no `.bak` (the `.orig` rule stays).
- **Quit** (`quit()`, after the server closed and holds were released): if wanted, `uninstallHooks` quietly —
  no balloon, no `.bak`. Never on `--quit`/second-instance paths that don't own the hooks (the running HUD's
  own quit does it).
- **Windows shutdown/logoff:** also remove on Electron's `session-end` (Windows) / `powerMonitor` `shutdown`
  if it reaches the app; best effort.
- **Crash or kill:** hooks stay until the next start, which re-installs idempotently (no change). Same as today.
- **No `.bak` for start/quit writes:** `rewrite` gets an option to skip the `.bak` copy, so the backup keeps the
  user's last real change instead of HUD churn.
- **Tray status** stays `Claude hooks: installed / not installed` from the file. While running and wanted it
  reads installed; after "Remove hooks" not installed.
- **Install balloon text:** drop "Chats you already have open start reporting after a restart" — open chats
  pick the hooks up live.
- **Dev HUD:** same behaviour against the spike settings file (`AGENT_HUD_SETTINGS_PATH`); blocked targets do nothing.

## Claude's calls (the user can override)

- The flag is per machine config (userData), not inferred from the file each time — so a user who removed the
  hooks never gets them back by restarting the HUD.
- No notification for the quiet start/quit writes; failures only go to the log (a failed quiet re-install also
  shows nothing — the tray status line tells the truth).
- Read-modify-write races with other tools (GREEN GOBLIN): accepted as today's risk — `rewrite` reads, merges
  and writes atomically within milliseconds; start/quit add two writes per HUD session.

## Testing

- Unit: config flag migration; start/quit decisions (wanted × blocked × present) as a pure function; `rewrite`
  without `.bak`.
- Hands-on: CLI chat open → quit HUD → next message shows no red line → start HUD → next message reaches the
  HUD (row updates) without restarting the chat. Repeat in VS Code and the desktop app (CHAMELEON).

## Left to the builder

Exact placement in `start()`/`quit()`, the pure decision function's name and file, how the shutdown event is
hooked, and the `rewrite` option's name.
