import test from 'node:test'; import assert from 'node:assert/strict';
import { esc, newlyIn, newlyNeeding, newlyFinished, keepFlashing, renderChip, chipOf, chipText, rowCentreY, renderRow, renderCard, renderParty, picksFrom, replyLeftMs, actionsArmed, clickAllowed, createRenderGate } from '../src/renderer/hud.js';
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
  assert.equal(count(html, '<svg'), 4); // two sprites + one seal + the header's speaker
});

test('renderParty renders no card markup even when cards are set; there is no Next line', () => {
  const snap = {
    agents: [agent({ id: 's0', display: 'first' }), agent({ id: 's2', mood: 'needs', display: 'second' }), agent({ id: 's3', display: 'third' })],
    cards: [{ id: 'c2', kind: 'choice', sessionId: 's2' }], counts: { total: 3, needs: 1 },
  };
  for (const opts of [{}, { collapsed: false }, { collapsed: false, arming: true, leftMs: 1000 }]) {
    const html = renderParty(snap, opts);
    for (const needle of ['class="ans', 'card-slot', 'data-sticky', 'data-act="answer"', 'data-act="open-card"', 'Something else', 'Should the updater']) {
      assert.ok(!html.includes(needle), `${needle} in ${JSON.stringify(opts)}`);
    }
    assert.ok(!html.includes('queue') && !html.includes('Next:'), 'no Next line');
    assert.match(html, /data-key="row:s2"[^]*· asks a question[^]*data-key="row:s3"/, "the asking agent's row still says what it asks");
    assert.equal(count(html, 'asks a question'), 1, 'only the card owner\'s row');
  }
});

test('renderParty shows the counts in the header', () => {
  const snap = { agents: [agent({ id: 's0' }), agent({ id: 's1', mood: 'needs' }), agent({ id: 's2' })], cards: [], counts: { total: 3, needs: 1 } };
  const html = renderParty(snap, { collapsed: false });
  assert.ok(html.includes('3 at work'));
  assert.ok(html.includes('1 needs you'));
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
  assert.equal(replyLeftMs({ ...reply('hi'), holdMs: 540000 }, 100000, 40000), 540000 - 60000);
  assert.equal(replyLeftMs(permission(), 100000, 0), undefined);
  assert.equal(replyLeftMs(null, 100000, 0), undefined);
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
  // (the card lives in the detail panel now: test/panel-render.test.js covers its arming class there)
});

test('I1: a working row renders the same HTML at two different times; its chip carries data-kind and data-since for the tick', () => {
  const now = 1_000_000_000;
  const w = agent({ stage: 'working', currentStepStartedAt: now - 45000, stageSince: now - 90000 });
  assert.equal(renderRow(w, { nowMs: now }), renderRow(w, { nowMs: now + 61000 }));
  assert.match(renderRow(w), new RegExp(`<span class="st work" data-kind="work" data-since="${now - 45000}">Working</span>`));
  const idle = agent({ mood: 'idle', stage: 'idle', lastActivityAt: now - 25 * 60000 });
  assert.equal(renderRow(idle, { nowMs: now }), renderRow(idle, { nowMs: now + 3600000 }));
  assert.match(renderRow(idle), new RegExp(`<span class="st idle" data-kind="idle" data-since="${now - 25 * 60000}">Idle</span>`));
  assert.match(renderRow(agent({ stage: 'thinking' })), /<span class="st think">Thinking<\/span>/, 'untimed chips carry no clock');
  const snap = { agents: [w, idle], card: null, next: null, counts: { total: 2, needs: 0 } };
  assert.equal(renderParty(snap, { nowMs: now }), renderParty(snap, { nowMs: now + 5000 }));
});

test('I1: chipText is the live chip text for a kind and start (strings from the DOM accepted)', () => {
  const now = 1_000_000_000;
  assert.equal(chipText('work', String(now - 120000), now), 'Working · 2m');
  assert.equal(chipText('idle', now - 25 * 60000, now), 'Idle · 25m');
  assert.equal(chipText('work', null, now), 'Working');
  assert.equal(chipText('think', undefined, now), 'Thinking');
  const w = agent({ stage: 'working', currentStepStartedAt: now - 45000 });
  assert.equal(chipText('work', now - 45000, now + 1000), chipOf(w, now + 1000).text, 'the tick writes what chipOf would');
});

