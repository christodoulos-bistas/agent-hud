# Hook spikes (Task 1)

Run on 2026-11-16 with `claude` CLI 2.1.220 (Windows 11, Git Bash), headless `claude -p ... --model haiku`
from the scratch folder `C:\Consortis_projects\agent-hud-spike` (HTTP hooks for all 11 events in
`.claude/settings.local.json`, url `http://127.0.0.1:47822/agent-hud/hook`, timeout 600).
Probe: `node spikes/hook-probe.mjs --mode log|hold|allow|answer|reply`. Raw log: `spikes/logs/hooks.jsonl` (git-ignored).

"Observed" = seen in hooks.jsonl or CLI output. "Inferred" = my reading; not proven.
Only headless was possible here. VS Code / desktop behaviour is NOT yet verified (see PENDING sections).

## Baseline facts (observed)

- HTTP hooks (`type: "http"`) work: Claude POSTs JSON (user-agent `axios/1.15.2`, `content-type: application/json`).
- Common fields on every payload: `session_id`, `transcript_path`, `cwd`, `prompt_id`, `hook_event_name`.
  Tool events add `permission_mode` (`"default"`), `tool_name`, `tool_input`, `tool_use_id`.
- **SessionStart never arrived** in any `-p` run (only UserPromptSubmit, Pre/PostToolUse, Stop, SessionEnd).
  Unknown whether it fires in interactive sessions (Inferred: it likely does there; re-check in the IDE).
- SessionEnd payload: `{..., "hook_event_name":"SessionEnd","reason":"other"}`.
- UserPromptSubmit: adds `prompt`.
- Stop: adds `stop_hook_active`, `last_assistant_message`, `background_tasks` (array), `session_crons` (array):
  `{"hook_event_name":"Stop","stop_hook_active":false,"last_assistant_message":"Online.","background_tasks":[],"session_crons":[]}`
- PostToolUse: adds `tool_response` and `duration_ms`
  (Bash: `{"stdout":"v20.19.5","stderr":"","interrupted":false,"isImage":false,"noOutputExpected":false}`).

## Spike 1 - hold: native dialog during a held PermissionRequest / AskUserQuestion

### PENDING — interactive
Needs a human in VS Code and the desktop app.

Steps:
1. `node spikes/hook-probe.mjs --mode hold --holdMs 30000` (leave running).
2. Open `C:\Consortis_projects\agent-hud-spike` in VS Code (Claude Code panel). Ask: "Run `echo hi > x.txt` with Bash" (needs permission).
   Watch the 30 s: does the native permission dialog appear while the hook is held? Then let it release: does the dialog appear / proceed?
   Also try answering natively *during* the hold; note whether the held hook request is closed (probe log shows no further effect; check `netstat`).
3. Ask: "Use the AskUserQuestion tool to ask me a 2-option question." Same observations for the picker (PreToolUse AskUserQuestion is held).
4. Repeat in the desktop app, and in the CLI (`claude` interactive).
5. Record: dialog shown in parallel? (y/n per surface), behaviour after release with empty 200, any error text.

Headless finding that bears on this (observed): in `-p` mode, main-thread tools needing permission are
**auto-denied without a PermissionRequest hook firing** (see Spike 2b), so only interactive runs can answer this.

## Spike 2 - AskUserQuestion answering (`answer` mode)

**AskUserQuestion is not available in `-p` mode (observed).** Prompted twice (also with `--tools "AskUserQuestion"`);
Claude replied it has no such tool, and no PreToolUse/AskUserQuestion payload ever reached the probe.
So the `tool_input` shape, `updatedInput.answers`, multi-select array-vs-", " and free-text "other" are all **UNVERIFIED**.

