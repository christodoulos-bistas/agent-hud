import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSideLog, validSessionId } from '../src/main/side-log.js';

const SID = 'af479eec-aaaa';

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'side-log-'));
}

test('add/list round-trip, JSON Lines on disk, cache survives a new instance', () => {
  const dir = tmp();
  let t = 100;
  const log = createSideLog({ dir, now: () => t++ });
  const a = log.add(SID, { source: 'hud', question: 'q1', response: 'r1' });
  const b = log.add(SID, { source: 'hud', question: 'q2', response: null, error: 'boom' });
  assert.ok(a && b);
  assert.deepEqual(log.list(SID).map((e) => e.question), ['q1', 'q2']);
  assert.equal(log.count(SID), 2);
  const again = createSideLog({ dir });
  assert.deepEqual(again.list(SID).map((e) => e.question), ['q1', 'q2']);
  assert.equal(again.list(SID)[1].error, 'boom');
  const lines = fs.readFileSync(path.join(dir, SID + '.jsonl'), 'utf8').split('\n').filter(Boolean);
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).question, 'q1');
});

test('list returns copies: mutating them does not corrupt the cache', () => {
  const log = createSideLog({ dir: tmp() });
  log.add(SID, { source: 'hud', question: 'q', response: 'r' });
  const first = log.list(SID);
  first[0].question = 'tampered';
  first.push({ id: 'x' });
  assert.equal(log.list(SID).length, 1);
  assert.equal(log.list(SID)[0].question, 'q');
});

test('importVscode dedupes by content hash and reports changed sessions', () => {
  const dir = tmp();
  const log = createSideLog({ dir, now: () => 50 });
  const it = { sessionId: SID, question: 'q', response: 'r', updatedAt: 40 };
  assert.deepEqual(log.importVscode([it]), [SID]);
  assert.deepEqual(log.importVscode([it]), []);
  const [e] = log.list(SID);
  assert.equal(e.source, 'vscode');
  assert.equal(e.at, 40);
  assert.match(e.id, /^v[0-9a-f]{16}$/);
});

test('importVscode: last item of a thread batch uses updatedAt, the rest now()', () => {
  const log = createSideLog({ dir: tmp(), now: () => 50 });
  log.importVscode([
    { sessionId: SID, question: 'a', response: 'ra', updatedAt: 40 },
    { sessionId: SID, question: 'b', response: 'rb', updatedAt: 40 },
    { sessionId: 'bbbbbbbb-1111', question: 'c', response: 'rc', updatedAt: 'nope' },
  ]);
  assert.deepEqual(log.list(SID).map((e) => e.at), [50, 40]);
  assert.equal(log.list('bbbbbbbb-1111')[0].at, 50);
});

test('history: last 10 answered, oldest first, errors skipped', () => {
  const log = createSideLog({ dir: tmp() });
  for (let i = 1; i <= 12; i++) {
    log.add(SID, { source: 'hud', question: 'q' + i, response: 'r' + i });
    if (i === 6) log.add(SID, { source: 'hud', question: 'bad', response: null, error: 'x' });
  }
  const h = log.history(SID);
  assert.equal(h.length, 10);
  assert.deepEqual(h[0], { question: 'q3', response: 'r3' });
  assert.deepEqual(h[9], { question: 'q12', response: 'r12' });
  assert.ok(h.every((x) => x.question !== 'bad'));
  assert.equal(log.history(SID, 2).length, 2);
});

test('remove rewrites the file without the entry', () => {
  const dir = tmp();
  const log = createSideLog({ dir });
  const a = log.add(SID, { source: 'hud', question: 'a', response: 'ra' });
  const b = log.add(SID, { source: 'hud', question: 'b', response: 'rb' });
  assert.equal(log.remove(SID, a.id), true);
  assert.equal(log.remove(SID, 'nope'), false);
  const again = createSideLog({ dir });
  assert.deepEqual(again.list(SID).map((e) => e.id), [b.id]);
});