test('I1: the render gate holds renders while a pointer is down and applies only the latest after the click', () => {
  const timers = [];
  const setTimer = (fn, ms) => { timers.push({ fn, ms, live: true }); return timers.length - 1; };
  const clearTimer = (i) => { if (timers[i]) timers[i].live = false; };
  const fire = (ms) => { for (const t of timers.filter((x) => x.live && x.ms === ms)) { t.live = false; t.fn(); } };
  const applied = [];
  const g = createRenderGate((v) => applied.push(v), { setTimer, clearTimer, maxHoldMs: 5000 });
  g.offer('a');
  assert.deepEqual(applied, ['a'], 'no pointer down: applied at once');
  g.down(); g.offer('b'); g.offer('c');
  assert.deepEqual(applied, ['a'], 'held while the pointer is down');
  g.up();
  assert.deepEqual(applied, ['a'], 'not on pointerup itself: the click lands first');
  g.offer('d');
  assert.deepEqual(applied, ['a'], 'still held until the click has been dispatched');
  fire(0);
  assert.deepEqual(applied, ['a', 'd'], 'then only the latest');
  g.down(); g.up(); fire(0);
  assert.deepEqual(applied, ['a', 'd'], 'nothing pending: nothing rendered');
  g.down(); g.offer('e'); g.up(); g.down(); fire(0);
  assert.deepEqual(applied, ['a', 'd'], 'a second press before the release keeps holding');
  g.up(); g.up(); fire(0);
  assert.deepEqual(applied, ['a', 'd', 'e'], 'pointerup + pointercancel release once');
  g.down(); g.offer('f'); fire(5000);
  assert.deepEqual(applied, ['a', 'd', 'e', 'f'], 'a lost pointerup never freezes the view');
  g.up(); fire(0);
  assert.deepEqual(applied, ['a', 'd', 'e', 'f']);
});

test('rows and cards hide "open" when the session cannot be focused', () => {
  const handed = renderRow(agent({ mood: 'needs', stage: 'needs', handedBack: true, canOpen: false }));
  assert.match(handed, /Waiting in its window/);
  assert.doesNotMatch(handed, /data-act="open"/);
  const handedOk = renderRow(agent({ mood: 'needs', stage: 'needs', handedBack: true, canOpen: true }));
  assert.match(handedOk, /data-act="open"[^>]*>Waiting in its window — open ↗/);
  assert.doesNotMatch(renderCard({ ...permission(), canOpen: false }), /data-act="open-card"/);
  assert.match(renderCard({ ...permission(), canOpen: true }), /data-act="open-card"/);
});

test('newlyIn reports fresh ids once', () => {
  const turn = (a) => a?.stage === 'turn';
  const agents = [agent({ id: 'a', stage: 'turn' }), agent({ id: 'b', stage: 'working' })];
  const first = newlyIn(agents, new Set(), turn);
  assert.deepEqual([...first.now], ['a']);
  assert.deepEqual([...first.fresh], ['a']);
  assert.equal(newlyIn(agents, first.now, turn).fresh.size, 0);
  const flip = newlyIn([agent({ id: 'a', stage: 'working' }), agent({ id: 'b', stage: 'turn' })], first.now, turn);
  assert.deepEqual([...flip.fresh], ['b']);
  assert.equal(newlyIn(null, undefined, turn).now.size, 0);
  assert.deepEqual([...newlyNeeding(agents.map((x) => ({ ...x, mood: 'needs' }))).fresh], ['a', 'b']);
});

test('needs rows carry glow-ask; turn chip contains the pennant svg', () => {
  const needs = renderRow(agent({ id: 'n', mood: 'needs', stage: 'needs' }));
  assert.match(needs, /class="row needs[^"]*glow-ask/);
  assert.ok(!needs.includes(" call"), "the arrival pulses are added once by the DOM pass, not rendered");
  assert.ok(!renderRow(agent({ id: 'w', mood: 'working', stage: 'working' })).includes('glow-ask'));
  const turn = renderRow(agent({ id: 't', mood: 'done', stage: 'turn' }));
  assert.match(turn, /<span class="st turn"[^>]*><span class="flag"[^>]*><svg[\s\S]*?<\/svg><\/span>Your turn<\/span>/);
  assert.ok(!turn.includes('glow-done'), 'glow-done is added by the DOM once, not rendered');
});

test('v1.2 M7: renderParty needs only the card kind and session for the asking row', () => {
  const html = renderParty({ agents: [agent({ id: 's1', mood: 'needs', stage: 'needs' })], cards: [{ id: 'c1', kind: 'choice', sessionId: 's1' }] });
  assert.match(html, /asks a question/);
});

