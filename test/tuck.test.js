import test from 'node:test'; import assert from 'node:assert/strict';
import { TUCK_AFTER_MS, quietSince, tuckOf } from '../src/main/tuck.js';

const H = 3_600_000, NOW = 10 * H;
const base = { stage: 'idle', status: 'idle', quietSince: NOW - H, hiddenAt: null, wakeAt: null };

test('TUCK_AFTER_MS is one hour', () => assert.equal(TUCK_AFTER_MS, H));

test('quietSince takes the latest known time and ignores missing ones', () => {
  assert.equal(quietSince({ lastActivityAt: 5, stoppedAt: 9, statusSince: 7, startedAt: 1 }), 9);
  assert.equal(quietSince({ lastActivityAt: null, stoppedAt: undefined, statusSince: 7, startedAt: null }), 7);
  assert.equal(quietSince({}), null);
});

test('idle or turn for a full hour tucks; a minute less does not', () => {
  assert.equal(tuckOf(base, NOW), 'idle');
  assert.equal(tuckOf({ ...base, stage: 'turn' }, NOW), 'idle');
  assert.equal(tuckOf({ ...base, quietSince: NOW - H + 60_000 }, NOW), null);
  assert.equal(tuckOf({ ...base, quietSince: null }, NOW), null);
});

test('working, thinking, needs and a busy session file never auto-tuck', () => {
  for (const stage of ['working', 'thinking', 'needs']) assert.equal(tuckOf({ ...base, stage }, NOW), null);
  assert.equal(tuckOf({ ...base, status: 'busy' }, NOW), null);
});

test('a ✕ hide holds until a wake after it; needs always wins', () => {
  assert.equal(tuckOf({ ...base, stage: 'working', quietSince: NOW, hiddenAt: NOW - 5 }, NOW), 'hidden');
  assert.equal(tuckOf({ ...base, stage: 'working', hiddenAt: NOW - 5, wakeAt: NOW - 9 }, NOW), 'hidden', 'a wake before the hide');
  assert.equal(tuckOf({ ...base, stage: 'working', quietSince: NOW, hiddenAt: NOW - 5, wakeAt: NOW - 1 }, NOW), null);
  assert.equal(tuckOf({ ...base, stage: 'needs', hiddenAt: NOW - 5 }, NOW), null);
});
