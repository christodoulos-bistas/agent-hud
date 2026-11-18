import { RELEASE } from './answers.js';

export function createQueue({ holdMs = 60000, replyMs = 540000, planMs = 540000, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, onError = (e) => console.error(e) } = {}) {
  const entries = []; // arrival order: { item, resolve, timer }
  let handed = [];
  const listeners = new Set();
  const emit = () => { for (const fn of [...listeners]) { try { fn(); } catch (err) { try { onError(err); } catch { /* never break the queue */ } } } };

  const holdFor = (kind) => (kind === 'reply' ? replyMs : kind === 'plan' ? planMs : holdMs);
  const take = (id) => {
    const i = entries.findIndex((e) => e.item.id === id);
    if (i < 0) return null;
    const [e] = entries.splice(i, 1);
    clearTimer(e.timer);
    return e;
  };
  const ordered = () => [
    ...entries.filter((e) => e.item.kind !== 'reply'),
    ...entries.filter((e) => e.item.kind === 'reply'),
  ].map((e) => e.item);

  function add(item) {
    item.addedAt = now();
    // The hold travels with the card (R1): the renderers' rings and countdowns read holdMs and
    // expiresAt, so main's holdMs / replyMs / planMs are the only place a hold is set.
    item.holdMs = holdFor(item.kind);
    item.expiresAt = item.addedAt + item.holdMs;
    return new Promise((resolve) => {
      const e = { item, resolve, timer: null };
      e.timer = setTimer(() => {
        if (!take(item.id)) return;
        // A reply that runs out just lets Claude stop: nothing waits in the session's window.
        if (item.kind !== 'reply') handed.push({ sessionId: item.sessionId, agentId: item.payload?.agent_id ?? null, at: now() });
        resolve(RELEASE);
        emit();
      }, item.holdMs);
      entries.push(e);
      emit();
    });
  }
  function answer(id, response) {
    const e = take(id);
    if (!e) return;
    e.resolve(response);
    emit();
  }
  function drop(id) { if (take(id)) emit(); }
  function releaseWhere(pred) {
    const hit = entries.filter((e) => pred(e.item));
    if (!hit.length) return;
    for (const e of hit) { take(e.item.id); e.resolve(RELEASE); }
    emit();
  }

  return {
    add, answer, drop,
    releaseSession: (sessionId, kinds) => releaseWhere((i) => i.sessionId === sessionId && (!kinds || kinds.includes(i.kind))),
    releaseAll: () => releaseWhere(() => true),
    list: ordered,
    handedBack: () => handed.map((h) => ({ ...h })),
    // Only the thread that was handed back can clear it: the main thread (agentId null) or one subagent.
    clearHandedBack(sessionId, agentId = null) {
      const n = handed.length;
      handed = handed.filter((h) => h.sessionId !== sessionId || h.agentId !== (agentId ?? null));
      if (handed.length !== n) emit();
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
