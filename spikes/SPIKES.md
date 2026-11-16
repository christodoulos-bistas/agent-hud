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
