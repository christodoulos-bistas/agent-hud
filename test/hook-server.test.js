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
    onEvent: opts.onEvent ?? ((e) => events.push(e)),
    onError: (e) => errors.push(e),
  });
  const port = await srv.listen();
  const url = `http://127.0.0.1:${port}/agent-hud/hook`;
  const post = (body, { headers = { 'X-Agent-HUD': SECRET }, signal, raw } = {}) =>
    fetch(url, { method: 'POST', headers, body: raw ?? JSON.stringify(body), signal });
  return { queue, events, errors, srv, port, url, post };
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
