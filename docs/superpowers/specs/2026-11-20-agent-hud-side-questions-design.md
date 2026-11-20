# Agent HUD — side questions: ask from the HUD, keep VS Code's /btw (v1.5) — design

Status: draft for approval · 20 November 2026 · from `main` 8842a13

🕷️

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
║  Several foes, fought one at a time: an asker, a VS Code reader, a log,  ║
║  a panel tab and a row shortcut are separate fronts that meet in one     ║
║  store and one panel.                                                    ║
╟──────────────────────────────────────────────────────────────────────────╢
║  ROGUES GALLERY                                                          ║
║  ◆ GREEN GOBLIN   an update renames the side_question request or         ║
║                   VS Code's sideQuestionThreads key: both go dark        ║
║  ◆ THE SPOT       the asking process writes a session file under         ║
║                   the chat's own id; the row follows it for seconds      ║
║  ◆ CHAMELEON      the child inherits ELECTRON_RUN_AS_NODE or a host      ║
║                   entrypoint and starts as the wrong thing               ║
║  ◆ MYSTERIO       VS Code's stored shape is read from one sample         ║
║  ◆ MORBIUS        re-reading every workspace database on each poll       ║
║  ◆ VULTURE        the thread growing into a second chat window           ║
╚══════════════════════════════════════════════════════════════════════════╝
```

## 1. Intent

Claude Code's `/btw` asks a chat a quick side question without adding to its history. The user uses it to
check on an agent's work mid-task ("if we start now will it be a problem?"). Two things are wrong today:

- **The answers disappear.** They are kept out of the transcript by design. VS Code keeps only the newest
  20 per chat and expires them; the desktop app never saves them; the CLI keeps them in memory at most.
- **You have to go to the chat to ask.** The HUD exists so the user doesn't tab-hunt; asking an agent a
  side question should work from its row.

So the HUD gets **side questions**: ask any Claude chat a side question from the HUD, and keep every side
question — asked from the HUD, or with `/btw` in VS Code — in the HUD's own log, per chat.

This is the first of four improvements agreed on 20 November 2026. The others get their own designs, in
this order: the red "hook failed" lines while the HUD is closed; then a waiting age on bubbles and a
helper count on rows (together).

## 2. Goals, non-goals, anti-goals

**Goals**
- From a Claude agent's row, ask that chat a side question and read the answer in the HUD, with the
  chat's full context, without interrupting or changing the chat.
- Follow-up questions carry the earlier exchanges, as `/btw` does.
- Every side question asked with `/btw` in a VS Code Claude panel shows up in the HUD under its chat.
- Nothing is lost: the HUD's log keeps what VS Code's 20-exchange cap and expiry would drop.

**Non-goals**
- Desktop-app side chats (never saved to disk) and CLI `/btw` (no on-disk record found). Only questions
  asked *from the HUD* are kept for chats in those hosts.
- Codex chats: no side questions (no equivalent request is known).
- VS Code forks (Insiders, Cursor, VSCodium): only `%APPDATA%\Code\User`.
- Sending a side answer into the chat, or acting on it.
- A searchable archive or export across chats.

**Anti-goals**
- **The live chat changes.** No new transcript lines, no new session files left behind, no hook events,
  no interruption. (Verified for the asking mechanism in the spikes below; must stay true.)
- **It nags.** No chime and no glow for a side answer; a quiet dot at most.
- **It becomes a second chat window** (VULTURE). The thread is a short Q&A list with one ask box: no
  streaming tokens, no tools, no attachments, no editing.
- **It slows the HUD.** The VS Code reader must not re-read unchanged databases (MORBIUS).
- **A broken internal goes quiet.** If either undocumented mechanism stops working, the HUD says so in
  the tab instead of silently showing nothing (GREEN GOBLIN).

## 3. Facts the design rests on (observed 20 November 2026)

Claude Code 2.1.327 CLI, VS Code extension 2.1.328, Electron 44.7.2 (Node 24.21.0).

**Docs** (code.claude.com): `/btw` "ask[s] a side question … without adding to the conversation"
(commands, interactive-mode). Desktop: "doesn't save side chats to disk". VS Code: "The thread survives
window reloads. Claude Code keeps the newest 20 exchanges and expires stored threads on the
cleanupPeriodDays schedule." No hook event is documented for side questions.

**How VS Code asks** (extension source): the panel sends a `side_question` control request to its Claude
process over the SDK's stream-json control protocol — `{ subtype: "side_question", question, history? }`,
history being `[{ question, response }]` — with a 300 000 ms timeout. It is not a user message, so no
`UserPromptSubmit` or other hook fires.

**Spike A — ask by forking the chat** (documented flags: `-p --resume <id> --fork-session
--no-session-persistence --tools ""`). Correct answer; live transcript byte-identical; no new files. But
8 s idle and 22 s busy, **$0.73 per question** on a near-empty chat (cache miss), and when the chat was
mid-turn the fork **continued the unfinished task** after answering. Rejected.

**Spike B — the `side_question` request.** Spawn `claude.exe -p --input-format stream-json
--output-format stream-json --verbose --resume <id> --no-session-persistence --settings
'{"disableAllHooks":true}'` in the chat's cwd, send `{"type":"control_request","request_id":"init",
"request":{"subtype":"initialize"}}`, then `{"type":"control_request","request_id":"sq","request":
{"subtype":"side_question","question":"…","history":[…]}}`. The answer arrives as
`{"type":"control_response","response":{"subtype":"success","request_id":"sq","response":
{"response":"MARMALADE","synthetic":false}}}` about 1 s after the request (3.3 s including start-up).
Live transcript byte-identical; no new transcript files; `history` is honoured. Chosen.

**Spike C — side effects of the asking process.** While it runs, it writes
`~/.claude/sessions/<its pid>.json` with **the chat's own `sessionId`**, `kind: "interactive"`, an
inherited `entrypoint`, `status: "idle"`, plus a `<pid>.<hash>.key` file; both are removed when it exits.
`sessions.js` keeps one file per `sessionId` (newest start wins), so for those seconds the HUD would track
the asking process instead of the real chat (THE SPOT). The `entrypoint` comes from the child's
`CLAUDE_CODE_ENTRYPOINT`: with it set to `agent-hud-side`, the file says `"entrypoint": "agent-hud-side"`.

**Spike E — mid-turn.** A busy turn on the spike chat ran `sleep 25` through Bash; once the transcript held
the `tool_use` without its result, the HUD-style child (Spike B, plus `--model` read from the transcript's
last assistant line, `claude-opus-5-5`) asked "What are you doing right now, and what code word did I give
you?". Answer in 3.0 s: "The `sleep 25` command I started … was interrupted when the session ended … The
code word is MARMALADE." The busy turn went on and finished ("SLEPT"); the side question never reached the
transcript (43 → 70 lines, all the busy turn's). So asking mid-turn works, but the child **reads an
unfinished step as interrupted**: VS Code's in-process `/btw` knows the turn is live; a resumed child does
not (§6.2 adds what the HUD knows). The chat was made by `claude -p` (entrypoint `sdk-cli`); a VS Code chat
behaved the same in Spike B; a desktop-app chat is untested (§8).

**Spike D — where VS Code keeps the threads.** Per workspace, in
`%APPDATA%\Code\User\workspaceStorage\<hash>\state.vscdb` (SQLite; `workspace.json` beside it names the
folder). Table `ItemTable`, key `memento/workbench.parts.editor`; inside it,
`editorpart.state.serializedGrid.root.data[i].data.editors[j].value` is a JSON string whose `state` is a
JSON string of the Claude panel's state: `{ isFullEditor, sessionID, sideQuestionThreads }`.
`sideQuestionThreads` maps `"<sessionId> <suffix>"` (e.g. `"af479eec-… 9ped11"`) to
`{ entries: [{ kind: "answer", question, response }], updatedAt }`. Entries carry no time of their own.
A `/btw` asked at 12:15 was in the file by 12:15:04. `node:sqlite` in Electron's Node opens it read-only
while VS Code is running. Seen in two workspaces, both with the panel as an editor tab; where a sidebar
panel keeps its state is unverified (MYSTERIO).

**Environment.** From this machine's shells, Node could not start `cmd.exe` late in the session, but could
start `claude.exe` directly; the HUD must spawn `claude.exe` without a shell. The memory note
"ELECTRON_RUN_AS_NODE in the shell" applies to any child the HUD starts (CHAMELEON).

## 4. Approaches considered

**Where side questions come from**
- **Chosen: both** — ask from the HUD, and copy VS Code's `/btw` threads. The user: "it's more helpful to
  ask /btw questions from the HUD", while questions already asked in VS Code should also stop vanishing.
- Rejected: VS Code copy only (keeps the tab-hunting); HUD asking only (VS Code `/btw` answers still expire).

**How the HUD asks**
- **Chosen: the `side_question` control request** (Spike B): about 1 s, reuses the chat's context like
  `/btw`, built for mid-task questions, writes nothing to the transcript. Undocumented, so a failure must
  be visible (§6.6).
- Rejected: fork-and-print (Spike A): documented, but about 25× slower when busy, a cache miss on every
  question, and it resumes unfinished work.
- Rejected: the chat's messaging pipe — Spike 14 showed it ignores guessed messages.

**How it looks** (mockups drawn with the HUD's own renderers and stylesheets:
`.superpowers/brainstorm/767-1795169853/content/side-questions-layout.html`, generated by a scratch script)
- A: a section at the bottom of the details — makes the details panel tall.
- **Chosen: B + C's shortcut** (the user agreed: "yup i agree"): a **Side questions tab** beside **Now** in
  the details panel, and a **?** on a hovered row that opens straight onto that tab with the cursor in
  the ask box; an answer that lands while you're elsewhere puts a quiet dot on the row.
- C alone (an ask card above the details, history one level deeper) — rejected as the main home.

## 5. What the user sees

### 5.1 The row
- Hovering (or keyboard-focusing) a **Claude** row — any host: VS Code, desktop app, CLI — shows a small
  slate **?** button left of the ✕, styled like ✕ (18 × 18, `title="Ask on the side"`). Not on Codex rows;
  not on tucked rows. (A desktop chat that can't be resumed shows the §6.6 error.)
- Clicking it selects the agent (as clicking the name does), opens the panel on the **Side questions**
  tab, and focuses the ask box.
- **Answer dot:** a slate dot (8 px, `#8fa6c6`, soft glow) at the left of the row's chip, when a
  HUD-asked answer — or a "couldn't ask" error — arrived while that chat's Side questions tab was not on
  screen. Opening that tab clears it. VS Code-copied entries never set it (the user saw them in VS Code).
  No sound, no glow, no change to the "needs you" count.