test('hostile or malformed session ids never touch the disk', () => {
  const dir = tmp();
  const log = createSideLog({ dir });
  for (const id of ['..\\..\\x', '', 'a/b', 'x'.repeat(65), 'short']) {
    assert.equal(log.add(id, { source: 'hud', question: 'q', response: 'r' }), null);
    assert.equal(log.validId(id), false);
    assert.equal(validSessionId(id), false);
  }
  assert.deepEqual(log.importVscode([{ sessionId: '..\\evil', question: 'q', response: 'r' }]), []);
  assert.deepEqual(fs.readdirSync(dir), []);
  assert.equal(log.validId(SID), true);
});

test('a corrupt line is skipped, the rest still listed', () => {
  const dir = tmp();
  const good = (id, q) => JSON.stringify({ id, at: 1, source: 'hud', question: q, response: 'r' });
  fs.writeFileSync(
    path.join(dir, SID + '.jsonl'),
    [good('h1', 'one'), '{not json', good('h2', 'two')].join('\n') + '\n'
  );
  const log = createSideLog({ dir });
  assert.deepEqual(log.list(SID).map((e) => e.question), ['one', 'two']);
});

test('remove throws on I/O failure and the cache keeps the entry', () => {
  const dir = tmp();
  const failing = { ...fs, renameSync() { throw new Error('EBUSY'); } };
  const log = createSideLog({ dir, fs: failing });
  const a = log.add(SID, { source: 'hud', question: 'a', response: 'ra' });
  assert.throws(() => log.remove(SID, a.id), /EBUSY/);
  assert.deepEqual(log.list(SID).map((e) => e.id), [a.id]);
  assert.deepEqual(createSideLog({ dir }).list(SID).map((e) => e.id), [a.id]);
  assert.deepEqual(fs.readdirSync(dir), [SID + '.jsonl']);
});

test('successful remove updates the cache and leaves no .tmp file', () => {
  const dir = tmp();
  const log = createSideLog({ dir });
  const a = log.add(SID, { source: 'hud', question: 'a', response: 'ra' });
  log.add(SID, { source: 'hud', question: 'b', response: 'rb' });
  assert.equal(log.remove(SID, a.id), true);
  assert.deepEqual(log.list(SID).map((e) => e.question), ['b']);
  assert.deepEqual(fs.readdirSync(dir), [SID + '.jsonl']);
});

test('a log deleted on disk while running is gone from list, and an add after it does not resurrect old entries', () => {
  const dir = tmp();
  const log = createSideLog({ dir });
  log.add(SID, { source: 'hud', question: 'old1', response: 'r' });
  log.add(SID, { source: 'hud', question: 'old2', response: 'r' });
  assert.equal(log.count(SID), 2);
  fs.unlinkSync(path.join(dir, SID + '.jsonl'));
  assert.deepEqual(log.list(SID), []);
  log.add(SID, { source: 'hud', question: 'new', response: 'r' });
  assert.deepEqual(log.list(SID).map((e) => e.question), ['new']);
  const lines = fs.readFileSync(path.join(dir, SID + '.jsonl'), 'utf8').split('\n').filter(Boolean);
  assert.deepEqual(lines.map((l) => JSON.parse(l).question), ['new']);
});

test('a delete straight before an add (no list in between) is honoured too', () => {
  const dir = tmp();
  const log = createSideLog({ dir });
  log.add(SID, { source: 'hud', question: 'old', response: 'r' });
  fs.unlinkSync(path.join(dir, SID + '.jsonl'));
  log.add(SID, { source: 'hud', question: 'new', response: 'r' });
  assert.deepEqual(log.list(SID).map((e) => e.question), ['new']);
  assert.deepEqual(createSideLog({ dir }).list(SID).map((e) => e.question), ['new']);
});

test('a log changed on disk (edited by hand) is read again', () => {
  const dir = tmp();
  const log = createSideLog({ dir });
  log.add(SID, { source: 'hud', question: 'a', response: 'r' });
  const file = path.join(dir, SID + '.jsonl');
  fs.writeFileSync(file, JSON.stringify({ id: 'hX', at: 1, source: 'hud', question: 'edited', response: 'r' }) + '\n');
  assert.deepEqual(log.list(SID).map((e) => e.question), ['edited']);
  assert.equal(log.count(SID), 1);
  assert.deepEqual(log.history(SID), [{ question: 'edited', response: 'r' }]);
});
