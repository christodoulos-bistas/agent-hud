# Agent HUD — Codex hooks trusted at install — short design

Status: approved by the user in conversation · 17 November 2026 · branch `main` (no feature branch yet)

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
║                     ROGER STERN  ◆  1982  ◆  TIER 3                      ║
║                      multi-module, needs sequencing                      ║
╟──────────────────────────────────────────────────────────────────────────╢
║  WHY THIS ISSUE                                                          ║
║  A two-parter against one stubborn blocker - Codex's hook trust gate:    ║
║  part one has Codex vouch for the HUD's own hooks, part two is the       ║
║  guided way through when Codex can't be reached.                         ║
╟──────────────────────────────────────────────────────────────────────────╢
║  ROGUES GALLERY                                                          ║
║  ◆ GREEN GOBLIN    trusting a hook that is not the HUD's own             ║
║  ◆ CHAMELEON       another hook dressed in the HUD's command, or the     ║
║                    wrong codex.exe answering                             ║
║  ◆ SANDMAN         config.toml written by the running Codex app at the   ║
║                    same moment                                           ║
║  ◆ SCORPION        the running app ignores the new trust until a new     ║
║                    chat or a restart                                     ║
║  ◆ VENOM           hooks/list and config/batchWrite are undocumented     ║
║                    app-server methods we now lean on                     ║
║  ◆ ELECTRO         app-server slow to start, or hanging                  ║
╚══════════════════════════════════════════════════════════════════════════╝
```

## Intent

Installing the HUD for Codex should take one "yes". Today the HUD writes its 10 hooks into
`~/.codex/hooks.json`, then the user has to find Codex's approval screen and trust each hook; until then
Codex silently skips them and the HUD shows nothing. The HUD also points at the wrong screen: it says
"type /hooks", which is the Codex terminal; the Codex app uses Settings → Hooks.

## Decided with the user

- **Approach A:** the HUD marks its own Codex hooks as trusted, with the user's yes in the HUD's install
  dialog standing in for Codex's approval screen.
- Claude needs nothing: Claude Code runs hooks from `settings.json` without an approval step.

## Facts (17 Nov, Codex app 26.1106.6628.0)

- Codex keeps approvals in `~/.codex/config.toml` as
  `[hooks.state.'<hooks.json path>:<event_snake>:<group>:<hook>'] trusted_hash = "sha256:<hex>"`.
  The app's Trust / Trust all button writes exactly that, through the app-server method
  `config/batchWrite` with
  `{ edits: [{ keyPath: 'hooks.state.' + JSON.stringify(key) + '.trusted_hash', value: hash, mergeStrategy: 'upsert' }], filePath: null, expectedVersion: null, reloadUserConfig: true }`.
- The bundled `…\app\resources\codex.exe app-server` (newline-delimited JSON-RPC on stdio: `initialize`
  → `initialized` → requests) answers `hooks/list { cwds: [<dir>] }` with every hook's `key`, `command`,
  `sourcePath`, `source` (`user` …), `isManaged`, `currentHash` and `trustStatus` (`trusted` …), plus
  `warnings`. Probed read-only on this machine; it lists the HUD's 10 hooks.
- Codex's hash is SHA-256 over canonical (sorted-key, compact) JSON of
  `{ event_name, matcher?, hooks: [{ type, command, timeout, async, … }] }`, with undocumented
  normalisation: the matcher is dropped for `Stop`/`UserPromptSubmit`/`Interrupt`, and `SessionEnd` /
  `Interrupt` timeouts are clamped to 3 s before hashing. Starting from the open-source sidekick crate's
  `codex_trust.rs`, all 10 HUD hashes and 9 of the 11 others reproduce; the two that don't are hooks with
  `commandWindows` / `statusMessage`. **Too fragile to recompute** — the HUD takes `currentHash` from Codex
  instead.
- The app shows hook sources "From config", "From plugins" and "Admin config"; only admin (managed) hooks
  skip approval, and the HUD cannot write admin config without admin rights.

## Approaches

| | Approach | Trade-off | Verdict |
|---|---|---|---|
| A | HUD trusts its own hooks via Codex's app-server | One click; leans on two undocumented app-server methods | **Chosen** |
| B | Guided approval: HUD opens Codex, shows "Settings → Hooks → Trust all", watches config.toml | Robust, but the user still hunts through Codex | Kept as A's fallback |
| C | Ship the hooks as a Codex plugin (approve on the plugin page) | Most native; unproven that plugin hooks can run the HUD, and a new install route | Not now |

Within A, *Claude's call*: ask Codex for the hash (`hooks/list`) rather than recompute it (see Facts).

## Design

- **Consent.** `confirmCodexInstall` adds: "Agent HUD will also mark its own hooks as trusted in Codex, so
  you won't need to approve them there." A yes sets `cfg.codexAutoTrust = true`.
- **Trust step** (new `src/main/codex-trust.js`), run after a Codex install that changed the file, and at
  startup when `cfg.codexAutoTrust` is set and `codexState().missing` is not empty (a HUD update moved the
  command, or another tool shifted our positions):
  1. Find `codex.exe` *(Claude's call)*: `AGENT_HUD_CODEX_EXE` (tests/manual; when set, the only
     candidate), then the app alias `%LOCALAPPDATA%\Microsoft\WindowsApps\chatgpt-desktop.exe` → its
     target's `resources\codex.exe`, then the `OpenAI.Codex` package's
     `InstallLocation\app\resources\codex.exe`. A Codex CLI on PATH is out of scope (CLI users have `/hooks`).
  2. Start `codex.exe app-server`, `initialize`, call `hooks/list { cwds: [homedir] }`.
  3. Keep only hooks with `source === 'user'`, `!isManaged`, `sourcePath` equal to `CODEX_PATH`
     (normalised), `command === CODEX_COMMAND`, and `trustStatus !== 'trusted'`.
  4. `config/batchWrite` one `trusted_hash` upsert per kept hook (`value: currentHash`).
  5. `hooks/list` again; report which of ours are now trusted. Kill the server; whole step times out at
     15 s.
- **Pure parts, unit-tested:** the hook filter (step 3), the edit builder (step 4) and the result summary.
  The process part is tested against a fake app-server script (`AGENT_HUD_CODEX_EXE` → node script that
  speaks the same JSON-RPC). Tests never start the real Codex or touch real user files.
- **Messages.** Success: "Agent HUD Codex hooks installed and trusted" — no approval balloon. Failure or
  `codex.exe` not found → fallback B: balloon "Codex: open Settings → Hooks and click Trust on the Agent
  HUD hooks (in the Codex terminal: /hooks)." Tray label "Codex hooks: approve in Codex Settings → Hooks";
  the remove notice says "(Codex Settings → Hooks)". The existing config.toml polling flips the tray to
  "installed" once trust lands either way.
- **Existing installs** (said yes before this existed, no `codexAutoTrust`): no silent trust. While approval
  is missing the tray offers "Trust Agent HUD hooks in Codex"; clicking it is the consent and sets the flag.

## Never

- Trust a hook whose command is not the HUD's, a project-layer or plugin hook, or a hook shifted by our
  remove — those stay for the user to approve in Codex.
- Trust anything without the user's yes (dialog or tray click).
- Write `config.toml` text directly or compute the hash ourselves.
- Run the trust step in a dev build (`CODEX.blocked`).

## Open

- Does the **running** Codex app run the newly trusted hooks in a new chat without a restart (its own
  app-server has its own config snapshot)? Tested in the plan's live check; until then the success message
  says "Start a new Codex chat to use them." and switches to "Restart Codex to use them." if the test needs it.
- *Answered (spike 10):* a second `codex.exe app-server` leaves only a temp `~/.codex/tmp/arg0-windows/codex-arg0*`
  folder; no session files. The app alias `chatgpt-desktop.exe` resolves with `fs.readlinkSync`.

## Addendum — the hook command must survive PowerShell (17 Nov, live check)

**Found in the live check:** the Codex app runs a hook's `command` through PowerShell on Windows. The HUD
installed `"<resources>\codex-hook.cmd"` (a bare quoted path), which PowerShell evaluates as a string and
prints — the bridge never ran, no Codex chat ever reached the HUD, and the path was injected into every Codex
chat as `hooks.additional_context` (seen in rollouts at 15:27 and 15:48). Reproduced with
`powershell -Command '"<path>"'`. Trust itself works: the trusted hooks ran in the open app without a restart.

**Decided with the user:** fix it on this branch.

- New command: `cmd /d /c "<resources>\codex-hook.cmd"` — tested to run (stdin passed) under both PowerShell
  and cmd, from a path with a space.
- The old bare-quoted form still counts as the HUD's own in `codex-hooks.js` (install / remove / positions),
  so install rewrites it **in place** — positions never move. `codex-trust.js` keeps trusting only the exact
  new command (the old one cannot run).
- **Upgrade at startup** *(Claude's call)*: when the hooks file holds the old form, the HUD rewrites it.
  Codex now sees a changed hook (new hash) while the HUD's own approval check still sees the old
  `trusted_hash` entry, so the HUD asks Codex directly: with `codexAutoTrust` it runs the trust step
  (startup wording); without it, it shows `Agent HUD updated its Codex hooks` + `CODEX_APPROVE_BALLOON`.