### PENDING — interactive
In VS Code and the desktop app, with `--mode answer` running, ask "Use the AskUserQuestion tool to ask me a
2-option question, then repeat back the answer you received." Record: exact PreToolUse `tool_input` from hooks.jsonl; whether Claude
proceeds with the injected first-option answer; the same with a multiSelect question using (a) an array and (b) a ", "-joined string
(edit the probe's `answers` line); and a free-text answer.

### Spike 2b - Bash permission with `allow` mode (headless; observed)

- `node -v`: no permission needed; only PreToolUse + PostToolUse (no PermissionRequest).
- `echo spike > spike-out.txt` (main thread, `-p`): PreToolUse Bash, then Claude switched to the Write tool (PreToolUse Write),
  **no PermissionRequest hook fired**, the write was denied headlessly (file not created; Claude said it "requested permission").
- A **subagent** (Explore, async) running PowerShell **did** fire PermissionRequest, and the `allow` JSON was **honoured**:
  every PermissionRequest was followed by a PostToolUse with real output. Probe answer used:
  `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}`.
- Exact PermissionRequest payload (command trimmed):
  ```json
  {"session_id":"26a702dd-...","cwd":"C:\\Consortis_projects\\agent-hud-spike","prompt_id":"47a36f5e-...","permission_mode":"default",
   "agent_id":"a985432f35b6fcf5d","agent_type":"Explore","hook_event_name":"PermissionRequest","tool_name":"PowerShell",
   "tool_input":{"command":"Get-ChildItem -Path \"C:\\...\" -Force | ...","description":"List all files ..."},
   "permission_suggestions":[{"type":"addRules","rules":[{"toolName":"PowerShell","ruleContent":"<the full command, verbatim>"}],
                              "behavior":"allow","destination":"localSettings"}]}
  ```
  Note: `ruleContent` is the *exact full command*, not a prefix pattern; `destination` was `localSettings`.
  No `tool_use_id` on PermissionRequest (present on PreToolUse/PostToolUse). Order observed: PreToolUse -> PermissionRequest -> PostToolUse.
- Inferred: in interactive mode PermissionRequest fires for main-thread tools too. Verify in the IDE.

## Spike 3 - Stop-hook reply

### 3a - reply mode (headless; observed)
`claude -p "Say hello in one word." --model haiku` with `--mode reply`:
- Claude **continued** after the `decision:"block"` Stop response and the final output was `PINEAPPLE`.
- Two Stop payloads arrived: first `stop_hook_active:false, last_assistant_message:"Hey."`, then
  `stop_hook_active:true, last_assistant_message:"PINEAPPLE"` (probe replies once per session, so the second was allowed).
- No UserPromptSubmit was emitted for the injected `reason` (only the original prompt's one). Order: UPS, Stop, Stop, SessionEnd.
- Not tested: the 8-continuation cap; how it renders in the IDE transcript.

### 3b - IDE half

#### PENDING — interactive
1. `--mode reply`; in VS Code send a short prompt. Does Claude continue and say PINEAPPLE? How does the reason appear in the IDE?
2. Stop probe, run `--mode hold --holdMs 60000`. Send a prompt; while Stop is held (Claude shows as working/finished?), type a second prompt in the IDE.
   Is it queued, lost, rejected, or does a UserPromptSubmit reach hooks.jsonl immediately (-> HUD could release Stop on UPS)?
3. (Optional) reply mode with the probe changed to block repeatedly, to see the continuation cap.

## Spike 4 - `claude agents --json`

- `claude --version` -> `2.1.220 (Claude Code)` (CLI on PATH; VS Code/desktop sessions run newer builds, e.g. a session file says 2.1.323).
- `claude agents --json` -> `[]`; `claude agents --json --all` -> `[]`, run while 4 interactive sessions
  (3 `claude-vscode`, 1 `claude-desktop`) existed in `~/.claude/sessions`.
- `claude agents --help`: "Manage **background agents**"; `--all` = "include completed background sessions"; `--cwd` filters
  "background sessions". **So it lists background agents only, NOT interactive VS Code/desktop sessions (observed output + help text).**
- `~/.claude/sessions/<pid>.json` does carry what the HUD needs. Example (observed):
  `{"pid":38208,"sessionId":"4256fdae-...","cwd":"c:\\Consortis_projects\\arsenal","startedAt":1794810688780,"version":"2.1.323",
   "kind":"interactive","entrypoint":"claude-vscode","name":"arsenal-e0","nameSource":"derived","updatedAt":...,"status":"busy",
   "statusUpdatedAt":...,"messagingSocketPath":"\\\\.\\pipe\\LOCAL\\cc-msg-...","peerProtocol":1,"peerFeatures":[...]}`
  (`entrypoint` values seen: `claude-vscode`, `claude-desktop`; `status` seen: `busy`.) Also sibling `<pid>.<hash>.key` files.
- Not checked: whether `claude agents --json` on 2.1.325 behaves differently, or with background agents running.

## Spike 5 - HUD not running

- Refused connection: with the probe stopped, each `-p` run printed to stderr exactly one line (101 bytes):
  `SessionEnd hook [http://127.0.0.1:47822/agent-hud/hook] failed: connect ECONNREFUSED 127.0.0.1:47822`.
  Pre/PostToolUse/UPS/Stop failures printed nothing in `-p` output (only the SessionEnd one surfaced). Claude ran normally, output correct.
  Interactive/IDE noise is UNVERIFIED.
- Timing, same prompt ("Run node -v with the Bash tool"), 3 runs: probe stopped 8.3 / 10.3 / 8.5 s; probe up (allow mode)
  8.7 / 9.9 / 8.1 / 10.7 / 12.9 / 9.3 / 8.2 s. Differences are within model-latency noise; per-call hook cost is not measurable here.
  A raw `fetch` to the closed port fails in ~20 ms (ECONNREFUSED), which bounds the per-hook cost (Inferred).

### PENDING — interactive
With the probe stopped, use a tool-heavy session in VS Code and the desktop app; look for hook-failure banners/toasts/log noise and any
visible lag per tool call.

## Extra: subagents (observed)

- Spawning tool name is **`Agent`** (not `Task`): `PreToolUse {"tool_name":"Agent","tool_input":{"description":"...","prompt":"...","subagent_type":"Explore"}}`.
- PostToolUse Agent `tool_response`: `{"isAsync":true,"status":"async_launched","agentId":"a985432f35b6fcf5d","description":"...","resolvedModel":"claude-haiku-4-5-20251001","prompt":"...","outputFile":"...\\tasks\\<agentId>.output","canReadOutputFile":true}` (returns immediately; `duration_ms: 4`).
- `SubagentStart`: `{session_id, cwd, prompt_id, "agent_id":"a985432f35b6fcf5d","agent_type":"Explore","hook_event_name":"SubagentStart"}`.
- `SubagentStop`: `{session_id, cwd, prompt_id, permission_mode, agent_id, agent_type, "stop_hook_active":false, "agent_transcript_path":"...\\subagents\\agent-<id>.jsonl", "last_assistant_message":"..."}`.
- **Tool events from inside a subagent carry `agent_id` and `agent_type` on the payload** (PreToolUse/PostToolUse/PermissionRequest), so subagent activity and permission prompts are attributable.
- The subagent ran async: the main session's `Stop` fired while the subagent was still running, with
  `background_tasks:[{"id":"a985432f35b6fcf5d","type":"subagent","status":"running","description":"...","agent_type":"Explore"}]`.
  When the subagent finished, a synthetic **UserPromptSubmit** arrived with `prompt` = `<task-notification>...` and a second Stop followed.
  Implication (Inferred): the HUD must not treat every UserPromptSubmit as a human prompt, and Stop with non-empty `background_tasks` does not mean idle.

## Spike 6 - non-focusable panel clicks

`spikes/panel-focus.mjs`: 340x200 window at DIP (200,200), `frame:false, alwaysOnTop, focusable:false, skipTaskbar`, sandboxed, shown with `showInactive()`;
one full-window button -> IPC -> `CLICKED <ms>`; main polls `getFocusedWindow()` every 200 ms -> `FOCUSED`. Display scale factor 1 (so DIP == physical px;
button centre = 370,300). Driven by PowerShell (`SetCursorPos` + `mouse_event` left down/up at the centre; `GetForegroundWindow`/`GetWindowText` before/after),
with Notepad given the foreground first.

| Run | Foreground before | Foreground after | CLICKED | FOCUSED |
| --- | --- | --- | --- | --- |
| 1 (A: no transparent/resizable) | `New Text Document (3).txt - Notepad` (hwnd 8587932) | same | yes (first line within ~1 s of the click) | never |
| 2 (A) | `New Text Document (3).txt - Notepad` (hwnd 17435874) | same | yes | never |
| 3 (A) | `New Text Document (3).txt - Notepad` (hwnd 2952074) | same | yes | never |

Output excerpt (run 1): `READY scale=1 bounds={"x":200,"y":200,"width":340,"height":200} centerPhysical=370,300` then `CLICKED 1794828951145`.
Extra later `CLICKED` lines in runs 1-2 (and a lone one in run 3 is the scripted click) came after the script's click while the cursor sat over the button for 20 s;
likely real user/other-process clicks - not attributable to the script, and none produced FOCUSED or changed the foreground.

**Result: `PANEL_CLICK_MODE = 'plain'`** - plain `onclick` buttons work in a `focusable:false` window, no focus theft. Task 6 needs no pointerdown-focus workaround.
Caveat: synthetic `mouse_event` clicks, one machine (Win 11, scale 1); not tested at >100% scaling or with a real editor (VS Code) foreground.

### Spike 6, re-run B - real panel options (`transparent: true`, `resizable: false`, opaque dark body `#1e1e2e`)

The runs in the table above (labelled A) used neither option. Re-run with them, driver `spikes/panel-focus-drive.ps1` (starts its own Notepad, records its PIDs, kills only those):

| Run | Foreground before | Foreground after | CLICKED | FOCUSED |
| --- | --- | --- | --- | --- |
| 1 (B) | `New Text Document (3).txt - Notepad` | same | yes | never |
| 2 (B) | same | same | yes | never |
| 3 (B) | same | same | yes | never |

Verdict unchanged: **`PANEL_CLICK_MODE = 'plain'`**. Same caveats (synthetic clicks, scale 1, Notepad not an editor).

Evidence note: the `FOCUSED` poll is close to tautological - `BrowserWindow.getFocusedWindow()` never returns a `focusable:false` window, so its silence proves little. The only real evidence for "no focus theft" is the foreground-title check (`GetForegroundWindow` + `GetWindowText` before vs after); `CLICKED` is the evidence that the click registered.

## Spike 7 - focus give-back after typing (2026-11-17, hands-on check 3)

Hands-on check 3 (a typed "Something else..." answer + Enter) left the foreground on the Windows taskbar
(`Shell_TrayWnd`), so the user's next keystrokes went nowhere. Cause: Electron's `setFocusable(false)` /
`blur()` deactivate via Chromium's `HWNDMessageHandler::Deactivate`, which activates the next *visible
window in z-order*; for an always-on-top window that is another always-on-top one (the taskbar, the HUD).

`spikes/focus-giveback.mjs <variant>` (a topmost, non-focusable window made focusable and focused, then released):

| variant | release | foreground after (runs) |
| --- | --- | --- |
| `blur` (v1.2) | `setFocusable(false); blur()` | HUD, `Shell_SecondaryTrayWnd` - wrong 2/2 |
| `ontop` | `setAlwaysOnTop(false); setFocusable(false); blur(); setAlwaysOnTop(true)` | the window the user came from - 4/4 (VS Code x2, Claude app x2) |
| `ontop-hide` | `ontop`, then `hide()` (the panel closing after the answer) | the window the user came from - 2/2 |
| `hide` | `hide(); setFocusable(false); showInactive()` | stays on the spike window - wrong |
| `idle-blur` / `idle-ontop` | focusable but never focused | no change - correct either way |

**Result:** `releaseFocusOf` leaves the always-on-top band for the hand-back (`ontop`). In the real HUD with
the fix, a typed answer from the Claude app returned the focus to the Claude app (1 clean run). Two earlier
runs ended on VS Code, possibly the user switching windows mid-run (unconfirmed). Driving the panel over the
debug port does not count as user input, so Windows' foreground lock often refuses the panel's `focus()`
under automation: a real mouse click is the final check.

## Spike 8 - Codex hooks through the HUD's own exe (2026-11-17, Codex 0.167.0-alpha.4.1)

Scripts in `spikes/codex/` (`bridge.cjs`/`bridge.cmd`: the installed `Agent HUD.exe` with `ELECTRON_RUN_AS_NODE=1`
forwards one hook event over HTTP; `receiver.mjs`: a scratch endpoint that answers allow/deny; `tui.mjs`/`run.mjs`:
interactive / exec Codex in a scratch folder with the hooks passed as `-c hooks.*` overrides, nothing written to `~/.codex`).

- Bridge cost, median of 5: 80 ms via the HUD exe as Node, 52 ms via system Node (`time.mjs`).
- Events and fields match Claude's closely; Codex's shell tool is `Bash`; `Stop` carries `last_assistant_message`;
  `PermissionRequest` has no `tool_use_id` and no `permission_suggestions`.
- Allow → command ran, no Codex prompt. Deny (+message) → "Blocked by hook", command not run.
- `codex exec` never asks for approval, so no PermissionRequest there.
- 8b: with the answer held 25 s, Codex showed only "Working · Running hooks" — no prompt of its own while a hook is pending.
- Codex keeps hook approvals by position (`hooks.state.'<file>:<event>:<group>:<hook>'` in config.toml).

## Spike 9 - Codex open items: apply_patch payload, project-layer hooks, hosts, app activation (2026-11-17, Codex 0.167.0-alpha.4.1)

Scripts: `spikes/codex/` (`tui.mjs <word> [overrides|project] [shell|patch]`; `bridge.js` renamed `bridge.cjs` because the repo's `package.json` is now `"type": "module"` and the CommonJS bridge failed with exit 1 - "Hook failed" in Codex).
`receiver.mjs` now also logs the keys of `tool_input`.

**1. apply_patch payload** (interactive Codex, read-only sandbox, hooks via `-c hooks.*`): `PreToolUse`, `PermissionRequest` and `PostToolUse`
all carry `tool_name: "apply_patch"` and `tool_input` with the single key `command`, whose value is the patch text (starts `*** Begin Patch`, `*** Add File: <name>`).
**`APPLY_PATCH_FIELD = 'command'`**. `PermissionRequest` has no `tool_use_id` (as for shell); an `allow` reply was honoured (patch applied).
In this run Codex applied the patch with the hook answer (PermissionRequest fired before PostToolUse).

**2. Project-layer hooks**: `C:\Consortis_projects\agent-hud-spike\hooks-proj\.codex\hooks.json` (the six events, `{"hooks":{<Event>:[{matcher,hooks:[{type,command,timeout}]}]}}`),
interactive Codex there with `--dangerously-bypass-hook-trust` and no `-c hooks.*`. Codex stops at a **"Folder access ... Trust this folder?"** prompt
("Folder settings can run code automatically", decision is saved to config) before the session starts; with a `.codex` folder present the prompt appears, without it
(the `codex-proj` runs) it does not. No event reached the receiver. Per the rules the trust was not granted and not forced (a session-only
`projects.<path>.trust_level` override was tried and refused by the harness, so it is untested). The file was deleted afterwards.
**`DEV_CODEX_TARGET = null`**: a project-layer hooks.json is not loaded in an untrusted folder, and trusting is a user decision. Untested: whether it loads once the folder is trusted.

**3. Host values** (first line of each of 53 rollouts under `~/.codex/sessions`, no content read), `session_meta.payload.originator` / `.source`:

| originator | source | rollouts | host |
| --- | --- | --- | --- |
| `Codex Desktop` | `vscode` | 47 | `desktop` |
| `codex_exec` | `exec` | 3 | `cli` |
| `codex-tui` | `cli` | 3 | `cli` |

`CODEX_HOSTS = { 'Codex Desktop': 'desktop', 'codex-tui': 'cli', 'codex_exec': 'cli' }` (by originator; the desktop app reports source `vscode`, so source alone is ambiguous;
no rollout from the VS Code extension itself was seen, so its originator is unknown -> `'unknown'`/`'vscode'` is unmapped).

**4. Bring the Codex app forward**: the app is `ChatGPT.exe` from `OpenAI.Codex_26.1106.6628.0_x64__2p2nqsd0c76g0` (package family `OpenAI.Codex_2p2nqsd0c76g0`, AppUserModelId `OpenAI.Codex_2p2nqsd0c76g0!App`).
Its window title is `ChatGPT`, and while it is closed-to-background its processes have no visible window (`MainWindowHandle` 0 for all but a hidden `ChatGPT` window).
- `WScript.Shell.AppActivate('ChatGPT')` (by title): returned False, foreground unchanged.
- `AppActivate(<pid of the process with MainWindowHandle != 0>)`: True, foreground became `ChatGPT` (VS Code in front first).
- `explorer.exe shell:AppsFolder\OpenAI.Codex_2p2nqsd0c76g0!App`: brings the app to the front from VS Code, and also restores it when it had no visible window.
**`CODEX_ACTIVATE = { cmd: 'explorer.exe', args: ['shell:AppsFolder\\OpenAI.Codex_2p2nqsd0c76g0!App'] }` as a JS literal; the raw argument is `shell:AppsFolder\OpenAI.Codex_2p2nqsd0c76g0!App`** (no window lookup, works hidden or not). Caveat: the package version is in the install path, not in the AUMID, so it survives updates.

## Live check - v2.0 Codex support (2026-11-17, dev HUD on codex-support)

- `codex exec` with the ten hooks passed as `-c hooks.*` overrides running the repo bridge (`node resources/codex-bridge.cjs`):
  hooks fire and the dev HUD shows "codex-live · 6e — Codex · Pathfinder · finished · Your turn". Codex clamps the
  `SessionEnd` and `Interrupt` hook timeouts to 3 s (both are answered at once, so harmless); `Interrupt` is a known event.
- Permission cards through the real bridge (PreToolUse + PermissionRequest fed to `resources/codex-bridge.cjs`): the card shows
  the `Codex · Pathfinder` tag, the Codex body, a 1:00 countdown and no "always allow"; the row reads "Codex · … · asks permission ·
  Needs you". Allow from the panel → the bridge prints `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}`;
  Deny → `…"behavior":"deny","message":"Denied from Agent HUD"…` (the shapes Codex honoured in Spike 8).
- HUD stopped → the bridge exits 0 with no output in 91 ms (fail-open).
- Open: in the interactive TUI (codex 0.167.0-alpha.4.1) hooks passed as `-c` overrides did not run this afternoon (no "Running hooks"),
  though the same setup ran in the morning; `codex exec` runs them. Not the product path (the app reads `~/.codex/hooks.json`);
  verify after the user installs: a Codex Desktop chat should appear in the HUD and its permission prompts should card.
- Still to confirm in Codex Desktop after install: closing a chat removes its row (SessionEnd); Esc mid-turn idles it (Interrupt).

## Spike 10 - Codex hook trust via app-server (2026-11-17, Codex app 26.1106.6628.0)

Probe: `node spikes/codex/trust-probe.mjs <codex.exe> list|trust <key>`.

- `codex.exe app-server` (newline JSON-RPC: `initialize` → `initialized` → requests) answers `hooks/list { cwds: [home] }`
  with all 21 hooks of `~/.codex/hooks.json`, each with `key`, `command`, `sourcePath`, `source`, `isManaged`, `currentHash`,
  `trustStatus`. The app's Trust button saves through `config/batchWrite` (`hooks.state."<key>".trusted_hash`, upsert).
- Side effects of one `list` run next to the running app: a temp folder `~/.codex/tmp/arg0-windows/codex-arg0*`
  (apply_patch shims + lock); the sqlite logs and sandbox log also changed, but the running app writes those anyway.
  Nothing in `~/.codex/sessions`. Acceptable for a run on install / startup / tray click.
- `fs.readlinkSync(%LOCALAPPDATA%\Microsoft\WindowsApps\chatgpt-desktop.exe)` returns
  `C:\Program Files\WindowsApps\OpenAI.Codex_26.1106.6628.0_x64__2p2nqsd0c76g0\app\ChatGPT.exe` → keep the alias step.
- Not yet tested: whether the running app runs a newly trusted hook in a new chat without a restart. Moved into the live
  check (plan Task 6), where trust is removed and re-added with the user present.

## Spike 10 - audio from an inactive window (2026-11-18, Electron 44)

Probe: `env -u ELECTRON_RUN_AS_NODE npx electron spikes/audio-hover.mjs` (two frameless, transparent, always-on-top windows,
`showInactive()`, `sandbox: true`, `autoplayPolicy: 'no-user-gesture-required'`, CSP `default-src 'self'; media-src blob:`;
page + scripts + CSS written to os.tmpdir()). Headless-style evidence: nobody listened, so this records API state, not "heard it".

```
[A] AudioContext.state initial=running
[A] AudioContext.state after resume=running
[A] chime scheduled without error, state=running        (660 Hz then 880 Hz, 120 ms each, gain 0.15)
[A] audio.play() promise RESOLVED, paused=false         (Blob URL, generated 0.3 s WAV)
[A] audio ended event
```

- AUDIO_OK = yes (by API evidence): the context starts `running` with no gesture in a window that never had focus
  (`isFocused()` false for both windows at show and at the end, 8 s; sampled only twice), the oscillator chime schedules without error, and the Blob WAV plays to its
  `ended` event under that CSP. Audibility is on Spider-Man's live checklist.
- Gotcha: the CSP `default-src 'self'` also blocks inline `<script>` and inline `style=` attributes, so the HUD's own pages must
  keep scripts and styles in files (the probe loads `a.js`, `b.js`, `s.css` from the page's folder).

## Spike 11 - hover in a non-focusable window (2026-11-18, Electron 44)

Same probe. Window B is `focusable: false`; its 200x100 box logs `pointerenter`/`mouseenter`/`pointerleave`.
SYNTHETIC evidence only: the mouse was not moved by a person; events came from
`webContents.sendInputEvent({ type: 'mouseMove', ... })` (10,10 then 50,50 inside the box, then 215,115 outside).

```
main: focusable A=true B=false; focused A=false B=false
[B] pointerenter
[B] mouseenter
[B] pointerleave
```

(The run also logged three further enter/mouseenter/leave cycles later, with no input sent from the script at those times;
possible stray real-pointer or compositor-generated moves, not investigated. So the logged hover events cannot be tied
to the synthetic moves alone.)

- HOVER_OK = unconfirmed (renderer receives pointer events; real-mouse OS routing untested - Spider-Man's live check). The box saw
  enter and leave; the spike's windows never took Electron focus (isFocused false); the OS foreground window was not checked.
  Not proven: that a real mouse over a `focusable: false` window on Windows is routed to it (synthetic events bypass the OS
  hit-test). A real-mouse hover check is on Spider-Man's live checklist; until it passes, treat the highlight as likely-but-unconfirmed.

## Before Spikes 12 and 13: point the spike folder's hooks at the probe

Spikes 12 and 13 talk to `spikes/hook-probe.mjs`, never to a HUD. Do this once, and undo it at the end (step 5).

1. **Quit the installed Agent HUD** (tray → Quit). Its hooks live in `~/.claude/settings.json` (user level) and fire in every
   folder, the spike folder included: while it runs it would also hold the same PermissionRequest and show its own card,
   and the result would not be the probe's. With it quit, its hooks fail fast (Spike 5) and do nothing.
2. **Point the spike folder at the probe.** The hooks are in `C:\Consortis_projects\agent-hud-spike\.claude\settings.local.json`
   (all 11 events, PreToolUse and PermissionRequest included). A dev HUD install may have left their URL at the HUD's port
   (`http://127.0.0.1:47821/agent-hud/hook`); the probe listens on **`http://127.0.0.1:47822`** (any path, no header check).
   In PowerShell, from `C:\Consortis_projects\agent-hud`:
   ```powershell
   $f = 'C:\Consortis_projects\agent-hud-spike\.claude\settings.local.json'
   Copy-Item $f "$f.spike-bak"
   (Get-Content $f -Raw) -replace '127\.0\.0\.1:47821', '127.0.0.1:47822' | Set-Content $f -Encoding utf8 -NoNewline
   Select-String -Path $f -Pattern '4782[12]'   # every url line must now say 47822
   ```
3. **One probe per mode.** The mode is fixed when the probe starts, so for every step: stop the probe (Ctrl+C), then start
   it with the step's mode, in its own terminal: `node spikes/hook-probe.mjs --mode <mode>`. It prints
   `probe listening on 127.0.0.1:47822 mode=<mode>`; nothing else may be listening on 47822 (`netstat -ano | findstr 47822`).
4. **One log per step.** Every payload is appended to `spikes/logs/hooks.jsonl` (git-ignored). Before each step move the last
   one aside so each step's log stands alone:
   `Move-Item spikes/logs/hooks.jsonl spikes/logs/hooks-<spike>-<host>-<mode>.jsonl` (e.g. `hooks-12-vscode-plan-keep.jsonl`).
   Start a **new chat** in the host for every step (an earlier answer can colour the next).
5. **Afterwards:** stop the probe, restore the hooks (`Move-Item -Force "$f.spike-bak" $f`) and start the installed HUD again.

Write every result into the table under its spike in this file (one row per host), and the flips it implies into
**Decisions** at the end: `PLAN_EVENT`, `PLAN_MODES` and `RECORD_HOSTS` are in `src/main/answers.js`.

## Spike 12 - ExitPlanMode (hands-on, RUN 2026-11-18 in VS Code)

Hosts: VS Code panel, Claude desktop app, CLI (`claude` in a terminal), each with the folder `C:\Consortis_projects\agent-hud-spike`
open. In each, switch to plan mode (Shift+Tab until the mode reads "plan", or the host's mode picker) and send:
"Make a two-step plan to create notes.txt and write hello in it. Do not run anything yet."
The probe modes answer only a **PermissionRequest** for `ExitPlanMode`; anything else is logged and passed through.

For each host, with the setup above:
1. **`--mode log`** (probe answers nothing): when the plan dialog shows, read `spikes/logs/hooks.jsonl` and find the lines with
   `"tool_name":"ExitPlanMode"`. Record which `hook_event_name` they carry (PermissionRequest, PreToolUse or both) and the keys of
   their `tool_input` (expected at least `plan`). Answer the dialog in the chat yourself. If ExitPlanMode never shows on a
   PermissionRequest, the probe can't answer it: write "n/a (PreToolUse only)" in the next three columns and skip to the next host.
2. **`--mode plan-allow-auto`** (answers allow + `setMode acceptEdits` for the session, with
   `"systemMessage":"Agent HUD · Plan approved (auto-accept edits)"`): no dialog should appear. Record: did Claude leave plan mode
   and start the steps; does the host's mode now read accept-edits ("auto-accept edits" / "Accept edits"); does the exact text
   `Agent HUD · Plan approved (auto-accept edits)` show in the chat.
3. **`--mode plan-keep`** (answers deny with the message `Keep planning: add a rollback step`, and
   `"systemMessage":"Agent HUD · Keep planning: add a rollback step"`): record whether Claude stays in plan mode, whether its next
   plan adds a rollback step, and whether `Agent HUD · Keep planning: add a rollback step` shows in the chat.
4. **`--mode plan-hold --holdMs 60000`** (holds the request 60 s, then answers empty, which hands the decision back): during the
   hold, record whether the chat shows its own approval dialog, and whether answering it there ends the hold early (the chat moves
   on before the 60 s are up). **If the chat shows nothing to click during the hold: STOP and report** (the 9-minute plan hold
   would leave the chat blank).

| Host | Event(s) | tool_input keys | allow-auto: left plan / acceptEdits / record | keep: stays + revises | hold: native dialog / ends hold |
| --- | --- | --- | --- | --- | --- |
| VS Code panel | PreToolUse then PermissionRequest (both carry ExitPlanMode) | `plan`, `planFilePath` (no permission_suggestions) | **ignored**: allow+setMode+systemMessage, plain allow, and a PreToolUse allow all still showed "Accept this plan?" (clean re-run with the installed HUD quit) | not run (answers ignored) | native dialog shows while a hook is held - the chat is never blank |
| Claude desktop | not run (decision below) | | | | |
| CLI | not run (decision below) | | | | |

## Spike 13 - systemMessage per host (hands-on, RUN 2026-11-18)

Probe `--mode record` answers every PermissionRequest with allow + `"systemMessage":"Agent HUD · Allowed: <tool>"`.
1. **Claude hosts** (VS Code panel, desktop app, CLI), with the setup above and `node spikes/hook-probe.mjs --mode record`, in a
   new chat in the spike folder, in default mode (not plan, not accept-edits), send: "Run `echo hi > x.txt` with Bash."
   Record: does the exact text **`Agent HUD · Allowed: Bash`** show in the chat; did the command run without the chat asking
   (`x.txt` in the spike folder holds `hi`; delete it before the next host). The log must show one PermissionRequest for Bash.
2. **Codex TUI**: Codex sends its hooks through the bridge to the spike receiver, not the probe. In one terminal start the receiver
   with records on: `$env:RECORD = '1'; node spikes/codex/receiver.mjs` (prints `receiver up`, listens on `127.0.0.1:47997`, logs to
   `spikes/codex/events.jsonl`). In another: `node spikes/codex/tui.mjs allow-me` (an interactive Codex in
   `agent-hud-spike\codex-proj`, its hooks passed as `-c hooks.*` overrides through `spikes/codex/bridge.cmd`; nothing is written
   to `~/.codex`). Codex is asked to run `echo allow-me > out-allow-me.txt` with approval. Record: did the command run
   (`out-allow-me.txt` exists), does **`Agent HUD · Allowed: Bash`** show (Codex's shell tool is Bash, Spike 8), and any
   "hook failed" text. `events.jsonl` must show a PermissionRequest whose `reply` carries the systemMessage.
3. **Codex Desktop**: the app reads hooks only from `~/.codex/hooks.json` (no per-run override), and this checklist never edits
   that file. Write "not run (no override path)" in its row unless the user decides otherwise; `codex` then stays out of
   `RECORD_HOSTS`.

| Host | Record shows | Command ran | Notes |
| --- | --- | --- | --- |
| claude-vscode | no | yes (no dialog) | |
| claude-desktop | no | yes (no dialog) | with the HUD closed, the app shows "Claude Code notice - A hook gave no usable answer" for the HUD's failing hooks |
| cli | no | yes (no dialog) | the CLI prints its own "Allowed by PermissionRequest hook"; with the HUD closed it prints red "hook failed · ECONNREFUSED 127.0.0.1:47821" lines |
| codex desktop | not run (no override path) | | |
| codex tui | skipped (records off everywhere) | | |

## Spike 14 - messaging socket (hands-on, RUN 2026-11-18 in VS Code)

Use ONLY a throwaway session started in `C:\Consortis_projects\agent-hud-spike`; never any other session. No probe and no hook
change is needed (the socket is the chat's own, not a hook); the installed HUD may keep running.

1. Start a new chat in the spike folder in the host under test (VS Code panel, desktop app, or `claude` in a terminal there) and
   send "hi" so the session is live.
2. `node spikes/messaging-socket.mjs` lists the live sessions. Pick the row whose `entrypoint` is the host under test and whose
   session file (`~/.claude/sessions/<pid>.json`) has `"cwd"` = the spike folder; note its full `sessionId` from that file.
3. `node spikes/messaging-socket.mjs --send <sessionId>`. The script refuses any session outside the spike folder. It connects to
   the session's `messagingSocketPath`, writes one line, `{"type":"user_message","text":"Say PINEAPPLE"}` + newline, prints
   every reply as `recv: <text>` (or `error: <message>`), and exits after 5 s with `done (5s)`.
4. Record, per host, in the table below: the exact `recv:` / `error:` lines (or "none"), whether the chat shows "Say PINEAPPLE"
   as a message, and whether Claude answers `PINEAPPLE`. Then set **REPLY_ANYWHERE** below: `yes` if the chat answered
   PINEAPPLE in that host, `no` if nothing showed in any host.

| Host | Socket reply (recv / error / none) | Message shows in chat | Claude answers PINEAPPLE |
| --- | --- | --- | --- |
| VS Code panel | none (connected, no reply, `done (5s)`) | no | no |
| Claude desktop | | | |
| CLI | | | |

### listing (automated)

`node spikes/messaging-socket.mjs` (read-only, never connects; existence checked by listing `\\.\pipe\`). Session ids redacted to last 4; pipe hash elided.

| pid | sessionId | entrypoint | kind | messagingSocketPath | exists |
| --- | --- | --- | --- | --- | --- |
| 25200 | ...a2c9 | claude-vscode | interactive | `\\.\pipe\LOCAL\cc-msg-<32 hex>` | true |
| 36360 | ...0b58 | claude-vscode | interactive | `\\.\pipe\LOCAL\cc-msg-<32 hex>` | true |
| 36420 | ...f6a5 | claude-vscode | interactive | `\\.\pipe\LOCAL\cc-msg-<32 hex>` | true |
| 45848 | ...4c5b | claude-desktop | interactive | `\\.\pipe\LOCAL\cc-msg-<32 hex>` | true |

Every live session advertises a per-session named pipe that exists. Whether it accepts input is untested; the hands-on send is below.
Run it with `node spikes/messaging-socket.mjs --send <sessionId>` (refuses unless the session cwd is the spike dir).

REPLY_ANYWHERE = no. The pipe is Claude Code's private session-to-session channel (session file: `peerProtocol: 1`, `peerFeatures: ["notify_idle","artifact_yield"]`); its message format is undocumented and a guessed one is silently ignored. Reverse-engineering it would break on any update: release 2 ("reply to any agent") is dropped; "wait for my reply" stays the way to reply.

## Decisions (after the 2026-11-18 checklist)

- **Plans: notice-and-read** (user's decision). VS Code ignores every hook answer for ExitPlanMode, so the HUD never holds a plan and never answers one, in any app: a plan bubble (chime, title, step headings, line count) with "Read plan ↗" (opens `planFilePath`) and "Open chat ↗". `PLAN_EVENT` / `PLAN_MODES` and the plan encoders become unused.
- `RECORD_HOSTS = new Set()` stays (final): no Claude app shows a hook `systemMessage`. Chat notes stay off everywhere.
- Release 2 ("reply to any agent"): dropped (Spike 14).
- New issue: with the HUD closed, its HTTP hooks show red "hook failed" lines in the CLI and a "hook gave no usable answer" notice in the desktop app. To fix separately.

