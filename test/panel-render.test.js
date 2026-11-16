import test from 'node:test'; import assert from 'node:assert/strict';
import { renderPanel, timeText } from '../src/renderer/panel.js';

const NOW = 1_000_000_000;
const XSS = '<img src=x onerror=alert(1)>';
const step = (o = {}) => ({
  id: 'x', tool: 'Bash', label: 'npm test', doing: 'running npm test', why: 'Run the tests',
  startedAt: NOW - 20000, endedAt: NOW - 12000, ok: true, interrupted: false, error: null, agentId: null, agentType: null, ...o,
});
const detail = (o = {}) => ({
  id: 's1', display: 'arsenal · e0', cls: 'runesmith', stage: 'working', stuck: null, task: 'Make the updater keep 3 builds',
  startedAt: NOW - 9 * 60000, stepCount: 23, current: step({ endedAt: null, ok: null, startedAt: NOW - 100000 }),
  steps: [
    step({ label: 'Edited updater.js', endedAt: NOW - 12000 }),
    step({ label: 'npm test', ok: false, error: 'exit 1', endedAt: NOW - 60000 }),
    step({ label: 'Read a.js', interrupted: true, ok: null, endedAt: NOW - 120000 }),
    step({ label: 'Read b.js', endedAt: NOW - 180000 }),
    step({ label: 'Searched code', endedAt: NOW - 240000 }),
  ],
  helpers: [{ agentId: 'h1', agentType: 'Explore', doing: 'reading 4 files' }],
  stageSince: NOW - 100000, currentStepStartedAt: NOW - 100000, lastActivityAt: NOW - 1000, ...o,
});

test('full detail renders task, Now with why, 5 steps with ✓/✗/– marks, helpers, footer with step count', () => {
  const h = renderPanel(detail(), NOW);
  assert.match(h, /Make the updater keep 3 builds/);
  assert.match(h, /Now:<\/b>[^]*running npm test/);
  assert.match(h, /Run the tests/);
  assert.match(h, /1m/);
  assert.equal((h.match(/<ol>[^]*<\/ol>/)[0].match(/<li>/g) || []).length, 5);
  assert.match(h, /✓/); assert.match(h, /✗/); assert.match(h, /–/);
  assert.match(h, /Explore/); assert.match(h, /reading 4 files/);
  assert.match(h, /started 9m ago · 23 steps/);
  assert.match(h, /data-act="close"/); assert.match(h, /data-act="open"/);
});

test('stuck renders the amber reason line', () => {
  const h = renderPanel(detail({ stuck: { reason: 'repeating', detail: 'the same command failed 3 times in a row.' } }), NOW);
  assert.match(h, /class="warn"><b>Repeating:<\/b> the same command failed 3 times/);
  const l = renderPanel(detail({ stuck: { reason: 'long', detail: 'frozen' } }), NOW);
  assert.match(l, /<b>Long step:<\/b> npm test has been running for 1 min/);
  assert.doesNotMatch(l, /frozen/);
  assert.match(renderPanel(detail({ stuck: { reason: 'silent', detail: 'quiet' } }), NOW), /<b>Silent:<\/b> quiet/);
});

test('no current step and newest closed step failed → "Last:" with the error text', () => {
  const h = renderPanel(detail({ current: null, steps: [step({ label: 'npm run build', ok: false, error: 'TS2345 bad', endedAt: NOW - 5000 })] }), NOW);
  assert.match(h, /Last:<\/b>[^]*npm run build/);
  assert.match(h, /TS2345 bad/);
  assert.doesNotMatch(h, /Now:/);
});

test('task null → "Started before the HUD" (Review Focus 1)', () => {
  assert.match(renderPanel(detail({ task: null }), NOW), /Started before the HUD/);
});

test('needs → "Waiting for your answer in the HUD"', () => {
  assert.match(renderPanel(detail({ stage: 'needs' }), NOW), /Waiting for your answer in the HUD/);
  assert.doesNotMatch(renderPanel(detail(), NOW), /Waiting for your answer/);
});

test('HTML in task, command label and error is escaped (Review Focus 5)', () => {
  const h = renderPanel(detail({
    task: XSS, display: XSS, helpers: [{ agentId: 'h', agentType: XSS, doing: XSS }],
    current: step({ label: XSS, doing: XSS, why: XSS, endedAt: null, ok: null }),
    steps: [step({ label: XSS, ok: false, error: XSS })],
    stuck: { reason: 'repeating', detail: XSS },
  }), NOW);
  assert.doesNotMatch(h, /<img/);
  assert.match(h, /&lt;img/);
});

test('time texts carry their start (data-since) so the 1 s tick can refresh them; timeText formats them (R5a)', () => {
  const h = renderPanel(detail(), NOW);
  assert.match(h, new RegExp(`<span class="el" data-since="${NOW - 100000}">1m</span>`));
  assert.match(h, new RegExp(`<span class="ago" data-since="${NOW - 12000}">12s</span>`));
  assert.match(h, new RegExp(`<span data-since="${NOW - 9 * 60000}" data-pre="started " data-post=" ago · 23 steps">started 9m ago · 23 steps</span>`));
  assert.match(renderPanel(detail({ current: null, steps: [step({ ok: false, endedAt: NOW - 5000 })] }), NOW), new RegExp(`<span class="el" data-since="${NOW - 5000}">5s</span>`));
  assert.doesNotMatch(renderPanel(detail({ startedAt: null }), NOW), /data-pre="started "/, 'no start, nothing to tick');
  // what the tick reads back from the DOM: strings
  assert.equal(timeText({ since: String(NOW - 100000) }, NOW + 60000), '2m');
  assert.equal(timeText({ since: String(NOW - 9 * 60000), pre: 'started ', post: ' ago · 23 steps' }, NOW + 60000), 'started 10m ago · 23 steps');
  assert.equal(timeText({ since: 'nope' }, NOW), '');
});

test('the header shows the class display name, not the raw class id (R5b)', () => {
  assert.match(renderPanel(detail({ cls: 'star-reader' }), NOW), /<span class="cls">Star-Reader<\/span>/);
  assert.match(renderPanel(detail({ cls: 'no-such-class' }), NOW), /<span class="cls">Pathfinder<\/span>/);
});

test('importing panel.js in Node does not throw', async () => {
  await assert.doesNotReject(import('../src/renderer/panel.js?again'));
});
