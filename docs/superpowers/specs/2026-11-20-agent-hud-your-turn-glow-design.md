# Agent HUD: "Your turn" glow that always plays and waits until seen (short design)

Status: approved · 20 November 2026 · from `main` 1d15650

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
║  A small two-parter: a finish flash that always plays, and a quiet glow  ║
║  that waits for you. The stubborn blocker is the keyed patch that swaps  ║
║  a row out from under its flash.                                         ║
╟──────────────────────────────────────────────────────────────────────────╢
║  ROGUES GALLERY                                                          ║
║  ◆ SANDMAN        a row redrawn mid-flash loses its class                ║
║  ◆ MYSTERIO       Node tests render HTML; no DOM proves the              ║
║                   flash survives a redraw (live check does)              ║
║  ◆ CHAMELEON      reading the chat in its own window is not              ║
║                   "seen": only the HUD and panel can tell                ║
║  ◆ GREEN GOBLIN   a glow that never clears and turns into                ║
║                   noise, so every way out must clear it                  ║
╚══════════════════════════════════════════════════════════════════════════╝
```

## Intent

The user: "the your turn sometimes isn't highlighted". A finished chat should be as easy to spot as one
that needs you, even when it finished while the user was looking elsewhere.

## Findings (20 November 2026, instrumented dev HUD, five live turns in the spike project)

- The finish flash fired on all five turns (plain, Bash, Glob, helper, plain).
- **Collapsed HUD:** the flash class lands on the face, but `hud.css` styles only `.row.glow-done`, so
  nothing shows. "Needs you" does show on faces.
- **Fragile flash:** `glow-done` is added to the live element after `patch()`. Any change to that row's HTML
  within ~2.4 s replaces the element (keyed patch compares `outerHTML`) and the flash is gone. Seen live: a
  background helper flipped the row to Working 150 ms after the Stop.
- **By design today:** the flash lasts 2.4 s, then a "Your turn" row has no highlight. "Needs you" glows
  until answered, so two "Your turn" rows look different depending on when they finished.

## Approaches

- **Chosen (the user's pick): stay lit until seen.** After the flash, a finished row keeps a soft, steady
  green-gold glow until the user has seen that chat.
- Rejected: flash only, made reliable. A finish you missed stays invisible.
- Rejected: lit for a fixed time (e.g. 2 min). It clears whether or not you looked.

## Design

- **Unseen, owned by main (the store).** An agent gets `unseen: true` when its stage *changes into* `turn`
  (the existing `stages` transition in `computeAgents`). A chat already in `turn` when the HUD starts is not
  unseen (same rule as M8: the first snapshot only seeds). Memory only: a restart forgets it.
- **What clears it:**
  - the chat leaves `turn` (a new prompt, a question, a reply sent from the HUD);
  - its details are open in the panel (the selected agent), including when it finishes while already open;
  - ✕ hides it.
  - Reading or typing in the chat's own window doesn't count, because the HUD can't see it. The next prompt
    clears it anyway (CHAMELEON).
- **Look:** a row with `unseen` gets a class rendered into its HTML (robust, like `glow-ask`). It's a static,
  soft green-gold inset glow, clearly fainter than the gold "Needs you" glow and never animated in a loop
  (M4). The collapsed face gets a matching soft green-gold background. Tucked rows never glow.
- **The flash, made reliable:** the renderer remembers which chats are mid-flash (from `newlyFinished`). After
  every `patch()` it re-adds `glow-done` to any of those rows that lost it, and forgets them on
  `animationend` or after 3 s with reduced motion. Nothing time-based enters the row HTML (I1).
- **Collapsed flash:** `.face.glow-done` gets the same finite `done-pulse` treatment as rows.
- Sound, the "Your turn" chip and the pennant are unchanged.

## Claude's calls (the user can override)

- "Seen" means the panel showed that chat's details, or ✕. A plain hover doesn't count.
- The glow lives in the store's snapshot (`agents[].unseen`), not the renderer, so the HUD and the panel
  agree and a renderer reload keeps it.

## Testing

- Unit (store): unseen set on a transition into `turn`, not on the first sighting; cleared on leaving
  `turn`, on `markSeen`, on ✕.
- Unit (render): the `unseen` class is in the row and face HTML; not on tucked rows; escaped as usual; the
  CSS doesn't loop-animate `box-shadow` (M4 test).
- Live (dev HUD, spike project): a turn finishes while another chat's details are open, so the row stays
  lit. Click it and the glow goes. A turn finishes while its own details are open, so it flashes and doesn't
  stay lit. Collapsed: a face flashes and then stays softly lit.

## Left to the builder

The store's API name for "seen" (e.g. `markSeen(id)`), where main calls it (the push path is fine), the
exact colours and alpha, and the renderer's re-apply bookkeeping.
