import test from 'node:test'; import assert from 'node:assert/strict';
import { createHookServer } from '../src/main/hook-server.js';
import { createQueue } from '../src/main/queue.js';
import { RELEASE, permissionAllow } from '../src/main/answers.js';

const SECRET = 's3cret';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 2000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return; await sleep(5); }
  assert.fail('waitFor timed out');
}

async function setup(opts = {}) {
  const queue = createQueue({ holdMs: 5000, replyMs: 5000 });
  const events = [];
  const errors = [];
  const srv = createHookServer({
    port: 0, secret: SECRET, queue,
    isInteractive: opts.isInteractive ?? (() => true),
    replyOptIn: opts.replyOptIn ?? (() => false),
    shouldHold: opts.shouldHold,
    onEvent: opts.onEvent ?? ((e) => events.push(e)),
    onError: (e) => errors.push(e),
  });
  const port = await srv.listen();
  const url = `http://127.0.0.1:${port}/agent-hud/hook`;
  const post = (body, { headers = { 'X-Agent-HUD': SECRET }, signal, raw } = {}) =>
    fetch(url, { method: 'POST', headers, body: raw ?? JSON.stringify(body), signal });
  let maxHeld = 0; // the most items the queue ever held at once
  queue.onChange(() => { maxHeld = Math.max(maxHeld, queue.list().length); });
  return { queue, events, errors, srv, port, url, post, maxHeld: () => maxHeld };
}
const ev = (name, extra = {}) => ({ session_id: 's1', hook_event_name: name, cwd: 'C:/x', transcript_path: 't', prompt_id: 'p', ...extra });

test('403 without secret header', async () => {
  const h = await setup();
  try {
    const r = await h.post(ev('PreToolUse'), { headers: {} });
    assert.equal(r.status, 403);
    const r2 = await h.post(ev('PreToolUse'), { headers: { 'X-Agent-HUD': 'nope' } });
    assert.equal(r2.status, 403);
    assert.equal(h.events.length, 0);
  } finally { await h.srv.close(); }
});

test('404 for wrong method or path', async () => {
  const h = await setup();
  try {
    const r = await fetch(h.url, { method: 'GET', headers: { 'X-Agent-HUD': SECRET } });
    assert.equal(r.status, 404);
    const r2 = await fetch(`http://127.0.0.1:${h.port}/other`, { method: 'POST', headers: { 'X-Agent-HUD': SECRET }, body: '{}' });
    assert.equal(r2.status, 404);
  } finally { await h.srv.close(); }
});

test('PreToolUse Read -> 200 empty, onEvent called with normalized fields', async () => {
  const h = await setup();
  try {
    const body = ev('PreToolUse', { tool_name: 'Read', tool_input: { file_path: 'a' } });
    const r = await h.post(body);
    assert.equal(r.status, 200);
    assert.equal(await r.text(), '');
    assert.equal(h.events.length, 1);
    const e = h.events[0];
    assert.equal(e.sessionId, 's1'); assert.equal(e.event, 'PreToolUse');
    assert.equal(e.toolName, 'Read'); assert.deepEqual(e.toolInput, { file_path: 'a' });
    assert.equal(e.cwd, 'C:/x'); assert.equal(typeof e.at, 'number'); assert.deepEqual(e.raw, body);
  } finally { await h.srv.close(); }
});

test('PermissionRequest is held until queue.answer, then returns the allow JSON', async () => {
  const h = await setup();
  try {
    const body = ev('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'ls' } });
    const p = h.post(body);
    await waitFor(() => h.queue.list().length === 1);
    const item = h.queue.list()[0];
    assert.equal(item.kind, 'permission'); assert.equal(item.sessionId, 's1'); assert.deepEqual(item.payload, body);
    h.queue.answer(item.id, permissionAllow());
    const r = await p;
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /application\/json/);
    assert.deepEqual(await r.json(), permissionAllow());
  } finally { await h.srv.close(); }
});

test('PermissionRequest from a non-interactive session returns 200 empty immediately', async () => {
  const h = await setup({ isInteractive: () => false });
  try {
    const r = await h.post(ev('PermissionRequest', { tool_name: 'Bash' }));
    assert.equal(r.status, 200); assert.equal(await r.text(), '');
    assert.equal(h.queue.list().length, 0);
  } finally { await h.srv.close(); }
});

