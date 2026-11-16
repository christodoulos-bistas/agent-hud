import test from 'node:test'; import assert from 'node:assert/strict';
import { esc, newlyNeeding, renderChip, chipOf, rowCentreY, renderRow, renderCard, renderParty, picksFrom, replyLeftMs, actionsArmed, clickAllowed } from '../src/renderer/hud.js';
import { GR, CLASSES, MOODS_BADGE, MOODS_ZEE, spriteSvg } from '../src/renderer/sprites.js';
import { CLASS_IDS } from '../src/main/classes.js';

const XSS = '<img src=x onerror=alert(1)>';
const agent = (o = {}) => ({
  id: 's1', display: 'arsenal · e0', cls: 'runesmith', mood: 'working', activity: 'editing forge-room.ts',
  familiars: 0, replyOptIn: false, entrypoint: 'claude-vscode', cwd: 'c:\\p\\arsenal', handedBack: false, ...o,
});
const permission = (o = {}) => ({
  id: 'c1', kind: 'permission', display: 'arsenal · 8c', cls: 'hexbreaker',
  payload: {
    session_id: 's1', tool_name: 'Bash', tool_input: { command: 'npm test -- --run test/forge-room' },
    permission_suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test -- --run test/forge-room' }], behavior: 'allow', destination: 'localSettings' }],
    ...o,
  },
});
const QUESTIONS = [
  { question: 'Should the updater also delete old builds?', header: 'Updater', multiSelect: false,
    options: [{ label: 'Keep the last 3', description: 'Frees about 600 MB' }, { label: 'Leave them', description: 'Nothing is deleted' }] },
  { question: 'Which channels?', header: 'Channels', multiSelect: true,
    options: [{ label: 'Stable', description: '' }, { label: 'Beta', description: '' }, { label: 'Nightly', description: '' }] },
];
const choice = () => ({ id: 'c2', kind: 'choice', display: 'agent-hud', cls: 'star-reader',
  payload: { session_id: 's2', tool_name: 'AskUserQuestion', tool_input: { questions: QUESTIONS } } });
const reply = (msg) => ({ id: 'c3', kind: 'reply', display: 'questbound · 4f', cls: 'loremaster',
  payload: { session_id: 's3', last_assistant_message: msg } });
const count = (s, needle) => s.split(needle).length - 1;

test('esc escapes & < > " and \'', () => {
  assert.equal(esc(`a&b<c>d"e'f`), 'a&amp;b&lt;c&gt;d&quot;e&#39;f');
  assert.equal(esc(null), '');
  assert.equal(esc(42), '42');
});

test("renderRow escapes HTML in activity: '<img src=x onerror=alert(1)>' appears as &lt;img", () => {
  const html = renderRow(agent({ activity: XSS }));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!html.includes('<img'));
});

test('renderRow escapes every snapshot string (display, id)', () => {
  const html = renderRow(agent({ id: `"x'><b>`, display: XSS }));
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<b>'));
  assert.ok(html.includes('&quot;x&#39;&gt;&lt;b&gt;'));
});

test('renderCard permission shows the command text escaped and Allow/Deny buttons', () => {
  const html = renderCard(permission({ tool_input: { command: `echo ${XSS} && rm "a"` } }));
  assert.ok(html.includes('echo &lt;img src=x onerror=alert(1)&gt; &amp;&amp; rm &quot;a&quot;'));
  assert.ok(!html.includes('<img'));
  assert.match(html, /<button[^>]*data-act="allow"[^>]*>Allow<\/button>/);
  assert.match(html, /<button[^>]*data-act="deny"[^>]*>Deny<\/button>/);
  assert.ok(html.includes('Hexbreaker wants to run a command'));
  assert.ok(html.includes('Always allow this exact command here'));
  assert.ok(html.includes('open window ↗'));
  assert.ok(!html.includes('helper'));
});

