# Agent HUD — Codex agents in the guild (v2.0) — design

Status: draft for the user's approval · 17 November 2026 · branch `codex-support` (from `main` d122b5c)

```
╔═════════════╦══════════════════════════════════════════════╦═════════════╗
║ MARVEL      ║                                              ║  APPROVED   ║
║ COMICS      ║           S P I D E R - V E R S E            ║   BY THE    ║
║ GROUP       ║                 ASM #9 – 15                  ║ COMICS CODE ║
║ $3.99·2014  ║                                              ║  AUTHORITY  ║
╠═════════════╩══════════════════════════════════════════════╩═════════════╣
║                                                                          ║
║                       " S P I D E R - V E R S E "                        ║
║                                                                          ║
║                     DAN SLOTT  ◆  2014–15  ◆  TIER 3                     ║
║                      multi-module, needs sequencing                      ║
╟──────────────────────────────────────────────────────────────────────────╢
║  WHY THIS ISSUE                                                          ║
║  Heroes from another world join one team: Codex agents join the guild,   ║
║  touching hooks, server, store, sprites and installer in turn.           ║
╟──────────────────────────────────────────────────────────────────────────╢
║  ROGUES GALLERY                                                          ║
║  ◆ GREEN GOBLIN    a bridge that hangs or fails closed and stalls Codex  ║
║  ◆ THE SPOT        our edit to ~/.codex/hooks.json breaks others' hooks  ║
║  ◆ CHAMELEON       Codex events look like Claude's and slip into Claude- ║
║                    only paths (AskUserQuestion, background tasks)        ║
║  ◆ VENOM           Codex trust is bound to the hook command: change it   ║
║                    and every user must approve it again                  ║
║  ◆ MYSTERIO        a quiet Codex chat is not a closed one                ║
╚══════════════════════════════════════════════════════════════════════════╝
```

## 1. Intent

The user runs Claude Code and OpenAI Codex side by side on parallel projects. The HUD shows only Claude
chats today. Codex chats should join the same small HUD — same rows, same 12 classes, same panel, same
finish glow — and Codex's permission prompts should be answerable from the panel exactly like Claude's,
so one glance covers all running work. The user's words on the look: "same classes but as codex".

## 2. Goals (decided with the user)

1. **Codex rows** in the same party list, with the same classes, steps, stages, panel, finish glow, tuck
   and ✕ rules as Claude rows.
2. **Codex look:** the approved roster (`.superpowers/brainstorm/codex/codex-roster.html`): every class
   costume unchanged on the slate "terminal construct" body (`codex-body.js`, notes in `notes.md`); the
   Summoner's two floating familiars become Codex familiars; helper familiars on Codex rows use the Codex
   familiar.