test("AskUserQuestion PreToolUse is queued as kind 'choice'", async () => {
  const h = await setup();
  try {
    const p = h.post(ev('PreToolUse', { tool_name: 'AskUserQuestion', tool_input: { questions: [] } }));
    await waitFor(() => h.queue.list().length === 1);
    assert.equal(h.queue.list()[0].kind, 'choice');
    h.queue.answer(h.queue.list()[0].id, RELEASE);
    assert.equal((await p).status, 200);
  } finally { await h.srv.close(); }
});

test('I4: PermissionRequest for AskUserQuestion is answered at once and never queued (the PreToolUse is the choice card)', async () => {
  const h = await setup();
  try {
    const r = await h.post(ev('PermissionRequest', { tool_name: 'AskUserQuestion', tool_input: { questions: [] } }));
    assert.equal(r.status, 200); assert.equal(await r.text(), '');
    assert.equal(h.maxHeld(), 0, 'never queued');
    assert.equal(h.events.at(-1).event, 'PermissionRequest');
  } finally { await h.srv.close(); }
});

test('I5: when shouldHold() is false every blocking event is answered at once with an empty 200', async () => {
  let hold = false;
  const h = await setup({ shouldHold: () => hold, replyOptIn: () => true });
  try {
    for (const body of [ev('PermissionRequest', { tool_name: 'Bash' }), ev('PreToolUse', { tool_name: 'AskUserQuestion', tool_input: { questions: [] } }), ev('Stop')]) {
      const r = await h.post(body);
      assert.equal(r.status, 200); assert.equal(await r.text(), '');
    }
    assert.equal(h.maxHeld(), 0, 'never queued');
    assert.equal(h.events.length, 3, 'events still reach the store');
    hold = true;
    const p = h.post(ev('PermissionRequest', { tool_name: 'Bash' }));
    await waitFor(() => h.queue.list().length === 1);
    h.queue.releaseAll(); await p;
  } finally { await h.srv.close(); }
});

test('I5: a throwing shouldHold() counts as false and is reported', async () => {
  const h = await setup({ shouldHold: () => { throw new Error('window gone'); } });
  try {
    const r = await h.post(ev('PermissionRequest', { tool_name: 'Bash' }));
    assert.equal(r.status, 200); assert.equal(await r.text(), '');
    assert.equal(h.maxHeld(), 0, 'never queued');
    assert.equal(h.errors.length, 1);
  } finally { await h.srv.close(); }
});

test('Stop is queued only when replyOptIn is true', async () => {
  let opt = false;
  const h = await setup({ replyOptIn: () => opt });
  try {
    const r = await h.post(ev('Stop'));
    assert.equal(r.status, 200); assert.equal(h.queue.list().length, 0);
    opt = true;
    const p = h.post(ev('Stop'));
    await waitFor(() => h.queue.list().length === 1);
    assert.equal(h.queue.list()[0].kind, 'reply');
    h.queue.answer(h.queue.list()[0].id, RELEASE);
    await p;
  } finally { await h.srv.close(); }
});

test('Stop with a running background task is not queued even with replyOptIn', async () => {
  const h = await setup({ replyOptIn: () => true });
  try {
    const r = await h.post(ev('Stop', { background_tasks: [{ id: 'a', type: 'subagent', status: 'running' }] }));
    assert.equal(r.status, 200); assert.equal(await r.text(), '');
    assert.equal(h.queue.list().length, 0);
    const p = h.post(ev('Stop', { background_tasks: [{ id: 'a', status: 'completed' }] }));
    await waitFor(() => h.queue.list().length === 1);
    h.queue.answer(h.queue.list()[0].id, RELEASE);
    await p;
  } finally { await h.srv.close(); }
});

test("UserPromptSubmit releases that session's pending reply with empty 200", async () => {
  const h = await setup({ replyOptIn: () => true });
  try {
    const p = h.post(ev('Stop'));
    await waitFor(() => h.queue.list().length === 1);
    const r2 = await h.post(ev('UserPromptSubmit', { prompt: 'hello' }));
    assert.equal(r2.status, 200);
    const r = await p;
    assert.equal(r.status, 200); assert.equal(await r.text(), '');
    assert.equal(h.queue.list().length, 0);
  } finally { await h.srv.close(); }
});

