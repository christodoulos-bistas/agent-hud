import { moodOf } from './classes.js';
import { displayName, baseOf, knownTime } from './sessions.js';
import { activityLine, createStepLog } from './steps.js';
import { stageOf, stuckOf, currentOf } from './stages.js';
import { quietSince, tuckOf } from './tuck.js';

const NEEDS_NOTIFS = new Set(['permission_prompt', 'elicitation_dialog', 'agent_needs_input']);
const isSynthetic = (ev) => String((ev.raw || {}).prompt || '').trim().startsWith('<task-notification>');

export { activityLine } from './steps.js';

const ASKS = { permission: 'asks permission', choice: 'asks a question', reply: 'wants a reply' };

export function createStore({ engine, queue, now = Date.now, holdMs = 60000, replyMs = 540000, stepLog, onError = (e) => console.error(e), canOpen = () => true }) {
  // Whether "open window" can focus this session (main knows where code.cmd is); unknown session → false.
  const openable = (sess) => { try { return !!sess && !!canOpen(sess); } catch { return false; } };
  let sessions = [];
  const state = new Map();
  const optIn = new Map();
  const hidden = new Map(); // id -> when the user hid it with ✕ (v1.3; memory only)
  const steps = stepLog ?? createStepLog({});
  const stages = new Map(); // id -> { stage, since }
  const st = (id) => {
    let s = state.get(id);
    if (!s) { s = { lastActivityAt: null, lastMainActivityAt: null, stoppedAt: null, notif: null, activity: '', cwd: null }; state.set(id, s); }
    return s;
  };

  function onEvent(ev) {
    engine.push(ev);
    const s = st(ev.sessionId);
    s.connected = true; // its hooks reach the HUD (a session known only from its file never sets this)
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
      if (!isSynthetic(ev)) { s.activity = activityLine(ev); s.wakeAt = ev.at; } // a new turn wakes a ✕-hidden chat
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
    // The v1.1 step log goes last, on its own: a throw there can't skip the bookkeeping above (M6).
    try { steps.push(ev); } catch (err) { try { onError(err); } catch { /* never break onEvent */ } }
  }

  // A session file can be caught half-written, so a session is forgotten only after it is missing from
  // two polls in a row; while missing once it stays listed with its last known data (I8).
  const missed = new Map();
  // `poll: false` is an event-driven refresh (a Codex event): it neither counts nor resets misses and never forgets.
  function setSessions(list, { poll = true } = {}) {
    const fresh = list.map((x) => ({ ...x }));
    const keep = new Set(fresh.map((x) => x.sessionId));
    const held = [];
    for (const old of sessions) {
      if (keep.has(old.sessionId)) continue;
      if (!poll) { held.push(old); continue; }
      const n = (missed.get(old.sessionId) ?? 0) + 1;
      if (n < 2) { missed.set(old.sessionId, n); held.push(old); continue; }
      missed.delete(old.sessionId);
      engine.forget(old.sessionId); steps.forget(old.sessionId); stages.delete(old.sessionId); state.delete(old.sessionId); optIn.delete(old.sessionId);
      hidden.delete(old.sessionId);
    }
    if (poll) for (const id of keep) missed.delete(id);
    // A chat without hooks starts a new turn when its file turns busy: that wakes a ✕-hidden one. A chat
    // with hooks wakes only on a real prompt (onEvent): its file also turns busy for <task-notification>
    // turns and on the poll after the prompt that came before the ✕ (final review I1).
    for (const x of fresh) {
      const old = sessions.find((o) => o.sessionId === x.sessionId);
      if (old && old.status !== 'busy' && x.status === 'busy' && !state.get(x.sessionId)?.connected) st(x.sessionId).wakeAt = now();
    }
    sessions = [...fresh, ...held];
  }

  function setReplyOptIn(id, on) { optIn.set(id, !!on); }
  // Whether a Stop for this chat should hold a reply card: its "wait for my reply" box, visible, tucked or
  // hidden alike (final review I2; a reply card is `needs`, so it brings a hidden chat back).
  const wantsReply = (id) => !!optIn.get(id) && sessions.some((x) => x.sessionId === id);

  // A reply sent from the HUD resumes the session; no hook announces it (SPIKES.md 3a), so mark it here.
  function replySent(id) {
    const s = st(id);
    const t = now();
    s.lastActivityAt = t;
    s.lastMainActivityAt = t;
    s.stoppedAt = null;
    s.activity = 'thinking';
  }

  // A permission denied from the HUD may get no Post event (R8a): its step closes as "Denied" now, so
  // it doesn't stay open all turn and trip "Stuck? long". A helper's tool has no main-thread step.
  function permissionDenied(item) {
    const p = item?.payload || {};
    if ((p.agent_id ?? null) !== null) return;
    steps.closeDenied(item.sessionId, p.tool_name ?? null, now());
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
      // A ✕ hide ends for good when the chat asks something or wakes after it (v1.3).
      if (hidden.has(id) && (stage === 'needs' || (s.wakeAt != null && s.wakeAt > hidden.get(id)))) hidden.delete(id);
      const tuck = tuckOf({
        stage, status: sess.status, hiddenAt: hidden.get(id) ?? null, wakeAt: s.wakeAt ?? null,
        quietSince: quietSince({ lastActivityAt: s.lastActivityAt, stoppedAt: s.stoppedAt, statusSince: sess.statusSince, startedAt: sess.startedAt }),
      }, t);
      return {
        id, display: displayName(sess), cls: engine.classOf(id, t),
        mood: stage === 'thinking' || stage === 'working' ? 'working' : baseMood,
        activity: s.activity, familiars: Math.min(engine.activeSubagents(id), 3),
        replyOptIn: !!optIn.get(id), entrypoint: sess.entrypoint, source: sess.source ?? 'claude', cwd: sess.cwd, handedBack, canOpen: openable(sess),
        stage, stuck, stageSince: rec.since,
        currentStepStartedAt: currentOf(view, sess.status)?.startedAt ?? null,
        lastActivityAt: s.lastActivityAt,
        tuck,
      };
    });
    return agents;
  }

  // ✕ on a row: off the HUD until the chat asks something or starts a new turn. Not while it asks.
  function hide(id) {
    const a = computeAgents(now()).find((x) => x.id === id);
    if (!a || a.stage === 'needs') return;
    hidden.set(id, now());
  }

  function activeCard(t) {
    const a = queue.active();
    return a ? {
      id: a.id, kind: a.kind, sessionId: a.sessionId, display: displayOf(a.sessionId), cls: engine.classOf(a.sessionId, t), payload: a.payload,
      expiresAt: Number.isFinite(a.addedAt) ? a.addedAt + (a.kind === 'reply' ? replyMs : holdMs) : null,
      canOpen: openable(sessions.find((x) => x.sessionId === a.sessionId)),
    } : null;
  }

  function snapshot() {
    const t = now();
    const items = queue.list();
    const all = computeAgents(t);
    const agents = all.filter((x) => !x.tuck);
    const tucked = all.filter((x) => x.tuck);
    const card = activeCard(t);
    const second = items[1];
    const next = second ? `Next: ${displayOf(second.sessionId)} ${ASKS[second.kind] ?? 'asks a question'}` : null;
    return { agents, tucked, card, next, counts: { total: agents.length, needs: agents.filter((x) => x.mood === 'needs').length } };
  }

  function detail(id) {
    const sess = sessions.find((x) => x.sessionId === id);
    if (!sess) return null;
    const t = now();
    const a = computeAgents(t).find((x) => x.id === id);
    const card = activeCard(t);
    const view = steps.view(id);
    return {
      id, source: sess.source ?? 'claude', display: a.display, cls: a.cls, stage: a.stage, stuck: a.stuck,
      stageSince: a.stageSince, currentStepStartedAt: a.currentStepStartedAt, lastActivityAt: a.lastActivityAt,
      task: view.task ?? null, startedAt: view.taskAt ?? knownTime(sess.startedAt),
      connected: !!state.get(id)?.connected,
      stepCount: view.stepCount, current: currentOf(view, sess.status), steps: view.steps, helpers: view.helpers,
      // Where a "needs you" is waiting, for the panel's line (M3): a card in the panel, or its own window.
      handedBack: a.handedBack, hasCard: queue.list().some((it) => it.sessionId === id), canOpen: a.canOpen,
      lastMessage: a.stage === 'turn' ? (view.lastMessage ?? null) : null,
      card: card && card.sessionId === id ? card : null,
    };
  }

  function stageKey() {
    return computeAgents(now()).map((a) => `${a.id}:${a.stage}:${a.stuck ? a.stuck.reason : ''}${a.tuck ? `:${a.tuck}` : ''}`).join('|');
  }

  return { onEvent, setSessions, setReplyOptIn, wantsReply, replySent, permissionDenied, hide, snapshot, detail, stageKey };
}