test("a row's ask comes from the first card for that session", () => {
  const html = renderParty({ agents: [agent({ id: 's1', mood: 'needs' })], cards: [{ id: 'c1', kind: 'permission', sessionId: 's1' }, { id: 'c2', kind: 'choice', sessionId: 's1' }] });
  assert.match(html, /asks permission/);
  assert.ok(!html.includes('asks a question'));
});

test('no queue element, even with three cards', () => {
  const cards = [1, 2, 3].map((n) => ({ id: 'c' + n, kind: 'permission', sessionId: 's' + n }));
  const html = renderParty({ agents: [agent({ id: 's1', mood: 'needs' })], cards, counts: { total: 1, needs: 1 } });
  assert.ok(!html.includes('class="queue"'));
});

test('a highlighted row carries the hl class; others do not', () => {
  assert.match(renderRow(agent(), { highlighted: true }), /class="row [^"]*\bhl\b/);
  assert.ok(!/\bhl\b/.test(renderRow(agent())));
  const html = renderParty({ agents: [agent({ id: 'a' }), agent({ id: 'b' })], highlight: 'b' });
  assert.match(html, /class="row [^"]*\bhl\b[^"]*" data-key="row:b"/);
  assert.ok(!/\bhl\b[^>]*data-key="row:a"/.test(html));
});

test('a turn row with a recap reads "<cls> · <recap>" instead of finished', () => {
  const html = renderRow(agent({ mood: 'done', stage: 'turn', recap: 'Fixed the <b>bug</b>' }));
  assert.ok(html.includes('Runesmith</span> · Fixed the &lt;b&gt;bug&lt;/b&gt;'));
  assert.ok(!html.includes('finished'));
  assert.ok(renderRow(agent({ mood: 'done', stage: 'turn' })).includes('finished'));
});

test('a needs face in the collapsed HUD opens the stack (data-act="ask"); others expand', () => {
  const cards = [{ id: 'c1', kind: 'permission', sessionId: 's1' }];
  const html = renderParty({ agents: [agent({ id: 's1', mood: 'needs' }), agent({ id: 's2' })], cards }, { collapsed: true });
  assert.match(html, /data-key="face:s1" data-act="ask"/);
  assert.match(html, /data-key="face:s2" data-act="expand"/);
});

test('I3: a needs face with no held card (handed back, or a native prompt) expands the HUD instead of a dead "ask"', () => {
  const agents = [agent({ id: 's1', mood: 'needs', handedBack: true }), agent({ id: 's2', mood: 'needs' })];
  const html = renderParty({ agents, cards: [{ id: 'c9', kind: 'permission', sessionId: 's3' }] }, { collapsed: true });
  assert.match(html, /data-key="face:s1" data-act="expand"/);
  assert.match(html, /data-key="face:s2" data-act="expand"/);
  assert.match(renderParty({ agents }, { collapsed: true }), /data-key="face:s1" data-act="expand"/, 'no cards at all');
});

test('the HUD page allows blob: media in its CSP', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8');
  assert.match(html, /Content-Security-Policy" content="[^"]*; media-src blob:"/);
});

test('v1.2 M5: the "Your turn" pennant carries the pennant class, so its sparkle twinkles (hud.css .pennant .g-tw)', () => {
  const turn = renderRow(agent({ id: 't', mood: 'done', stage: 'turn' }));
  assert.match(turn, /<span class="flag"[^>]*><svg class="px pennant"/);
  assert.match(turn, /<g class="g-tw">/, 'the sparkle group the twinkle animates');
});

test('v1.2 M8: rows already in "Your turn" at the first snapshot (a start or reload) do not glow; later arrivals do', () => {
  const turnA = [agent({ id: 'a', mood: 'done', stage: 'turn' }), agent({ id: 'b', stage: 'working' })];
  const first = newlyFinished(turnA, null);
  assert.deepEqual([...first.now], ['a'], 'seeded from the first snapshot');
  assert.equal(first.fresh.size, 0, 'nothing glows on start');
  const next = newlyFinished([agent({ id: 'a', mood: 'done', stage: 'turn' }), agent({ id: 'b', mood: 'done', stage: 'turn' })], first.now);
  assert.deepEqual([...next.fresh], ['b'], 'an agent that finishes afterwards glows');
  assert.equal(newlyFinished(null, null).now.size, 0);
});