test('synthetic <task-notification> UserPromptSubmit does not release a pending reply', async () => {
  const h = await setup({ replyOptIn: () => true });
  try {
    const p = h.post(ev('Stop'));
    await waitFor(() => h.queue.list().length === 1);
    await h.post(ev('UserPromptSubmit', { prompt: '  <task-notification>done</task-notification>' }));
    assert.equal(h.queue.list().length, 1);
    assert.equal(h.events.at(-1).event, 'UserPromptSubmit');
    h.queue.releaseAll(); await p;
  } finally { await h.srv.close(); }
});

test('PostToolUse Bash releases a pending Bash permission of that session only', async () => {
  const h = await setup();
  try {
    const pBash = h.post(ev('PermissionRequest', { tool_name: 'Bash' }));
    const pEdit = h.post(ev('PermissionRequest', { tool_name: 'Edit' }));
    const pOther = h.post({ ...ev('PermissionRequest', { tool_name: 'Bash' }), session_id: 's2' });
    await waitFor(() => h.queue.list().length === 3);
    await h.post(ev('PostToolUse', { tool_name: 'Bash' }));
    const r = await pBash;
    assert.equal(r.status, 200); assert.equal(await r.text(), '');
    assert.equal(h.queue.list().length, 2);
    await h.post(ev('PostToolUseFailure', { tool_name: 'Edit' }));
    await pEdit;
    assert.equal(h.queue.list().length, 1);
    h.queue.releaseAll(); await pOther;
  } finally { await h.srv.close(); }
});

test("I3: a subagent's PostToolUse releases only its own permission, matched by agent_id and tool_input", async () => {
  const h = await setup();
  try {
    const input = { command: 'npm test' };
    const pMain = h.post(ev('PermissionRequest', { tool_name: 'Bash', tool_input: input }));
    const pSub = h.post(ev('PermissionRequest', { tool_name: 'Bash', tool_input: input, agent_id: 'a1', agent_type: 'Explore' }));
    await waitFor(() => h.queue.list().length === 2);
    await h.post(ev('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' }, agent_id: 'a1' }));
    await sleep(20);
    assert.equal(h.queue.list().length, 2, 'different tool_input releases nothing');
    await h.post(ev('PostToolUse', { tool_name: 'Bash', tool_input: input, agent_id: 'a1' }));
    assert.equal(await (await pSub).text(), '');
    assert.deepEqual(h.queue.list().map((i) => i.payload.agent_id ?? null), [null], "the main thread's permission is still held");
    await h.post(ev('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test', extra: 1 } }));
    await sleep(20);
    assert.equal(h.queue.list().length, 1);
    await h.post(ev('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test' } }));
    assert.equal(await (await pMain).text(), '');
    assert.equal(h.queue.list().length, 0);
  } finally { await h.srv.close(); }
});

test('client abort while held -> item no longer in queue.list()', async () => {
  const h = await setup();
  try {
    const ac = new AbortController();
    const p = h.post(ev('PermissionRequest', { tool_name: 'Bash' }), { signal: ac.signal }).catch(() => 'aborted');
    await waitFor(() => h.queue.list().length === 1);
    ac.abort();
    assert.equal(await p, 'aborted');
    await waitFor(() => h.queue.list().length === 0);
  } finally { await h.srv.close(); }
});

test('close() resolves pending requests with empty 200', async () => {
  const h = await setup();
  const p = h.post(ev('PermissionRequest', { tool_name: 'Bash' }));
  await waitFor(() => h.queue.list().length === 1);
  await h.srv.close();
  const r = await p;
  assert.equal(r.status, 200); assert.equal(await r.text(), '');
});

test('invalid JSON -> 200 empty, no crash; 2 MB body -> 413', async () => {
  const h = await setup();
  try {
    const r = await h.post(null, { raw: '{not json' });
    assert.equal(r.status, 200); assert.equal(await r.text(), '');
    const r1 = await h.post({ session_id: 's1' });
    assert.equal(r1.status, 200);
    assert.equal(h.events.length, 0);
    const big = await h.post(null, { raw: JSON.stringify({ session_id: 's1', hook_event_name: 'X', pad: 'x'.repeat(2 * 1024 * 1024) }) });
    assert.equal(big.status, 413);
    const r3 = await h.post(ev('PreToolUse', { tool_name: 'Read' }));
    assert.equal(r3.status, 200);
  } finally { await h.srv.close(); }
});

