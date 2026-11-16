import { moodOf } from './classes.js';
import { displayName, baseOf } from './sessions.js';
import { activityLine, createStepLog } from './steps.js';
import { stageOf, stuckOf } from './stages.js';

const NEEDS_NOTIFS = new Set(['permission_prompt', 'elicitation_dialog', 'agent_needs_input']);
const isSynthetic = (ev) => String((ev.raw || {}).prompt || '').trim().startsWith('<task-notification>');

export { activityLine } from './steps.js';

const ASKS = { permission: 'asks permission', choice: 'asks a question', reply: 'wants a reply' };

export function createStore({ engine, queue, now = Date.now, holdMs = 60000, replyMs = 540000 }) {
  let sessions = [];
  const state = new Map();
  const optIn = new Map();
  const steps = createStepLog({});
  const stages = new Map(); // id -> { stage, since }
  const st = (id) => {
    let s = state.get(id);
    if (!s) { s = { lastActivityAt: null, lastMainActivityAt: null, stoppedAt: null, notif: null, activity: '', cwd: null }; state.set(id, s); }
    return s;
  };

  function onEvent(ev) {
    engine.push(ev);
    steps.push(ev);
    const s = st(ev.sessionId);
    if (ev.cwd) s.cwd = ev.cwd;
    const e = ev.event;
    // Subagent events share the parent's session_id and carry agent_id (SPIKES.md).
    const agentId = (ev.raw || {}).agent_id ?? null;
    const active = () => {
      s.lastActivityAt = ev.at;
      if (agentId === null) s.lastMainActivityAt = ev.at;
    };
    if (e === 'UserPromptSubmit') {
      active();
      if (!isSynthetic(ev)) s.activity = activityLine(ev);
    } else if (e === 'PreToolUse') {
      active();
      s.activity = activityLine(ev);
    } else if (typeof e === 'string' && e.startsWith('PostToolUse')) {
      active();
    } else if (e === 'Stop') {
      const bg = (ev.raw || {}).background_tasks;
      if (!(Array.isArray(bg) && bg.some((t) => t && t.status === 'running'))) s.stoppedAt = ev.at;
      s.notif = null; // whatever it was asking for, the turn is over
    } else if (e === 'SessionEnd') {
      s.notif = null;
    } else if (e === 'Notification') {
      s.notif = { type: (ev.raw || {}).notification_type, at: ev.at };
    }
    if (e !== 'Notification') queue.clearHandedBack(ev.sessionId, agentId);
  }

  // A session file can be caught half-written, so a session is forgotten only after it is missing from
  // two polls in a row; while missing once it stays listed with its last known data (I8).
  const missed = new Map();
  function setSessions(list) {
    const fresh = list.map((x) => ({ ...x }));
    const keep = new Set(fresh.map((x) => x.sessionId));
    const held = [];
    for (const old of sessions) {
      if (keep.has(old.sessionId)) continue;
      const n = (missed.get(old.sessionId) ?? 0) + 1;
      if (n < 2) { missed.set(old.sessionId, n); held.push(old); continue; }
      missed.delete(old.sessionId);
      engine.forget(old.sessionId); steps.forget(old.sessionId); stages.delete(old.sessionId); state.delete(old.sessionId); optIn.delete(old.sessionId);
    }
    for (const id of keep) missed.delete(id);
    sessions = [...fresh, ...held];
  }

  function setReplyOptIn(id, on) { optIn.set(id, !!on); }

  // A reply sent from the HUD resumes the session; no hook announces it (SPIKES.md 3a), so mark it here.
  function replySent(id) {
    const s = st(id);
    const t = now();
    s.lastActivityAt = t;
    s.lastMainActivityAt = t;
    s.stoppedAt = null;
    s.activity = 'thinking';
  }

  const displayOf = (id) => {
    const sess = sessions.find((x) => x.sessionId === id);
    if (sess) return displayName(sess);
    return baseOf(state.get(id)?.cwd) || 'unknown';
  };

  function computeAgents(t) {
    const items = queue.list();
    const handed = queue.handedBack();
    const ordered = sessions.map((x, i) => ({ x, i }))
      .sort((a, b) => (a.x.startedAt ?? 0) - (b.x.startedAt ?? 0) || a.i - b.i).map((o) => o.x);
    const agents = ordered.map((sess) => {
      const id = sess.sessionId;
      const s = st(id);
      const handedBack = handed.some((h) => h.sessionId === id);
      const notifPending = !!s.notif && NEEDS_NOTIFS.has(s.notif.type) && s.notif.at >= (s.lastMainActivityAt ?? -Infinity);
      const pending = items.some((it) => it.sessionId === id) || handedBack || notifPending;
      const view = steps.view(id);
      const baseMood = moodOf({ pending, stoppedAt: s.stoppedAt, lastActivityAt: s.lastActivityAt, status: sess.status }, t);
      const stage = stageOf({ mood: baseMood, view, status: sess.status, now: t });
      const stuck = stuckOf({ stage, view, status: sess.status, now: t });
      let rec = stages.get(id);
      if (!rec || rec.stage !== stage) { rec = { stage, since: t }; stages.set(id, rec); }
      return {
        id, display: displayName(sess), cls: engine.classOf(id, t),
        mood: stage === 'thinking' || stage === 'working' ? 'working' : baseMood,
        activity: s.activity, familiars: Math.min(engine.activeSubagents(id), 3),
        replyOptIn: !!optIn.get(id), entrypoint: sess.entrypoint, cwd: sess.cwd, handedBack,
        stage, stuck, stageSince: rec.since,
        currentStepStartedAt: view.current ? view.current.startedAt : null,
        lastActivityAt: s.lastActivityAt,
      };
    });
    return agents;
  }

  function snapshot() {
    const t = now();
    const items = queue.list();
    const agents = computeAgents(t);
    const a = queue.active();
    const card = a ? {
      id: a.id, kind: a.kind, sessionId: a.sessionId, display: displayOf(a.sessionId), cls: engine.classOf(a.sessionId, t), payload: a.payload,
      expiresAt: Number.isFinite(a.addedAt) ? a.addedAt + (a.kind === 'reply' ? replyMs : holdMs) : null,
    } : null;
    const second = items[1];
    const next = second ? `Next: ${displayOf(second.sessionId)} ${ASKS[second.kind] ?? 'asks a question'}` : null;
    return { agents, card, next, counts: { total: agents.length, needs: agents.filter((x) => x.mood === 'needs').length } };
  }

  function detail(id) {
    const sess = sessions.find((x) => x.sessionId === id);
    if (!sess) return null;
    const a = computeAgents(now()).find((x) => x.id === id);
    const view = steps.view(id);
    return {
      id, display: a.display, cls: a.cls, stage: a.stage, stuck: a.stuck,
      stageSince: a.stageSince, currentStepStartedAt: a.currentStepStartedAt, lastActivityAt: a.lastActivityAt,
      task: view.task ?? null, startedAt: view.taskAt ?? sess.startedAt ?? null,
      stepCount: view.stepCount, current: view.current, steps: view.steps, helpers: view.helpers,
    };
  }

  function stageKey() {
    return computeAgents(now()).map((a) => `${a.id}:${a.stage}:${a.stuck ? a.stuck.reason : ''}`).join('|');
  }

  return { onEvent, setSessions, setReplyOptIn, replySent, snapshot, detail, stageKey };
}
