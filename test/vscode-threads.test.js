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
    openDb: async () => ['{"x":"sideQuestionThreads"}'] });
  assert.equal((await reader.pass()).healthy, false);
});
test('reader: a db with no matching rows is healthy; listDbs throwing is unhealthy, never rejects', async () => {
  const r1 = createVscodeReader({ root: 'r', listDbs: () => ['a'], statMtime: () => 1, openDb: async () => [] });
  assert.deepEqual(await r1.pass(), { items: [], healthy: true });
  const r2 = createVscodeReader({ root: 'r', listDbs: () => { throw new Error('x'); } });
  assert.deepEqual(await r2.pass(), { items: [], healthy: false });
});
test('reader: a shape-changed db stays unhealthy across skipped passes until it reads well', async () => {
  let m = 1; let rows = ['{"x":"sideQuestionThreads"}'];
  const reader = createVscodeReader({ root: 'r', listDbs: () => ['a'], statMtime: () => m, openDb: async () => rows });
  assert.equal((await reader.pass()).healthy, false);
  assert.equal((await reader.pass()).healthy, false);
  m = 2; rows = [editorPart(panelState(THREADS))];
  assert.equal((await reader.pass()).healthy, true);
});
