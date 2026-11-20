import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { extractThreads, createVscodeReader, VSCODE_STORAGE } from '../src/main/vscode-threads.js';

const panelState = (threads) => JSON.stringify({ isFullEditor: false, sessionID: 'af479eec-1111', sideQuestionThreads: threads });
const editorPart = (inner) => JSON.stringify({ editorpart: { state: { serializedGrid: { root: { data: [{ data: { editors: [{ value: JSON.stringify({ state: inner }) }] } }] } } } } });
const THREADS = { 'af479eec-1111 9ped11': { updatedAt: 1795169700000, entries: [
  { kind: 'answer', question: 'what file are we in?', response: 'You are in agent-hud.' },
  { kind: 'pending', question: 'x' }, { kind: 'answer', question: 7, response: 'bad' },
] } };

test('extractThreads: the Spike D shape, nested string-encoded state', () => {
  const r = extractThreads(editorPart(panelState(THREADS)));
  assert.equal(r.found, 1);
  assert.deepEqual(r.items, [{ sessionId: 'af479eec-1111', question: 'what file are we in?', response: 'You are in agent-hud.', updatedAt: 1795169700000 }]);
});
test('extractThreads: bad JSON and no threads', () => {
  assert.deepEqual(extractThreads('{nope'), { found: 0, items: [] });
  assert.deepEqual(extractThreads(editorPart(panelState({}))), { found: 1, items: [] });
});
test('VSCODE_STORAGE joins the workspaceStorage path', () => {
  assert.equal(VSCODE_STORAGE('X'), ['X', 'Code', 'User', 'workspaceStorage'].join(path.sep));
});
test('reader: mtime gate skips unchanged dbs', async () => {
  let m = 1; let opens = 0;
  const reader = createVscodeReader({ root: 'r', listDbs: () => ['a'], statMtime: () => m,
    openDb: async () => { opens++; return [editorPart(panelState(THREADS))]; } });
  await reader.pass(); await reader.pass();
  assert.equal(opens, 1);
  m = 2; await reader.pass();
  assert.equal(opens, 2);
});
test('reader: a locked db retries next pass and turns unhealthy only after 3 failures in a row', async () => {
  let fails = 0; const reader = createVscodeReader({ root: 'r', listDbs: () => ['a'], statMtime: () => 1,
    openDb: async () => { if (fails++ < 3) throw new Error('SQLITE_BUSY'); return [editorPart(panelState(THREADS))]; } });
  assert.equal((await reader.pass()).healthy, true);
  assert.equal((await reader.pass()).healthy, true);
  assert.equal((await reader.pass()).healthy, false);
  const ok = await reader.pass();
  assert.equal(ok.healthy, true); assert.equal(ok.items.length, 1);
});
test('reader: a matched row with no parsable threads is unhealthy (shape changed)', async () => {
  const reader = createVscodeReader({ root: 'r', listDbs: () => ['a'], statMtime: () => 1,
    openDb: async () => ['{"sideQuestionThreads":[]}'] });
  assert.equal((await reader.pass()).healthy, false);
});
test('reader: a db with no matching rows is healthy; listDbs throwing is unhealthy, never rejects', async () => {
  const r1 = createVscodeReader({ root: 'r', listDbs: () => ['a'], statMtime: () => 1, openDb: async () => [] });
  assert.deepEqual(await r1.pass(), { items: [], healthy: true });
  const r2 = createVscodeReader({ root: 'r', listDbs: () => { throw new Error('x'); } });
  assert.deepEqual(await r2.pass(), { items: [], healthy: false });
});
test('reader: a shape-changed db stays unhealthy across skipped passes until it reads well', async () => {
  let m = 1; let rows = ['{"sideQuestionThreads":[]}'];
  const reader = createVscodeReader({ root: 'r', listDbs: () => ['a'], statMtime: () => m, openDb: async () => rows });
  assert.equal((await reader.pass()).healthy, false);
  assert.equal((await reader.pass()).healthy, false);
  m = 2; rows = [editorPart(panelState(THREADS))];
  assert.equal((await reader.pass()).healthy, true);
});
test('reader: a row that only mentions sideQuestionThreads as text (search/find history) is ignored, healthy', async () => {
  const history = JSON.stringify({ entries: ['sideQuestionThreads', 'grep sideQuestionThreads src'] });
  const reader = createVscodeReader({ root: 'r', listDbs: () => ['a'], statMtime: () => 1, openDb: async () => [history, '{"x":"sideQuestionThreads"}'] });
  assert.deepEqual(await reader.pass(), { items: [], healthy: true });
});
test('reader: the name as a JSON key at any escape depth with no threads object is shape-broken', async () => {
  const nested = editorPart(JSON.stringify({ sideQuestionThreads: 'not an object' }));
  assert.match(nested, /sideQuestionThreads\\+"/, 'the key sits inside escaped JSON');
  const reader = createVscodeReader({ root: 'r', listDbs: () => ['a'], statMtime: () => 1, openDb: async () => [nested] });
  assert.equal((await reader.pass()).healthy, false);
});
test('reader: state of a db that is no longer listed is dropped (bad shape, failures, mtime)', async () => {
  let dbs = ['a', 'b']; let opens = 0;
  const reader = createVscodeReader({ root: 'r', listDbs: () => dbs, statMtime: () => 1, failLimit: 1,
    openDb: async (p) => { opens++; if (p === 'b') return ['{"sideQuestionThreads":[]}']; if (p === 'c') throw new Error('locked'); return []; } });
  assert.equal((await reader.pass()).healthy, false, 'b is shape-broken');
  dbs = ['a'];
  assert.equal((await reader.pass()).healthy, true, 'b went: its bad shape goes with it');
  dbs = ['a', 'c'];
  assert.equal((await reader.pass()).healthy, false, 'c failed (failLimit 1)');
  dbs = ['a'];
  assert.equal((await reader.pass()).healthy, true, 'c went: its failures go with it');
  const before = opens;
  dbs = ['a', 'b'];
  await reader.pass();
  assert.equal(opens, before + 1, 'b back with the same mtime is read again (its mtime was dropped)');
});
test('extractThreads: never descends into a threads object (an answer quoting JSON adds no phantom threads)', () => {
  const quoted = JSON.stringify({ sideQuestionThreads: { 'bf479eec-2222 x': { updatedAt: 1, entries: [{ kind: 'answer', question: 'phantom', response: 'p' }] } } });
  const threads = { 'af479eec-1111 9ped11': { updatedAt: 5, entries: [{ kind: 'answer', question: 'show me the state', response: quoted }] } };
  const r = extractThreads(editorPart(panelState(threads)));
  assert.equal(r.found, 1);
  assert.deepEqual(r.items.map((i) => i.question), ['show me the state']);
});