test('permission card from a sub-agent names its helper; no suggestions means no always box', () => {
  const html = renderCard(permission({ agent_type: 'Explore', permission_suggestions: [] }));
  assert.ok(html.includes('via Explore helper'));
  assert.ok(!html.includes('Always allow'));
  assert.ok(renderCard(permission({ agent_type: XSS })).includes('via &lt;img'));
});

test('M1: a PowerShell permission reads like Bash (run a command, exact-command always copy)', () => {
  const html = renderCard(permission({ tool_name: 'PowerShell', tool_input: { command: 'Get-ChildItem -Force' },
    permission_suggestions: [{ type: 'addRules', rules: [{ toolName: 'PowerShell', ruleContent: 'Get-ChildItem -Force' }], behavior: 'allow', destination: 'localSettings' }] }));
  assert.ok(html.includes('Hexbreaker wants to run a command'));
  assert.ok(html.includes('Always allow this exact command here'));
  assert.ok(html.includes('Get-ChildItem -Force'));
});

test('I6: the always box shows only when at least one addRules suggestion exists', () => {
  const MODE = { type: 'setMode', mode: 'acceptEdits', destination: 'session' };
  assert.ok(!renderCard(permission({ permission_suggestions: [MODE] })).includes('data-always'));
  assert.ok(!renderCard(permission({ permission_suggestions: [null, 'x'] })).includes('data-always'));
  assert.ok(renderCard(permission({ permission_suggestions: [MODE, ...permission().payload.permission_suggestions] })).includes('data-always'));
});

