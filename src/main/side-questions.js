// Side-question coordinator: one ask per chat, dots, tabs, focus requests, and the panel's view.
import { SIDE_ERRORS, withBusyNote } from './side-ask.js';

const PANEL_ENTRIES = 50;

export function createSideQuestions({ log, ask, now = Date.now, onChange = () => {}, onError = () => {} }) {
  const inflight = new Map(); // sessionId -> { question, at, controller }
  const dots = new Set();
  const tabs = new Map();
  const focus = new Map();
  let viewing = null;
  let healthy = true;

  const report = (msg) => { try { onError(msg); } catch { /* never break the coordinator */ } };
  const changed = () => { try { onChange(); } catch (err) { report(`side question change: ${err?.message ?? err}`); } };

  function settle(sessionId, rec, startedAt, trimmed, r) {
    if (rec.controller.signal.aborted) return; // the HUD is quitting: no entry, no dot
    if (inflight.get(sessionId) === rec) inflight.delete(sessionId);
    const result = r && typeof r === 'object' ? r : { error: SIDE_ERRORS.refused };
    if (result.detail) report(`side question ${sessionId}: ${result.detail}`);
    let logged = false;
    try {
      log.add(sessionId, { source: 'hud', question: trimmed, response: result.answer ?? null, error: result.error, at: startedAt });
      logged = true;
    } catch (err) {
      report(`side question ${sessionId}: could not save the answer: ${err?.message ?? err}`);
    }
    if (logged && viewing !== sessionId) dots.add(sessionId);
    changed();
  }

  function start(sessionId, question, ctx = {}) {
    const trimmed = String(question ?? '').trim();
    if (!trimmed || !log.validId(sessionId) || inflight.has(sessionId)) return false;
    const at = now();
    const controller = new AbortController();
    const rec = { question: trimmed, at, controller };
    inflight.set(sessionId, rec);
    let p;
    try {
      p = Promise.resolve(ask({
        sessionId, cwd: ctx.cwd, model: ctx.model,
        question: withBusyNote(trimmed, ctx.current, at, { working: !!ctx.working }),
        history: log.history(sessionId),
        signal: controller.signal,
      }));
    } catch (err) {
      p = Promise.reject(err);
    }
    rec.done = p.then((r) => r, () => ({ error: SIDE_ERRORS.refused }))
      .then((r) => settle(sessionId, rec, at, trimmed, r))
      .catch((err) => report(`side question ${sessionId}: ${err?.message ?? err}`));
    changed();
    return true;
  }

  function retry(sessionId, entryId, ctx = {}) {
    if (inflight.has(sessionId)) return false;
    const entry = log.list(sessionId).find((e) => e.id === entryId);
    if (!entry || !entry.error) return false;
    try {
      if (!log.remove(sessionId, entryId)) return false;
    } catch (err) {
      report(`side question ${sessionId}: could not remove the failed entry: ${err?.message ?? err}`);
      return false;
    }
    return start(sessionId, entry.question, ctx);
  }

  const asking = (sessionId) => {
    const rec = inflight.get(sessionId);
    return rec ? { question: rec.question, at: rec.at } : null;
  };

  function setViewing(sessionId) {
    viewing = sessionId ?? null;
    if (viewing && dots.delete(viewing)) changed();
  }

  const tab = (sessionId) => tabs.get(sessionId) ?? 'now';
  function setTab(sessionId, t) { tabs.set(sessionId, t === 'side' ? 'side' : 'now'); }
  function requestFocus(sessionId) {
    tabs.set(sessionId, 'side');
    focus.set(sessionId, now());
  }

  function importVscode(items) {
    let ids;
    try {
      ids = log.importVscode(items);
    } catch (err) {
      report(`side question import: ${err?.message ?? err}`);
      return [];
    }
    if (Array.isArray(ids) && ids.length) changed();
    return ids;
  }

  function setHealthy(b) {
    const v = !!b;
    if (v === healthy) return;
    healthy = v;
    changed();
  }

  // The HUD is quitting: every running ask is aborted (its child gets stdin EOF, then a tree kill).
  // Resolves once all of them settled (their children gone), or after maxMs at the latest.
  function stopAll(maxMs = 2500) {
    const recs = [...inflight.values()];
    for (const rec of recs) rec.controller.abort();
    inflight.clear();
    if (!recs.length) return Promise.resolve();
    return new Promise((resolve) => {
      const t = setTimeout(resolve, maxMs);
      Promise.all(recs.map((r) => r.done)).then(() => { clearTimeout(t); resolve(); });
    });
  }

  function view(sessionId) {
    const all = log.list(sessionId);
    return {
      tab: tab(sessionId),
      count: log.count(sessionId),
      dot: dots.has(sessionId),
      asking: asking(sessionId),
      entries: all.slice(-PANEL_ENTRIES),
      healthy,
      focusAsk: focus.get(sessionId) ?? null,
    };
  }

  return { start, retry, asking, dot: (id) => dots.has(id), setViewing, tab, setTab, requestFocus, importVscode, setHealthy, stopAll, view };
}