test('v1.2 M4: the breathing question glow animates only the opacity of its own layer, never box-shadow forever', async () => {
  const fs = await import('node:fs');
  const css = fs.readFileSync(new URL('../src/renderer/hud.css', import.meta.url), 'utf8');
  const breathe = /@keyframes ask-breathe\s*\{([^]*?)\n\}/.exec(css)?.[1] ?? /@keyframes ask-breathe\s*\{(.*)\}/.exec(css)?.[1];
  assert.ok(breathe, 'ask-breathe keyframes exist');
  assert.doesNotMatch(breathe, /box-shadow/, 'an infinite box-shadow animation repaints the row every frame');
  assert.match(breathe, /opacity/);
  assert.match(css, /\.row\.glow-ask::after\s*\{[^}]*box-shadow/, 'the glow is drawn on a pseudo-element');
  for (const m of css.matchAll(/([^{}]+)\{[^}]*animation:[^;}]*ask-breathe[^;}]*\}/g)) {
    assert.match(m[1], /::after/, `ask-breathe runs on the pseudo-element only: ${m[1].trim()}`);
  }
  assert.match(css, /\.row\.needs::before\s*\{/, 'the rail stays');
  assert.match(css, /\.row\.selected\s*\{[^}]*box-shadow/, 'the selected style stays');
});

// v1.3: ✕ to hide a row; quiet chats under a "tucked away" line.
test('v1.3: rows carry a ✕ except when asking or tucked; it is escaped and names the chat', () => {
  assert.match(renderRow(agent({ id: 'x"1', display: 'arsenal · e0' })), /data-act="hide" data-session="x&quot;1"[^>]*aria-label="Hide arsenal · e0 from the HUD"/);
  assert.doesNotMatch(renderRow(agent({ mood: 'needs' })), /data-act="hide"/);
  const t = renderRow(agent(), { tucked: true });
  assert.doesNotMatch(t, /data-act="hide"/);
  assert.match(t, /class="row [^"]*\btucked\b/);
});

test('v1.3: the tucked line shows the count and folds/unfolds; tucked rows only when open', () => {
  const snap = { agents: [agent({ id: 'a' })], tucked: [agent({ id: 't1' }), agent({ id: 't2' })], counts: { total: 1, needs: 0 } };
  const folded = renderParty({ ...snap, tuckOpen: false });
  assert.match(folded, /data-act="tucked" aria-expanded="false">── 2 tucked away · show ──/);
  assert.doesNotMatch(folded, /row:t1/);
  const open = renderParty({ ...snap, tuckOpen: true });
  assert.match(open, /aria-expanded="true">── 2 tucked away · hide ──/);
  assert.match(open, /data-key="row:t1"/);
  assert.doesNotMatch(renderParty({ ...snap, tucked: [] }), /tuck-line/);
});

test('v1.3: nothing visible but chats tucked → "All quiet — every chat is tucked away."', () => {
  assert.match(renderParty({ agents: [], tucked: [agent({ id: 't' })], counts: { total: 0, needs: 0 } }), /All quiet — every chat is tucked away\./);
  assert.match(renderParty({ agents: [], tucked: [], counts: { total: 0, needs: 0 } }), /No agents are running\./);
});

test('Codex row: tag before the class, Codex sprite and familiars, no wait button; Claude row has none', () => {
  const cx = renderRow(agent({ source: 'codex', familiars: 1 }));
  assert.ok(cx.includes('<span class="src">Codex</span> · <span class="cls">'));
  assert.ok(cx.includes('#8ef5c6'));
  assert.ok(!cx.includes('data-act="wait"'));
  const cl = renderRow(agent({ familiars: 1 }));
  assert.ok(!cl.includes('class="src"'));
  assert.ok(!cl.includes('#8ef5c6'));
  assert.ok(cl.includes('data-act="wait"'));
  assert.ok(!renderRow(agent({ source: 'bogus' })).includes('class="src"'));
});

test('a Claude and a Codex agent of one class render different sprites in one party (cache key has the source)', () => {
  const html = renderParty({ agents: [agent({ id: 'a' }), agent({ id: 'b', source: 'codex' })], counts: { total: 2, needs: 0 } });
  const [a, b] = html.split('data-key="row:b"');
  assert.ok(!a.includes('#8ef5c6'));
  assert.ok(b.includes('#8ef5c6'));
  const faces = renderParty({ agents: [agent({ id: 'a' }), agent({ id: 'b', source: 'codex' })] }, { collapsed: true });
  const [fa, fb] = faces.split('data-key="face:b"');
  assert.ok(!fa.includes('#8ef5c6'));
  assert.ok(fb.includes('#8ef5c6'));
});

