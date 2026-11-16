import path from 'node:path';
import { moodOf } from './classes.js';
import { displayName, baseOf } from './sessions.js';

const NEEDS_NOTIFS = new Set(['permission_prompt', 'elicitation_dialog', 'agent_needs_input']);
const isSynthetic = (ev) => String((ev.raw || {}).prompt || '').trim().startsWith('<task-notification>');

export function activityLine(ev) {
  const t = ev.toolName; const i = ev.toolInput || {};
  if (ev.event === 'UserPromptSubmit') return 'thinking';
  switch (t) {
    case 'Read': return `reading ${path.win32.basename(String(i.file_path || ''))}`;
    case 'Edit': case 'Write': return `editing ${path.win32.basename(String(i.file_path || ''))}`;
    case 'Bash': return `running ${String(i.command || '').slice(0, 40)}`;
    case 'Grep': case 'Glob': return 'searching code';
    case 'WebSearch': return 'searching the web';
    case 'WebFetch': {
      try { return `reading ${new URL(String(i.url)).hostname}`; } catch { return 'reading the web'; }
    }
    case 'Agent': case 'Task': return `sending a ${i.subagent_type || 'general'} helper`;
    default: return t || '';
  }
}

export function createStore({ engine, queue, now = Date.now }) {
  let sessions = [];
  const state = new Map();
  const optIn = new Map();
  const st = (id) => {
    let s = state.get(id);
    if (!s) { s = { lastActivityAt: null, stoppedAt: null, notif: null, activity: '', cwd: null }; state.set(id, s); }
    return s;
  };

  function onEvent(ev) {
    engine.push(ev);
    const s = st(ev.sessionId);
    if (ev.cwd) s.cwd = ev.cwd;
    const e = ev.event;
    if (e === 'UserPromptSubmit') {
      s.lastActivityAt = ev.at;
      if (!isSynthetic(ev)) s.activity = activityLine(ev);
    } else if (e === 'PreToolUse') {
      s.lastActivityAt = ev.at;
      s.activity = activityLine(ev);
    } else if (typeof e === 'string' && e.startsWith('PostToolUse')) {
      s.lastActivityAt = ev.at;
    } else if (e === 'Stop') {
      const bg = (ev.raw || {}).background_tasks;
      if (!(Array.isArray(bg) && bg.some((t) => t && t.status === 'running'))) s.stoppedAt = ev.at;
    } else if (e === 'Notification') {
      s.notif = { type: (ev.raw || {}).notification_type, at: ev.at };
    }
    if (e !== 'Notification') queue.clearHandedBack(ev.sessionId);
  }

  function setSessions(list) {
    const keep = new Set(list.map((x) => x.sessionId));
    for (const old of sessions) {
      if (!keep.has(old.sessionId)) { engine.forget(old.sessionId); state.delete(old.sessionId); optIn.delete(old.sessionId); }
    }
    sessions = list.map((x) => ({ ...x }));
  }

  function setReplyOptIn(id, on) { optIn.set(id, !!on); }

  const displayOf = (id) => {
    const sess = sessions.find((x) => x.sessionId === id);
    if (sess) return displayName(sess);
    return baseOf(state.get(id)?.cwd) || 'unknown';
  };

  function snapshot() {
    const t = now();
    const items = queue.list();
    const handed = queue.handedBack();
    const ordered = sessions.map((x, i) => ({ x, i }))
      .sort((a, b) => (a.x.startedAt ?? 0) - (b.x.startedAt ?? 0) || a.i - b.i).map((o) => o.x);
    const agents = ordered.map((sess) => {
      const id = sess.sessionId;
      const s = st(id);
      const handedBack = handed.some((h) => h.sessionId === id);
      const notifPending = !!s.notif && NEEDS_NOTIFS.has(s.notif.type) && s.notif.at >= (s.lastActivityAt ?? -Infinity);
      const pending = items.some((it) => it.sessionId === id) || handedBack || notifPending;
      return {
        id, display: displayName(sess), cls: engine.classOf(id, t),
        mood: moodOf({ pending, stoppedAt: s.stoppedAt, lastActivityAt: s.lastActivityAt, status: sess.status }, t),
        activity: s.activity, familiars: Math.min(engine.activeSubagents(id), 3),
        replyOptIn: !!optIn.get(id), entrypoint: sess.entrypoint, cwd: sess.cwd, handedBack,
      };
    });
    const a = queue.active();
    const card = a ? { id: a.id, kind: a.kind, display: displayOf(a.sessionId), cls: engine.classOf(a.sessionId, t), payload: a.payload } : null;
    const second = items[1];
    const next = second ? `Next: ${displayOf(second.sessionId)} ${second.kind === 'reply' ? 'wants a reply' : 'asks a question'}` : null;
    return { agents, card, next, counts: { total: agents.length, needs: agents.filter((x) => x.mood === 'needs').length } };
  }

  return { onEvent, setSessions, setReplyOptIn, snapshot };
}