- Collapsed HUD (faces): no ? and no dot.

### 5.2 The panel
- Under the header, Claude agents get two tabs: **Now** (today's details, unchanged) and **Side questions
  N** (N = entries logged for this chat; hidden when 0 → just "Side questions"). Codex agents get no tabs.
- The panel opens on **Now** unless the ? opened it. The chosen tab is kept per agent while the HUD runs;
  a question bubble arriving does not switch tabs (the stack sits above the tabs as today).
- **Side questions tab:** a thread, oldest first, scrolled to the newest, max height about 300 px; then the
  ask box (input + gold **Ask**; Enter sends); then the footer as today.
  - Each entry: the question in italic serif (`#cfd6e6`), a tag **HUD** (slate) or **VS Code** (grey, like
    the `.src` tag), the time (relative while under a day, then a date); the answer in a slate-tinted
    block with a slate left rule, max about 9.5 lines, then it scrolls; a **copy** link copies the raw
    answer text.
  - While waiting: the entry shows "thinking…" in the answer block; the ask box is disabled with
    placeholder "Waiting for the answer…" (one question at a time per chat).
  - Errors replace the answer block in the rust style (§6.6), with **try again** and **open window ↗**.
  - Empty: "None yet. Ask one, or use /btw in VS Code: those show up here too." + the ask box.
  - If the VS Code reader is unhealthy, one sage line above the ask box: "Can't read VS Code side
    questions right now." (§6.6).
- Colours stay in the house tokens; slate (`--slate` family, already "thinking") marks everything
  side-question, so nothing reads as gold (needs you) or green (finished).
- Answers render a safe Markdown subset (§6.5).

## 6. How it works

### 6.1 The log (main)
- One JSON Lines file per chat: `<userData>\side-questions\<sessionId>.jsonl`. A line:
  `{ "id", "at", "source": "hud" | "vscode", "question", "response" | null, "error"?: string }`.
  `at` is when the HUD asked, or when the HUD first saw a VS Code entry (VS Code entries have no time;
  the newest entry of a thread may use the thread's `updatedAt`).
- **Dedupe:** a VS Code entry is new when `sha1(sessionId + "\n" + question + "\n" + response)` is not in
  that chat's log. A HUD-asked exchange is never re-added from VS Code (different chats' processes; it
  never reaches VS Code's state).
- **Retention (Claude's call):** kept until the user deletes it: no automatic deletion, no per-chat cap.
  The point is that nothing is lost, the files are small text, and deleting while VS Code still holds a
  thread would only re-import it as new. The tray gets **Open side-question logs** (opens the folder).
- The store publishes, per agent: `sideCount`, `sideDot`, and, for the agent on show in the panel, its
  entries (newest 50 sent; older stay on disk) plus `asking` and the reader's health.

### 6.2 Asking (main, new module)
- **Executable:** `%USERPROFILE%\.local\bin\claude.exe` if present, else the first `claude.exe` on `PATH`
  (scanned in Node, no shell). None → error "Claude Code CLI not found".
- **Environment:** a copy of `process.env` minus `ELECTRON_RUN_AS_NODE` and `CLAUDECODE`, with
  `CLAUDE_CODE_ENTRYPOINT=agent-hud-side` (the marker §6.2's filter relies on). `windowsHide: true`, no
  shell, `cwd` = the chat's `cwd`.
- **Arguments:** `-p --input-format stream-json --output-format stream-json --verbose --resume
  <sessionId> --no-session-persistence --settings {"disableAllHooks":true}`, plus `--model <m>` where `m`
  is the `message.model` of the transcript's last `assistant` line (the chat's own model; omitted if none
  is found). The transcript is `~/.claude/projects/<cwd with : \ / replaced by ->/<sessionId>.jsonl`, or
  the `transcript_path` the chat's hooks reported.
- **What the HUD knows goes with the question** (Spike E): while the chat is working, the question sent is
  the user's text followed by a blank line and `(Agent HUD note: this chat is still working right now.
  Current step: <the step's doing text>, for <elapsed>. Anything unfinished in the conversation is still
  running, not interrupted.)`; the log keeps the user's text only. No note when the chat is idle.
- **Protocol:** write `initialize`; on its `control_response` (or after 2 s), write the `side_question`
  request with `history` = this chat's last 10 logged exchanges that have a response (HUD and VS Code
  alike), oldest first. Read stdout as JSON Lines; ignore everything except `control_response` for the
  two request ids. `subtype: "success"` with a string `response.response` → answer; `null` → "Claude gave
  no answer"; `subtype: "error"` → its `error` text.
- **End:** close stdin after the answer; kill the process if it hasn't exited 5 s later. Overall timeout
  300 s (the extension's own), then kill → "No answer after 5 minutes". The HUD closing kills any
  asking child.
- **One at a time per chat**; different chats may ask in parallel.
- **THE SPOT:** `readSessionFiles` (`src/main/sessions.js`) drops every file whose `entrypoint` is
  `agent-hud-side`. Every reader goes through it — the poll's `listSessions` (`src/main/main.js:209`), the
  `isInteractive` re-read (`:201`) and the `sessionById` fallback (`:216`) — and it hides a dev HUD's
  children from the installed HUD and the other way round, without hiding genuine SDK sessions. Hooks are
  off for the child, so no hook event for it reaches the store; a hands-on check confirms that (§8).

### 6.3 Copying VS Code's threads (main, new module)
- Every 30 s while the HUD runs (and once at start): list `%APPDATA%\Code\User\workspaceStorage\*\
  state.vscdb`; skip any whose mtime is unchanged since the last pass.
- Open read-only with `node:sqlite`; select `value` from `ItemTable` where `value LIKE
  '%sideQuestionThreads%'` (not only the one key, since the sidebar panel's key is unverified); close.
- Walk the JSON: any string that parses as JSON is walked too; any object with a
  `sideQuestionThreads` object yields threads. Thread key → `sessionId` = the part before the first space.
  Entries with `kind === "answer"` and string `question`/`response` are kept; other kinds are skipped.
- New entries go to the log (§6.1) for any session id, live in the HUD or not.
- The extraction (JSON in → `{ sessionId, question, response, updatedAt }[]` out) is a pure function.

### 6.4 Panel and HUD wiring
- New panel actions: `tab` (Now / Side), `ask` (text), `copy` (entry id), `retry` (entry id). New HUD
  action: `side` on the ? (select + open on the Side tab + focus).
- The ask box uses the existing focus-while-typing mechanism (`src/main/main.js:285`): focusable only
  while typing, focus given back afterwards (Spike 7).
- The thread is patched in place like the rest of the panel (keyed `data-key`), so a typed draft survives
  an answer arriving.

### 6.5 Answer rendering
Escape everything first (`esc`), then a fixed subset: paragraphs, `**bold**`, `` `code` ``, fenced code
blocks, `-`/`*`/`1.` lists. No links, images or HTML. **copy** copies the original text.

### 6.6 When an internal breaks (GREEN GOBLIN)
- **Asking:** a `side_question` error, an unknown-subtype reply, or no `control_response` before the
  process exits → logged entry with `error`, shown as: "Claude didn't take the side question: this Claude
  version may have changed how they work. Ask in the chat with `/btw`." (The CLI-not-found and timeout
  texts in §6.2 replace it where they apply.)
- **Copying:** a database that opens but holds no parsable `sideQuestionThreads` where the previous pass
  found some, or `node:sqlite` failing to open → the reader is unhealthy until a pass succeeds; the tab
  shows the §5.2 line, and the debug log says why. A workspace with no Claude panel is not unhealthy.

## 7. Claude's calls (the user can override)
- Log under userData as JSON Lines, kept until the user deletes it; tray item to open the folder.
- The child answers on the chat's own model, and carries the HUD's "still working" note while busy.
- The asking process is marked by its entrypoint (`agent-hud-side`), not by a pid list.
- 30 s VS Code poll, mtime-gated; `%APPDATA%\Code` only.
- History for follow-ups: the last 10 answered exchanges, both sources.
- The dot only for HUD-asked answers and errors; no sound.
- No tabs and no ? for Codex agents.
- Panel shows the newest 50 entries.
- No cost display and no confirmation before asking. The `side_question` reply carries no usage, so the
  cost per question is unmeasured; the 1–3 s answers (against 8–22 s for the cache-missing fork) suggest
  the chat's prompt cache is reused. If the child's stream ever exposes usage, the debug log records it.

## 8. Testing
- **Pure, unit-tested:** VS Code state extraction (fixtures shaped like Spike D, including a nested
  string-encoded `state`, a non-answer entry, a malformed value); log append and dedupe;
  stream-json request lines and response parsing (success, null, error, unrelated lines, split chunks);
  the Markdown subset (escaping, XSS strings); `renderPanel` tabs/thread/states; `renderRow` ? and dot;
  the `agent-hud-side` filter in `readSessionFiles`; the busy note; the model lookup.
- **Process part:** against a fake `claude.exe` (a Node script selected by an env var such as
  `AGENT_HUD_CLAUDE_EXE`, the way the Codex auto-trust tests fake the app-server) that speaks the same
  stream-json; tests never start the real Claude or touch real user files.
- **Hands-on (installed or dev HUD, throwaway chat in `C:\Consortis_projects\agent-hud-spike`):**
  1. Ask from the HUD while the chat is busy: answer shows; the chat's transcript gains nothing; the row
     never flickers to idle; the HUD's debug log shows no hook event from the asking process.
  2. `/btw` in that chat's VS Code panel: the entry appears in the tab within about 30 s, tagged VS Code.
  3. Ask a follow-up that depends on the previous answer: it is understood.
  4. Rename the Claude executable temporarily (or point the env var at a missing file): the error state
     shows; nothing else breaks.
  5. Ask a desktop-app chat (throwaway, in the spike folder): record whether it answers or errors; either
     way the HUD shows a result and the chat is untouched.
  6. Ask "what are you doing right now?" while the chat runs a long command: the answer says it is still
     running (the §6.2 note), not interrupted.

## 9. Left to the builder
- Module names and the split between store, wiring and new modules; IPC channel names.
- Exact debounce/patch mechanics, scroll-to-newest behaviour, relative-time formatting reuse.
- How the 2 s initialize fallback and 5 s exit grace are implemented.
- Order of work, as long as the `agent-hud-side` filter lands before asking is reachable from the UI.