test('the header has a sound on/off button next to collapse: aria-pressed follows snapshot.sound.muted', () => {
  const on = renderParty({ agents: [], cards: [], sound: { muted: false } });
  assert.match(on, /<button type="button" class="snd" data-act="sound" aria-pressed="true"[^>]*aria-label="Sound on[^"]*"[^>]*><svg/);
  assert.ok(on.indexOf('class="snd"') < on.indexOf('class="min"'), 'speaker sits left of the collapse button');
  const off = renderParty({ agents: [], cards: [], sound: { muted: true } });
  assert.match(off, /class="snd" data-act="sound" aria-pressed="false"[^>]*aria-label="Sound off[^"]*"/);
  const none = renderParty({ agents: [], cards: [] });
  assert.match(none, /class="snd" data-act="sound" aria-pressed="true"/, 'no sound field: on');
});

test('the collapsed header keeps the sound button beside the expand button', () => {
  const html = renderParty({ agents: [], cards: [], sound: { muted: true } }, { collapsed: true });
  assert.match(html, /class="snd" data-act="sound" aria-pressed="false"/);
  assert.ok(html.indexOf('class="snd"') < html.indexOf('data-act="collapse"'));
});

test('renderRow: ? on Claude rows (not tucked, not Codex), escaped label', () => {
  assert.match(renderRow(agent({ display: XSS })), /class="side-q" data-act="side" data-session="s1" title="Ask on the side" aria-label="Ask &lt;img/);
  assert.ok(!renderRow(agent({ source: 'codex' })).includes('side-q'));
  assert.ok(!renderRow(agent(), { tucked: true }).includes('side-q'));
});
test('renderRow: the dot only when sideDot, inside the mark', () => {
  assert.match(renderRow(agent({ sideDot: true })), /<span class="mark"><span class="side-dot"/);
  assert.ok(!renderRow(agent()).includes('side-dot'));
  assert.ok(!renderRow(agent({ source: 'codex', sideDot: true })).includes('side-dot'));
});

test('v1.7: an unseen "Your turn" row and face carry the unseen class; tucked or not-in-turn rows do not', () => {
  const cls = (html) => html.match(/class="row[^"]*"/)[0];
  const lit = agent({ id: 't', mood: 'done', stage: 'turn', unseen: true });
  assert.match(renderRow(lit), /class="row done[^"]*\bunseen\b/);
  assert.ok(!renderRow(lit).includes('glow-done'), 'the flash stays a DOM class (I1)');
  assert.ok(!/\bunseen\b/.test(cls(renderRow(agent({ id: 't', mood: 'done', stage: 'turn', unseen: false })))));
  assert.ok(!/\bunseen\b/.test(cls(renderRow(lit, { tucked: true }))));
  assert.ok(!/\bunseen\b/.test(cls(renderRow(agent({ id: 'w', mood: 'working', stage: 'working', unseen: true })))));
  const col = renderParty({ agents: [lit], cards: [] }, { collapsed: true });
  assert.match(col, /class="face done unseen"/);
});

test('v1.7: keepFlashing keeps mid-flash ids still in turn and adds fresh ones', () => {
  const s = (...a) => new Set(a);
  assert.deepEqual([...keepFlashing(s('a', 'b'), s('c'), s('a', 'c'))].sort(), ['a', 'c']);
  assert.equal(keepFlashing(s(), s(), s()).size, 0);
});

test('v1.7 M4: the unseen glow never animates; collapsed faces get the finite finish flash', async () => {
  const fs = await import('node:fs');
  const css = fs.readFileSync(new URL('../src/renderer/hud.css', import.meta.url), 'utf8');
  assert.match(css, /\.row\.unseen\s*\{[^}]*box-shadow/);
  assert.match(css, /\.face\.unseen\s*\{/);
  for (const m of css.matchAll(/([^{}]+)\{([^}]*animation[^}]*)\}/g)) {
    assert.doesNotMatch(m[1], /\.unseen/, `nothing animates the unseen glow: ${m[1].trim()}`);
  }
  assert.match(css, /\.face\.glow-done\s*\{[^}]*animation:\s*done-pulse[^;}]*\b2\b/, 'faces flash twice, like rows');
});
