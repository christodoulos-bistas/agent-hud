import { RELEASE } from './answers.js';

export function createQueue({ holdMs = 60000, replyMs = 540000, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const entries = []; // arrival order: { item, resolve, timer }
  let handed = [];
  const listeners = new Set();
  const emit = () => { for (const fn of [...listeners]) fn(); };

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
    return new Promise((resolve) => {
      const e = { item, resolve, timer: null };
      e.timer = setTimer(() => {
        if (!take(item.id)) return;
        handed.push({ sessionId: item.sessionId, at: now() });
        resolve(RELEASE);
        emit();
      }, item.kind === 'reply' ? replyMs : holdMs);
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
    active: () => ordered()[0] ?? null,
    list: ordered,
    handedBack: () => handed.map((h) => ({ ...h })),
    clearHandedBack(sessionId) {
      const n = handed.length;
      handed = handed.filter((h) => h.sessionId !== sessionId);
      if (handed.length !== n) emit();
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