test('I9a: a server error emitted after listen() is reported, not thrown, and the server keeps serving', async () => {
  const h = await setup();
  try {
    assert.doesNotThrow(() => h.srv.httpServer.emit('error', new Error('socket trouble')));
    assert.equal(h.errors.length, 1);
    assert.equal(h.errors[0].message, 'socket trouble');
    const r = await h.post(ev('PreToolUse', { tool_name: 'Read' }));
    assert.equal(r.status, 200);
  } finally { await h.srv.close(); }
});

test('onEvent errors do not break the request', async () => {
  const h = await setup({ onEvent: () => { throw new Error('boom'); } });
  try {
    const r = await h.post(ev('PreToolUse', { tool_name: 'Read' }));
    assert.equal(r.status, 200);
    assert.equal(h.errors.length, 1);
  } finally { await h.srv.close(); }
});

test('streamed oversize body without content-length -> 413', async () => {
  const h = await setup();
  try {
    const chunk = new Uint8Array(64 * 1024).fill(120);
    let n = 0;
    const body = new ReadableStream({ pull(c) { if (n++ < 48) c.enqueue(chunk); else c.close(); } });
    const r = await fetch(h.url, { method: 'POST', headers: { 'X-Agent-HUD': SECRET }, body, duplex: 'half' });
    assert.equal(r.status, 413);
  } finally { await h.srv.close(); }
});

test('held request is answered with empty 200 when queue.add rejects', async () => {
  const h = await setup();
  h.queue.add = () => Promise.reject(new Error('queue broke'));
  try {
    const r = await h.post(ev('PermissionRequest', { tool_name: 'Bash' }));
    assert.equal(r.status, 200); assert.equal(await r.text(), '');
    assert.equal(h.errors.length, 1);
  } finally { await h.srv.close(); }
});

test('unserializable answer -> empty 200, no unhandled rejection', async () => {
  const h = await setup();
  let unhandled = 0;
  const onU = () => { unhandled++; };
  process.on('unhandledRejection', onU);
  try {
    const p = h.post(ev('PermissionRequest', { tool_name: 'Bash' }));
    await waitFor(() => h.queue.list().length === 1);
    h.queue.answer(h.queue.list()[0].id, { n: 10n });
    const r = await p;
    assert.equal(r.status, 200); assert.equal(await r.text(), '');
    await sleep(20);
    assert.equal(unhandled, 0);
  } finally { process.off('unhandledRejection', onU); await h.srv.close(); }
});