3. **Codex tag** at the start of the class line: `Codex · Gunslinger · running npm test` (option B of the
   roster; the name line stays untouched so long names don't truncate). Same on the panel's class line.
4. **Approve from the HUD:** Codex `PermissionRequest` events become the same permission card (Allow,
   Deny, countdown). Unanswered, released, or HUD not running → Codex shows its own prompt. **Hold length
   for Codex cards: open — the user's decision (Codex shows nothing to click while we hold, §5).**
5. **Install with the Claude hooks:** "Install hooks" (tray) and the first-run offer also install the
   Codex hooks when Codex is on the PC (`~/.codex` exists); "Remove hooks" and the uninstaller remove both.
   After installing, the HUD tells the user to approve the hook once in Codex (`/hooks`).
6. **Open window** on a Codex row brings the Codex app to the front.

## 3. Non-goals

- Answering Codex's questions to the user (`request_user_input`): no hook or outside path exists. A Codex
  chat that waits on a question keeps looking busy; nothing in the HUD claims otherwise.
- "Always allow" on Codex cards (Codex fails closed on `updatedPermissions`). Codex permission payloads
  carry no `permission_suggestions`, so the existing card already hides the box — no special case.
- "Wait for my reply" for Codex (Stop-hook continuation is unconfirmed for Codex): the box is hidden on
  Codex rows and the hook server never holds a Codex Stop.
- Listing Codex chats that did nothing since the HUD started (no rollout-file scan).
- Codex cloud tasks; `codex exec` gets rows from its hooks but never permission cards (exec has no approvals).

## 4. Anti-goals (a failure even if it "works")

- **Codex ever waits on the HUD when the HUD can't answer.** The bridge fails open: any error, refused
  connection or non-200 reply → print nothing, exit 0 → Codex continues as if no hook decided.
- **Touching other tools' hooks.** `~/.codex/hooks.json` already holds pixel-agents, a skills sync and an
  impeccable UI check; install/remove merge per hook and leave every foreign entry byte-identical.
- **Changing the installed hook command between HUD versions** (Codex trust is bound to the hook's hash).
- Any OpenAI logo, `>_` prompt composition or wordmark styling.

## 5. Facts from the 17 Nov spike (`spikes/codex/`, Codex 0.167.0-alpha.4.1, Codex Desktop)

- Codex hooks: `hooks.json` / `[hooks]` at `~/.codex/` and `<project>/.codex/` (project layer only if
  trusted); handler types `command` and `mcp_tool` only (no HTTP); timeout default 600 s; non-managed hooks
  must be approved in Codex's `/hooks`, trust bound to the hook's hash.
- Events seen through the bridge: `SessionStart` (keys session_id, transcript_path, cwd, hook_event_name,
  model, permission_mode, source), `UserPromptSubmit` (+turn_id, prompt), `PreToolUse` (+tool_name,
  tool_input, tool_use_id), `PermissionRequest` (tool_name, tool_input incl. description; no
  tool_use_id, no permission_suggestions), `PostToolUse` (+tool_response), `Stop` (+stop_hook_active,
  last_assistant_message). Codex's shell tool is named **`Bash`**, input `{ command: "<string>" }`.
- `PermissionRequest` answer `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}`
  ran the command with no Codex prompt; `"deny"` (+`message`) showed "Blocked by hook" and the command did
  not run. Same shape the HUD already sends Claude.
- `codex exec` never asks for approval ("this session does not permit … approval requests").
- Bridge cost (receiver answers at once, median of 5): **80 ms** for the installed `Agent HUD.exe` run with
  `ELECTRON_RUN_AS_NODE=1` (52 ms with system Node). The installed build allows RunAsNode (no fuse set).
- Codex Desktop hosts many chats in one long-lived `codex.exe app-server`; VS Code's ChatGPT extension
  runs its own. No per-chat process exists, so liveness can only come from events.
- One of the user's existing global Codex `Stop` hooks exits 1 on Windows (not ours; ours exits 0).
- **Codex waits on a pending `PermissionRequest` hook and shows no prompt of its own meanwhile** (spike 7b:
  receiver held 25 s; the TUI showed only "Working · Running hooks", then ran the command on the allow).
  So while the HUD holds a Codex card, the Codex window has nothing to click; the HUD card is the only
  place to answer until the hold ends and Codex falls back to its own prompt.
- **Codex stores hook approvals by position**: `~/.codex/config.toml` has
  `[hooks.state.'<hooks.json path>:<event>:<group index>:<hook index>'] trusted_hash = …`. Moving a group
  to another index makes Codex treat it as unapproved, even with identical bytes.

## 6. Approaches considered

| | Approach | Trade-off | Verdict |
|---|---|---|---|
| Watch | Read Codex's rollout logs only | Nothing installed, no slowdown; no approvals from the HUD, steps lag | Rejected by the user ("approve from the HUD") |
| **A** | **Bridge = the HUD's own exe as Node** (`ELECTRON_RUN_AS_NODE`) running a small script | No extra runtime for anyone; ~80 ms per event | **Chosen**; spike-proven |
| B | Separate tiny native bridge exe | ~10–30 ms; a second toolchain to build and sign | Kept as the fallback if A's cost ever bites |
| C | PowerShell script | No build; 0.3–0.7 s per event; execution policy blocks it on some PCs | Rejected |

## 7. Design

### 7.1 The bridge (new: `resources/codex-bridge.js`, `resources/codex-hook.cmd`)

- Shipped as electron-builder `extraResources` (outside `app.asar`), so the installed paths are
  `<install>\resources\codex-hook.cmd` and `…\codex-bridge.js`.
- `codex-hook.cmd`: sets `ELECTRON_RUN_AS_NODE=1` and runs `"%~dp0..\Agent HUD.exe" "%~dp0codex-bridge.js"`.
  The **hook command written into `hooks.json` is the quoted path of `codex-hook.cmd` and nothing else**, so
  it never changes between versions (Venom).
- `codex-bridge.js`: reads stdin to end; reads `port` and `secret` from `%APPDATA%\agent-hud\config.json`
  (missing/broken → exit 0); POSTs the body to `http://127.0.0.1:<port>/agent-hud/hook` with headers
  `X-Agent-HUD: <secret>` and `X-Agent-HUD-Source: codex`; prints the reply body only for HTTP 200 with a
  non-empty body; always exits 0. Connection timeout 2 s; response timeout 590 s for
  `PermissionRequest`, 5 s for every other event. No dependencies beyond Node built-ins.
- Electron's RunAsNode fuse must stay enabled in the build config (add a test that fails if `package.json`
  ever disables it).

### 7.2 Installing the Codex hooks (new: `src/main/codex-hooks.js`)

- Target `~/.codex/hooks.json` (dev: see 7.8). Events: `SessionStart`, `SessionEnd`, `UserPromptSubmit`,
  `PreToolUse`, `PermissionRequest`, `PostToolUse`, `Stop`, `Interrupt`, `SubagentStart`, `SubagentStop`. One matcher
  group per event: `{ matcher: "", hooks: [{ type: "command", command: "<quoted codex-hook.cmd path>",
  timeout: 600 for PermissionRequest else 10 }] }`.
- **Positions never move** (Codex trust is keyed by position, §5) *(Claude's call)*: identify ours by the
  command string. Install **appends** our group at the end of an event's list; reinstall **updates ours in
  place** at its current index (unlike Claude's strip-and-append `mergeHooks`). Remove deletes ours (and an
  emptied event); when a foreign group came after ours, its index shifts, so the remove result lists those
  events and the HUD tells the user "Codex may ask you to re-approve hooks for: <events> (/hooks)".
  Foreign entries stay byte-identical. Preserve line endings, indentation and BOM handling; write
  atomically; back up before the first change. Missing file → create with only our hooks. Unparseable
  file → refuse, report, change nothing.
- **Approval status** *(Claude's call, best effort)*: the tray reads `~/.codex/config.toml` and shows
  "Codex hooks: approve in /hooks" while any of our positions has no `hooks.state` entry (another tool's
  install can also shift ours). Unreadable config → show nothing rather than guess.
- Wiring: the tray's Install/Remove act on both targets; the Codex part runs only when `~/.codex` exists;
  the tray shows each target's state. **Existing installs** *(Claude's call)*: a new config flag
  `offeredCodexHooks` gives one Codex-only offer the first time the HUD starts with Codex present, Codex
  hooks absent and the flag unset (the user's config already has `offeredHooks: true`). After a Codex
  install, a balloon says: "Codex: open a Codex chat, type /hooks and approve Agent HUD."
  `--remove-hooks` (uninstaller) removes both.

### 7.3 Hook server (`src/main/hook-server.js`)

- Tag each event with `source: 'codex'` when `X-Agent-HUD-Source: codex`, else `'claude'`; pass it to
  `onEvent` and keep it on held items' payload.
- Codex `PermissionRequest` → `permission` card, held only when `isInteractive(sessionId)` (true for a known
  Codex session) and the HUD can hold, exactly as Claude's.
- Codex events never create `choice` or `reply` cards (Chameleon): `AskUserQuestion` and reply opt-in are
  Claude-only. `background_tasks` logic stays Claude-only (Codex doesn't send it).
- The PostToolUse "answered in its own window" release keeps matching by session + tool + input (Codex's
  PermissionRequest has no tool_use_id either; same as Claude).

### 7.4 Codex sessions (new: `src/main/codex-sessions.js`, store integration)

- A pure tracker builds session records from Codex events: `{ sessionId, pid: null, cwd, kind:
  'interactive', entrypoint: 'codex', source: 'codex', host, name: '', nameSource: 'derived', status,
  startedAt, statusSince }`. Created on the first Codex event for an id. `status` is `busy` after
  `UserPromptSubmit` / `PreToolUse` / `PermissionRequest`, `idle` after `Stop` or `Interrupt` (the hooks also
  subscribe to `Interrupt`); `statusSince` is the time of the last change.
- **Busy with no ending** *(Claude's call)*: a `busy` Codex session with no open tool step (a PreToolUse
  without its PostToolUse) and no event for **15 minutes** becomes `idle`, so an interrupted turn that sent
  no Stop still tucks. An open tool step (a long `npm test`) keeps it busy.
- **Host** *(Claude's call)*: on a session's first event, main reads the first line of `transcript_path`
  (the rollout's `session_meta`) once and keeps `originator`/`source` as `host`: Codex Desktop, VS Code, CLI
  or unknown. This drives Open window (7.7). Unreadable → unknown.
- Removed on `SessionEnd`, or after **24 hours** with no event (Mysterio: quiet is not closed, so the
  tuck rule hides it after an hour and only a day of silence removes it).
- Main merges the tracker's list with Claude's session files on every poll (`store.setSessions(claude
  ++ codex)`); `createInteractiveCheck` treats known Codex ids as interactive. `displayName` gives the
  derived "folder · xx" name (xx = last two hex digits of the session id, as for Claude).
- AgentView and detail gain `source: 'claude' | 'codex'` (missing → `'claude'`).

### 7.5 Classes, activity lines and step labels

- Codex `Bash` already matches Claude's handling (input `command` string).
- `apply_patch` (Codex's file edit tool): parse the target paths from the patch text (`*** Add File: …`,
  `*** Update File: …`, `*** Delete File: …`) and treat each like an Edit/Write of that path for class
  signals, the activity line ("editing x.ts") and step labels ("Edited x.ts", several files → "Edited x.ts
  +2"). The exact `tool_input` field holding the patch is to be captured first (§9).
- `mcp__…` tools as for Claude; unknown Codex tools fall back to their name, as today.

### 7.6 Look (renderer)

- `sprites.js`: add the Codex body, palette keys (`J`, `M`, `G`, re-pointed `h/o/O`) and Codex familiar from
  `codex-body.js`; `spriteSvg(classId, scale, { source })` selects the body.
- `hud.js` and the panel: every sprite cache key includes the source (Chameleon); rows, collapsed faces,
  familiars and the panel header draw the Codex body for Codex agents.
- Class line prefix `Codex · ` on Codex rows and in the panel's class line; no "wait for my reply" box on
  Codex rows.

### 7.7 Open window

- `focus.js` *(Claude's call)*: Codex host **Desktop** → bring the Codex desktop app to the front (process
  `ChatGPT.exe` from the `OpenAI.Codex` package; method to be confirmed, §9); host **VS Code** → `code.cmd
  <cwd>`, as for Claude's VS Code chats; host CLI or unknown → no button. If the app can't be found,
  `canOpen` is false and the button is hidden.

### 7.8 Dev mode

- `npm run dev` must never write the user's real `~/.codex/hooks.json`. Dev targets the project layer
  `C:\Consortis_projects\agent-hud-spike\.codex\hooks.json` with a dev bridge command (the repo's
  `node_modules` Electron + repo script). If Codex doesn't load project-layer hooks there (§9), dev
  testing uses `spikes/codex/tui.mjs`-style `-c hooks.*` overrides instead and dev installs nothing.

## 8. Testing

- Unit (node:test, as today): bridge (fail-open on refused/timeout/non-200/bad config; prints only a 200
  body; sends both headers), codex-hooks merge/remove (foreign entries byte-identical, line endings,
  missing/unparseable file), hook-server source tagging and "no choice/reply for Codex", codex-sessions
  (create, busy/idle, SessionEnd, 24 h expiry), store `source` on views, apply_patch path parsing,
  class signals for apply_patch, renderer Codex body/tag/no-wait-box, sprite cache key includes source,
  RunAsNode fuse guard.
- Spike-style live check before release: interactive Codex in a scratch folder (as `spikes/codex/tui.mjs`)
  against the dev HUD: a row appears with the Codex body, steps show, Allow and Deny from the panel reach
  Codex, the HUD stopped → Codex shows its own prompt. No scripted clicks on the user's desktop.

## 9. Open items to settle first (small spikes, before the code that depends on them)

1. `apply_patch` `tool_input` shape (capture one real event).
2. How to bring the Codex desktop app forward (window title / activation that works for a packaged
   Store app).
3. Whether Codex loads project-layer hooks for `agent-hud-spike` (dev mode, 7.8).
4. Whether Codex Desktop sends `SessionEnd` when a chat is closed (else rows rely on the 24 h expiry).
5. The `originator`/`source` values the VS Code extension and the CLI write (Desktop writes
   `Codex Desktop` / `vscode`), for the host mapping in 7.4.
6. Whether `Interrupt` fires on Esc in Codex Desktop, and its payload.

## 10. Left to the builder

File/function names beyond those above, exact CSS for the tag, balloon wording beyond the line in 7.2,
and the order of work (the plan sequences it; §9 items come first).