test("renderCard choice renders one option per tool_input option plus a 'Something else…' input", () => {
  const html = renderCard(choice());
  assert.equal(html.match(/class="opt( multi)?"/g).length, 5);
  assert.equal(count(html, 'placeholder="Something else…"'), 2);
  for (const q of QUESTIONS) {
    assert.ok(html.includes(q.question.replace(/'/g, '&#39;')));
    assert.ok(html.includes(`>${q.header}<`));
    for (const o of q.options) assert.ok(html.includes(`<b>${o.label}</b>`));
  }
  assert.ok(html.includes('Frees about 600 MB'));
  assert.match(html, /<button[^>]*data-act="answer"[^>]*disabled[^>]*>Answer<\/button>/);
  assert.equal(count(html, 'role="checkbox"'), 3);
  assert.equal(count(html, 'role="radio"'), 2);
});

test('renderCard choice escapes labels and questions', () => {
  const c = choice();
  c.payload.tool_input.questions = [{ question: XSS, header: XSS, multiSelect: false, options: [{ label: XSS, description: XSS }, { label: 'b' }] }];
  assert.ok(!renderCard(c).includes('<img'));
});

test('renderCard reply shows the first 200 chars of last_assistant_message', () => {
  const head = 'All nine screens are exported. '.repeat(7).slice(0, 200);
  const html = renderCard(reply(head + 'TAIL-NOT-SHOWN'));
  assert.equal(head.length, 200);
  assert.ok(html.includes(head));
  assert.ok(!html.includes('TAIL-NOT-SHOWN'));
  assert.ok(html.includes('class="ans parch'));
  assert.ok(html.includes('placeholder="Reply…"'));
  assert.ok(html.includes('No reply'));
  assert.ok(!renderCard(reply(XSS)).includes('<img'));
});

test("handedBack row contains 'Waiting in its window — open ↗'", () => {
  const html = renderRow(agent({ mood: 'needs', handedBack: true }));
  assert.ok(html.includes('Waiting in its window — open ↗'));
  assert.match(html, /data-act="open"[^>]*>Waiting in its window/);
  assert.ok(html.includes('class="st needs"'));
});

test('renderParty collapsed contains no card markup but keeps seals', () => {
  const snap = { agents: [agent({ id: 's1', mood: 'needs', cls: 'hexbreaker' }), agent({ id: 's2' })], card: permission(), next: null, counts: { total: 2, needs: 1 } };
  const html = renderParty(snap, { collapsed: true });
  assert.ok(!html.includes('class="ans'));
  assert.ok(!html.includes('Allow'));
  assert.equal(count(html, 'class="seal'), 1);
  assert.equal(count(html, '<svg'), 3); // two sprites + one seal
});

test('renderParty expanded puts the card right after its agent row and escapes the next line', () => {
  const snap = {
    agents: [agent({ id: 's0', display: 'first' }), agent({ id: 's1', mood: 'needs', display: 'second' }), agent({ id: 's2', display: 'third' })],
    card: permission(), next: `Next: ${XSS} asks a question`, counts: { total: 3, needs: 1 },
  };
  const html = renderParty(snap, { collapsed: false });
  const i = (s) => html.indexOf(s);
  assert.ok(i('second') < i('class="ans') && i('class="ans') < i('third'));
  assert.ok(html.includes('Next: <b>&lt;img src=x onerror=alert(1)&gt;</b> asks a question'));
  assert.ok(html.includes('3 at work'));
  assert.ok(html.includes('1 needs you'));
  assert.ok(!html.includes('<img'));
});

test('renderParty with no agents shows an empty note', () => {
  const html = renderParty({ agents: [], card: null, next: null, counts: { total: 0, needs: 0 } }, { collapsed: false });
  assert.ok(html.includes('No agents are running'));
});

test('row moods: working dots, needs chip and rail class; no seal, zee or pennant on rows', () => {
  assert.ok(renderRow(agent()).includes('class="dots"'));
  assert.ok(renderRow(agent({ mood: 'needs' })).includes('class="row needs'));
  assert.ok(renderRow(agent({ mood: 'needs' })).includes('class="st needs"'));
  for (const mood of ['needs', 'idle', 'done', 'working']) {
    const html = renderRow(agent({ mood }));
    assert.ok(!/class="(seal|zee|pennant)/.test(html), mood);
  }
});

test('renderChip: one chip per stage, with live clocks', () => {
  const now = 1_000_000_000;
  assert.equal(renderChip(agent({ stage: 'thinking' }), now), '<span class="st think">Thinking</span>');
  assert.equal(renderChip(agent({ stage: 'working', currentStepStartedAt: now - 120000, stageSince: now - 900000 }), now), '<span class="st work">Working · 2m</span>');
  assert.equal(renderChip(agent({ stage: 'working', currentStepStartedAt: null, stageSince: now - 45000 }), now), '<span class="st work">Working · 45s</span>');
  assert.equal(renderChip(agent({ stage: 'needs' }), now), '<span class="st needs">Needs you</span>');
  assert.equal(renderChip(agent({ stage: 'turn' }), now), '<span class="st turn">Your turn</span>');
  assert.equal(renderChip(agent({ stage: 'idle', lastActivityAt: now - 25 * 60000 }), now), '<span class="st idle">Idle · 25m</span>');
  assert.equal(renderChip(agent({ stage: 'working', stuck: { reason: 'x', detail: 'y' } }), now), '<span class="st stuck">⚠ Stuck?</span>');
  assert.equal(renderChip(agent({ stage: 'thinking', stuck: { reason: 'x', detail: 'y' } }), now), '<span class="st stuck">⚠ Stuck?</span>');
});

test('chipOf: class and text of the chip; only Working and Idle with a time are timed (the 1 s tick rewrites those, R7a)', () => {
  const now = 1_000_000_000;
  const w = agent({ stage: 'working', currentStepStartedAt: now - 45000 });
  assert.deepEqual(chipOf(w, now), { cls: 'work', text: 'Working · 45s', timed: true });
  assert.deepEqual(chipOf(w, now + 1000), { cls: 'work', text: 'Working · 46s', timed: true }, 'a second later');
  assert.deepEqual(chipOf(agent({ stage: 'idle', lastActivityAt: now - 25 * 60000 }), now), { cls: 'idle', text: 'Idle · 25m', timed: true });
  assert.deepEqual(chipOf(agent({ stage: 'idle', lastActivityAt: null }), now), { cls: 'idle', text: 'Idle', timed: false });
  assert.equal(chipOf(agent({ stage: 'needs' }), now).timed, false);
  assert.equal(chipOf(agent({ stage: 'working', stuck: { reason: 'x', detail: 'y' } }), now).timed, false);
  for (const a of [w, agent({ stage: 'turn' }), agent({ stage: 'working', stuck: { reason: 'x' } })]) {
    const c = chipOf(a, now);
    assert.equal(renderChip(a, now), `<span class="st ${c.cls}">${c.text}</span>`, 'renderChip wraps chipOf');
  }
});

test('rowCentreY: the row centre from the window top (the visible position), not from the top of the scrolled list (R7b)', () => {
  assert.equal(rowCentreY({ top: 100, height: 50 }), 125);
  assert.equal(rowCentreY({ top: -30.04, height: 62 }), 1, 'scrolled partly out of view: still measured from the window top');
});

test('renderRow: name and sprite select; name no longer opens; handed-back link still opens', () => {
  const html = renderRow(agent());
  assert.match(html, /class="sprite-box" data-act="select" data-session="s1"/);
  assert.match(html, /class="who-n" data-act="select" data-session="s1"/);
  assert.ok(!/class="who-n"[^>]*data-act="open"/.test(html));
  assert.match(renderRow(agent({ mood: 'needs', handedBack: true })), /class="link" data-act="open"/);
});

test('renderRow escapes HTML in activity and display (chip included)', () => {
  const html = renderRow(agent({ activity: XSS, display: XSS, stage: 'working', stageSince: 0 }), { nowMs: 5000 });
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img'));
});

test('newlyNeeding: only agents that were not already waiting get the arrival pulse', () => {
  const agents = [agent({ id: 'a', mood: 'needs' }), agent({ id: 'b', mood: 'needs' }), agent({ id: 'c' })];
  const first = newlyNeeding(agents, new Set());
  assert.deepEqual([...first.fresh], ['a', 'b']);
  const next = newlyNeeding(agents, first.needs);
  assert.equal(next.fresh.size, 0);
  assert.deepEqual([...newlyNeeding([agent({ id: 'b', mood: 'needs' }), agent({ id: 'd', mood: 'needs' })], first.needs).fresh], ['d']);
  assert.equal(newlyNeeding(null).needs.size, 0);
});

test('selected row gets class "selected"; others do not', () => {
  assert.ok(renderRow(agent(), { selected: true }).startsWith('<div class="row working selected"'));
  assert.ok(!renderRow(agent()).includes('selected'));
  assert.match(renderRow(agent(), { selected: true }), /class="who-n"[^>]*aria-pressed="true"/);
  assert.match(renderRow(agent()), /class="who-n"[^>]*aria-pressed="false"/);
  const snap = { agents: [agent({ id: 'a' }), agent({ id: 'b' })], card: null, next: null, selected: 'b', counts: { total: 2, needs: 0 } };
  const html = renderParty(snap, {});
  assert.equal(count(html, ' selected"'), 1);
  assert.ok(html.indexOf('selected') > html.indexOf('row:a'));
  assert.equal(count(renderParty({ ...snap, selected: undefined }, {}), 'selected'), 0);
});

test('row reply toggle reflects replyOptIn; familiars render, capped at 3', () => {
  assert.match(renderRow(agent({ replyOptIn: true })), /data-act="wait"[^>]*aria-pressed="true"/);
  assert.match(renderRow(agent()), /data-act="wait"[^>]*aria-pressed="false"/);
  assert.equal(count(renderRow(agent({ familiars: 2 })), 'class="fam'), 2);
  assert.equal(count(renderRow(agent({ familiars: 9 })), 'class="fam'), 3);
});

test('picksFrom: null until every question has a pick; labels, arrays and free text', () => {
  assert.equal(picksFrom(QUESTIONS, { 0: { opts: [0] } }), null);
  assert.equal(picksFrom(QUESTIONS, { 0: { opts: [0] }, 1: { opts: [] } }), null);
  assert.deepEqual(picksFrom(QUESTIONS, { 0: { opts: [1] }, 1: { opts: [0, 2] } }), {
    'Should the updater also delete old builds?': 'Leave them', 'Which channels?': ['Stable', 'Nightly'],
  });
  assert.deepEqual(picksFrom(QUESTIONS, { 0: { opts: [1], other: '  keep 5  ' }, 1: { opts: [], other: 'only LTS' } }), {
    'Should the updater also delete old builds?': 'keep 5', 'Which channels?': 'only LTS',
  });
});

test("spriteSvg('runesmith') returns an <svg string; unknown ids fall back to Pathfinder", () => {
  const s = spriteSvg('runesmith');
  assert.ok(s.startsWith('<svg'));
  assert.ok(s.includes('width="52"'));
  assert.ok(spriteSvg('runesmith', 4).includes('width="104"'));
  assert.equal(spriteSvg('no-such-class'), spriteSvg('pathfinder'));
});

test('CLASSES carry the 12 class ids of the class engine, in order', () => {
  assert.deepEqual(CLASSES.map((c) => c.id), CLASS_IDS);
});

test('MOODS badge and zee port and render through GR', () => {
  assert.equal(MOODS_BADGE.w, 7);
  assert.equal(MOODS_ZEE.w, 4);
  assert.ok(GR.svg(MOODS_BADGE, 2).startsWith('<svg'));
  assert.ok(GR.svg(MOODS_ZEE, 2).includes('width="12"'));
});

test('importing sprites.js and hud.js in Node does not throw', async () => {
  await assert.doesNotReject(import('../src/renderer/sprites.js?fresh'));
  await assert.doesNotReject(import('../src/renderer/hud.js?fresh'));
});

test('R19: replyLeftMs counts down to card.expiresAt when present, else from when the card appeared', () => {
  const r = { ...reply('hi'), expiresAt: 600000 };
  assert.equal(replyLeftMs(r, 100000, 99999), 500000);
  assert.equal(replyLeftMs(reply('hi'), 100000, 40000), 540000 - 60000);
  assert.equal(replyLeftMs(permission(), 100000, 0), undefined);
  assert.equal(replyLeftMs(null, 100000, 0), undefined);
});

test('R20: next line for a queued permission is bolded like the others', () => {
  const html = renderParty({ agents: [agent()], card: permission(), next: 'Next: agent-hud asks permission', counts: { total: 1, needs: 1 } });
  assert.ok(html.includes('Next: <b>agent-hud</b> asks permission · after this one'));
});

test('I7: actionsArmed is false for 500 ms after a card first appears, then true', () => {
  assert.equal(actionsArmed(10000, 10000), false);
  assert.equal(actionsArmed(10000, 10499), false);
  assert.equal(actionsArmed(10000, 10500), true);
  assert.equal(actionsArmed(10000, 99999), true);
});

test('I7: clickAllowed blocks allow/deny/answer/send/noreply while arming; other actions always pass', () => {
  for (const act of ['allow', 'deny', 'answer', 'send', 'noreply']) {
    assert.equal(clickAllowed(act, 1000, 1200), false, act);
    assert.equal(clickAllowed(act, 1000, 1500), true, act);
  }
  for (const act of ['pick', 'open', 'wait', 'collapse', 'expand']) assert.equal(clickAllowed(act, 1000, 1001), true, act);
});

test('I7: a card rendered while arming carries the arming class; otherwise not', () => {
  assert.ok(renderCard(permission(), { arming: true }).startsWith('<div class="ans arming"'));
  assert.ok(renderCard(reply('hi'), { arming: true }).startsWith('<div class="ans parch arming"'));
  assert.ok(!renderCard(permission()).includes('arming'));
  const snap = { agents: [agent({ mood: 'needs' })], card: permission(), next: null, counts: { total: 1, needs: 1 } };
  assert.ok(renderParty(snap, { arming: true }).includes('class="ans arming"'));
  assert.ok(!renderParty(snap, {}).includes('arming'));
});