// Holds a main-thread permission, a main-thread choice, a subagent permission (same session) and an
// other-session permission; returns their pending responses.
async function holdFour(h) {
  const main = h.post(ev('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'ls' } }));
  const choice = h.post(ev('PreToolUse', { tool_name: 'AskUserQuestion', tool_input: { questions: [] } }));
  const sub = h.post(ev('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'ls' }, agent_id: 'a1', agent_type: 'Explore' }));
  const other = h.post({ ...ev('PermissionRequest', { tool_name: 'Bash' }), session_id: 's2' });
  await waitFor(() => h.queue.list().length === 4);
  return { main, choice, sub, other };
}

test("I2c: Stop with no running background task releases that session's main-thread permission and choice", async () => {
  const h = await setup();
  try {
    const p = await holdFour(h);
    await h.post(ev('Stop', { background_tasks: [{ id: 'a1', type: 'subagent', status: 'completed' }] }));
    for (const r of [await p.main, await p.choice]) { assert.equal(r.status, 200); assert.equal(await r.text(), ''); }
    assert.deepEqual(h.queue.list().map((i) => [i.sessionId, i.payload.agent_id ?? null]), [['s1', 'a1'], ['s2', null]]);
    assert.deepEqual(h.queue.handedBack(), [], 'a release, not a hand-back');
    h.queue.releaseAll(); await p.sub; await p.other;
  } finally { await h.srv.close(); }
});

test('I2c: Stop with a running background task releases nothing', async () => {
  const h = await setup();
  try {
    const p = await holdFour(h);
    await h.post(ev('Stop', { background_tasks: [{ id: 'a1', type: 'subagent', status: 'running' }] }));
    await sleep(20);
    assert.equal(h.queue.list().length, 4);
    h.queue.releaseAll(); await Promise.all(Object.values(p));
  } finally { await h.srv.close(); }
});

test("I2c: a real UserPromptSubmit releases that session's main-thread permission and choice; a synthetic one does not", async () => {
  const h = await setup();
  try {
    const p = await holdFour(h);
    await h.post(ev('UserPromptSubmit', { prompt: '<task-notification>x</task-notification>' }));
    await sleep(20);
    assert.equal(h.queue.list().length, 4);
    await h.post(ev('UserPromptSubmit', { prompt: 'never mind, do this instead' }));
    for (const r of [await p.main, await p.choice]) { assert.equal(r.status, 200); assert.equal(await r.text(), ''); }
    assert.deepEqual(h.queue.list().map((i) => [i.sessionId, i.payload.agent_id ?? null]), [['s1', 'a1'], ['s2', null]]);
    assert.deepEqual(h.queue.handedBack(), []);
    h.queue.releaseAll(); await p.sub; await p.other;
  } finally { await h.srv.close(); }
});

const CODEX = { 'X-Agent-HUD': SECRET, 'X-Agent-HUD-Source': 'codex' };

test('v2: a codex PermissionRequest for a session the HUD never saw is held as a permission card with source codex (Review Focus 2)', async () => {
  const h = await setup({ isInteractive: () => false });
  try {
    const body = ev('PermissionRequest', { session_id: 'cx-unseen', tool_name: 'apply_patch', tool_input: { command: 'x' } });
    const p = h.post(body, { headers: CODEX });
    await waitFor(() => h.queue.list().length === 1);
    const item = h.queue.list()[0];
    assert.equal(item.kind, 'permission'); assert.equal(item.source, 'codex');
    assert.equal(item.sessionId, 'cx-unseen'); assert.deepEqual(item.payload, body);
    h.queue.answer(item.id, RELEASE);
    assert.equal((await p).status, 200);
    // the same event from Claude on a non-interactive session stays unheld
    const r = await h.post(body);
    assert.equal(await r.text(), ''); assert.equal(h.queue.list().length, 0);
  } finally { await h.srv.close(); }
});

test('v2: a codex PermissionRequest is not held when the server cannot hold', async () => {
  const h = await setup({ shouldHold: () => false });
  try {
    const r = await h.post(ev('PermissionRequest', { tool_name: 'Bash' }), { headers: CODEX });
    assert.equal(r.status, 200); assert.equal(await r.text(), '');
    assert.equal(h.queue.list().length, 0);
  } finally { await h.srv.close(); }
});

test('v2: codex AskUserQuestion and codex Stop with reply opt-in are not held', async () => {
  const h = await setup({ replyOptIn: () => true });
  try {
    for (const body of [
      ev('PreToolUse', { tool_name: 'AskUserQuestion', tool_input: { questions: [] } }),
      ev('Stop'),
    ]) {
      const r = await h.post(body, { headers: CODEX });
      assert.equal(r.status, 200); assert.equal(await r.text(), '');
    }
    assert.equal(h.maxHeld(), 0, 'never queued');
  } finally { await h.srv.close(); }
});

test('v2: onEvent receives source codex / claude by header', async () => {
  const h = await setup();
  try {
    await h.post(ev('PreToolUse', { tool_name: 'Read' }), { headers: CODEX });
    await h.post(ev('PreToolUse', { tool_name: 'Read' }), { headers: { 'X-Agent-HUD': SECRET, 'X-Agent-HUD-Source': ' CODEX ' } });
    await h.post(ev('PreToolUse', { tool_name: 'Read' }));
    await h.post(ev('PreToolUse', { tool_name: 'Read' }), { headers: { 'X-Agent-HUD': SECRET, 'X-Agent-HUD-Source': 'other' } });
    assert.deepEqual(h.events.map((e) => e.source), ['codex', 'codex', 'claude', 'claude']);
    assert.equal(h.events[0].raw.source, undefined, 'payload not mutated');
  } finally { await h.srv.close(); }
});

test('v2: a codex PostToolUse releases a held codex permission (source-agnostic)', async () => {
  const h = await setup();
  try {
    const input = { command: 'ls' };
    const p = h.post(ev('PermissionRequest', { tool_name: 'Bash', tool_input: input }), { headers: CODEX });
    await waitFor(() => h.queue.list().length === 1);
    await h.post(ev('PostToolUse', { tool_name: 'Bash', tool_input: input }), { headers: CODEX });
    assert.equal((await p).status, 200);
    assert.equal(h.queue.list().length, 0);
  } finally { await h.srv.close(); }
});

for (const planEvent of ['PreToolUse', 'PermissionRequest']) {
  const other = planEvent === 'PreToolUse' ? 'PermissionRequest' : 'PreToolUse';
  const mkPlan = async (opts = {}) => {
    const h = await setup(opts); // rebuild with planEvent
    await h.srv.close();
    const queue = h.queue;
    const srv = createHookServer({ port: 0, secret: SECRET, queue, planEvent, isInteractive: opts.isInteractive ?? (() => true), replyOptIn: () => false, onError: () => {} });
    const port = await srv.listen();
    const post = (body, headers = { 'X-Agent-HUD': SECRET }) => fetch(`http://127.0.0.1:${port}/agent-hud/hook`, { method: 'POST', headers, body: JSON.stringify(body) });
    return { queue, srv, post, maxHeld: h.maxHeld };
  };
  const plan = (name, extra = {}) => ev(name, { tool_name: 'ExitPlanMode', tool_input: { plan: 'p' }, ...extra });

  test(`plan[${planEvent}]: ExitPlanMode on ${planEvent} from an interactive claude session is held as a plan card`, async () => {
    const h = await mkPlan();
    try {
      const p = h.post(plan(planEvent));
      await waitFor(() => h.queue.list().length === 1);
      const it = h.queue.list()[0];
      assert.equal(it.kind, 'plan'); assert.equal(it.payload.tool_name, 'ExitPlanMode');
      h.queue.releaseAll(); await p;
    } finally { await h.srv.close(); }
  });

  test(`plan[${planEvent}]: non-interactive session and codex get an empty 200, nothing held`, async () => {
    const h = await mkPlan({ isInteractive: () => false });
    const h2 = await mkPlan();
    try {
      const r = await h.post(plan(planEvent));
      assert.equal(r.status, 200); assert.equal(await r.text(), ''); assert.equal(h.queue.list().length, 0);
      assert.equal(h.maxHeld(), 0);
      for (const name of ['PermissionRequest', 'PreToolUse']) {
        const r2 = await h2.post(plan(name), { 'X-Agent-HUD': SECRET, 'X-Agent-HUD-Source': 'codex' });
        assert.equal(r2.status, 200); assert.equal(await r2.text(), '');
      }
      assert.equal(h2.maxHeld(), 0, 'codex ExitPlanMode is never held as any kind');
    } finally { await h.srv.close(); await h2.srv.close(); }
  });

  test(`plan[${planEvent}]: a subagent's ExitPlanMode (agent_id set) is never held, on either event`, async () => {
    const h = await mkPlan();
    try {
      for (const name of ['PermissionRequest', 'PreToolUse']) {
        const r = await h.post(plan(name, { agent_id: 'sub' }));
        assert.equal(r.status, 200); assert.equal(await r.text(), '');
      }
      assert.equal(h.maxHeld(), 0);
    } finally { await h.srv.close(); }
  });

  test(`plan[${planEvent}]: ${other} for ExitPlanMode is never held (not as plan, not as permission)`, async () => {
    const h = await mkPlan();
    try {
      const r = await h.post(plan(other));
      assert.equal(r.status, 200); assert.equal(await r.text(), '');
      assert.equal(h.queue.list().length, 0);
    } finally { await h.srv.close(); }
  });

  test(`plan[${planEvent}]: main-thread PostToolUse, a real prompt, and a Stop each release a held plan; subagent PostToolUse does not`, async () => {
    const h = await mkPlan();
    try {
      const held = async (release, expectGone = true) => {
        const p = h.post(plan(planEvent));
        await waitFor(() => h.queue.list().length === 1);
        await release();
        if (expectGone) { const r = await p; assert.equal(await r.text(), ''); assert.equal(h.queue.list().length, 0); }
        else { await sleep(50); assert.equal(h.queue.list().length, 1); h.queue.releaseAll(); await p; }
      };
      await held(() => h.post(ev('PostToolUse', { tool_name: 'ExitPlanMode', tool_input: { plan: 'edited' } })));
      await held(() => h.post(ev('PostToolUse', { tool_name: 'ExitPlanMode', agent_id: 'sub' })), false);
      await held(() => h.post(ev('UserPromptSubmit', { prompt: 'go' })));
      await held(() => h.post(ev('Stop', { background_tasks: [] })));
    } finally { await h.srv.close(); }
  });
}
