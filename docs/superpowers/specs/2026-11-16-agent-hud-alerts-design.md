# Agent HUD — question pop-open and finish glow (v1.2) — short design

Status: approved by the user · 16 November 2026 · builds on v1 and v1.1 (branch `agent-hud-v1`)

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
║  A two-parter: questions pop the panel open, finished agents glow. One   ║
║  stubborn blocker: typing an answer in a panel that must never take      ║
║  focus on its own, and give it straight back afterwards.                 ║
╟──────────────────────────────────────────────────────────────────────────╢
║  ROGUES GALLERY                                                          ║
║  ◆ GREEN GOBLIN   A popped-open panel that grabs focus while you type    ║
║                   in your editor                                         ║
║  ◆ THE SPOT       Moving the cards out of the HUD breaks v1 answering    ║
║  ◆ SANDMAN        Selection flipping between auto-opened and chosen      ║
║  ◆ ELECTRO        A question arriving mid-click on another card          ║
╚══════════════════════════════════════════════════════════════════════════╝
```

## Intent
The user wants to notice at once when an agent needs them, and to answer
with enough room to read every option. They also want to notice when an
agent finishes.

## Decided by the user
- **Questions pop the panel open.** When an agent asks something
  (permission, multiple choice, or an opted-in reply), the detail panel
  opens beside the HUD by itself on that agent. The question sits at the
  top of the panel with every option, the full command and the
  countdown.
- **Answer cards move from the HUD into the panel.** It's the same code
  and the same 60 s / 9 min holds. The HUD keeps no card: only the glowing
  row and the "Next: …" line.
- **Question glow.** The asking agent's row glows gold: 3 strong pulses,
  then a slow steady "breathing" glow until it's answered.
- **Finish glow.** On "Your turn", the row glows briefly in green-gold and
  the chip reads **Your turn** with the pennant sparkle. Nothing pops
  open. Clicking the row shows a **Finished** section in the panel with
  Claude's last message (the first ~600 characters).

## Calls made in the approved design
- **One question at a time.** If the panel was showing another agent, it
  switches to the question. After the answer it returns to what was open
  before, or closes if it had opened by itself.
- **Collapsed HUD.** The face still pulses, and the panel still pops open
  next to the collapsed column.
- **Focus.** The panel never takes keyboard focus by itself. It takes
  focus only when the user clicks into a text box ("Something else…" or a
  reply) and gives it back as soon as the answer is sent or released.
  This is the HUD's v1 `setInteractive` pattern.
- **Unchanged:**
  - A hidden HUD still holds no questions.
  - No sound.
  - Answering in the agent's own window still works.
  - The 500 ms "arming" guard on card buttons stays.

## Approaches
- **Chosen: cards in the panel.** This reuses `renderCard` and the card
  state logic.
- **Rejected: keep cards in the HUD.** The 272 px HUD is too narrow for
  long options or commands.
- **Rejected: cards in both places.** Two copies of one question confuse,
  and an answer in one would have to retract the other.

## Data the build needs
- **Last message.** Stop's `last_assistant_message` is kept per session
  (whitespace collapsed, 600 chars) and exposed in `detail.lastMessage`.
  It's only shown while the stage is `turn`.
- **The current card** goes to the panel: main pushes the queue's active
  card with the detail.

## Non-goals
Sound, OS notifications, answering more than one question at a time, and
auto-opening on finish.
