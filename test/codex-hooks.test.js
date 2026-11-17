import test from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import {
  CODEX_EVENTS, codexHookCommand, installCodexHooks, removeCodexHooks, ourPositions, approvalMissing, approvalState,
  installCodexHooksFile, removeCodexHooksFile,
} from '../src/main/codex-hooks.js';

const OURS = '"C:\\x\\resources\\codex-hook.cmd"';
const px = (cmd) => ({ matcher: '', hooks: [{ type: 'command', command: cmd, timeout: 5 }] });

// Shaped like a real Codex hooks.json that another tool already uses; commands are fake.
function foreignDoc() {
  const hooks = {};
  for (const ev of ['PreToolUse', 'PermissionRequest', 'PostToolUse', 'SessionStart', 'SessionEnd', 'SubagentStart', 'SubagentStop', 'Stop']) {
    hooks[ev] = [px(`node fake-pixel-agents.js ${ev}`)];
  }
  hooks.PostToolUse = [
    { matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'node fake-a.js', timeout: 5 }] },
    { matcher: '', hooks: [{ type: 'command', command: 'node fake-b.js', timeout: 5 }] },
    { matcher: 'Edit|Write|apply_patch', hooks: [{ type: 'command', command: 'node fake-c.js', timeout: 5, commandWindows: 'node fake-c-win.js', statusMessage: 'Fake status' }] },
  ];
  hooks.Stop = [px('node fake-stop-1.js'), px('node fake-stop-2.js')];
  return { hooks };
}
const clone = (v) => structuredClone(v);
const isOurs = (g) => g.hooks.some((h) => h.command === OURS);

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hud-codex-'));
  return { dir, file: path.join(dir, 'hooks.json'), done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('CODEX_EVENTS lists the ten events', () => {
  assert.deepEqual(CODEX_EVENTS, ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'Stop', 'Interrupt', 'SubagentStart', 'SubagentStop']);
});

test('install appends ours last in every event and leaves foreign groups identical and in order', () => {
  const before = foreignDoc();
  const { doc, changed } = installCodexHooks(clone(before), OURS);
  assert.equal(changed, true);
  for (const ev of CODEX_EVENTS) {
    const groups = doc.hooks[ev];
    const foreign = before.hooks[ev] || [];
    assert.deepEqual(groups.slice(0, foreign.length), foreign, ev);
    assert.equal(groups.length, foreign.length + 1, ev);
    const last = groups[groups.length - 1];
    assert.deepEqual(last, { matcher: '', hooks: [{ type: 'command', command: OURS, timeout: ev === 'PermissionRequest' ? 600 : 10 }] }, ev);
  }
});

test('install on a doc without hooks creates it', () => {
  const { doc } = installCodexHooks({}, OURS);
  assert.deepEqual(Object.keys(doc.hooks), CODEX_EVENTS);
});

test('install throws when hooks is not an object', () => {
  assert.throws(() => installCodexHooks({ hooks: [] }, OURS));
  assert.throws(() => installCodexHooks({ hooks: 'x' }, OURS));
});

test('reinstall updates ours in place: same index, no duplicate, changed=false when identical', () => {
  const once = installCodexHooks(foreignDoc(), OURS).doc;
  const again = installCodexHooks(clone(once), OURS);
  assert.equal(again.changed, false);
  assert.deepEqual(again.doc, once);

  // our group moved to the front of PostToolUse and has a stale timeout: updated where it sits
  const moved = clone(once);
  const ours = moved.hooks.PostToolUse.pop();
  ours.hooks[0].timeout = 1;
  moved.hooks.PostToolUse.unshift(ours);
  const fixed = installCodexHooks(moved, OURS);
  assert.equal(fixed.changed, true);
  assert.equal(fixed.doc.hooks.PostToolUse.length, 4);
  assert.equal(fixed.doc.hooks.PostToolUse.filter(isOurs).length, 1);
  assert.equal(isOurs(fixed.doc.hooks.PostToolUse[0]), true);
  assert.equal(fixed.doc.hooks.PostToolUse[0].hooks[0].timeout, 10);
});

test('install does not mutate its input', () => {
  const d = foreignDoc(); const snap = clone(d);
  installCodexHooks(d, OURS);
  assert.deepEqual(d, snap);
});

test('ourPositions finds event, group and hook index', () => {
  const doc = installCodexHooks(foreignDoc(), OURS).doc;
  doc.hooks.Stop[0].hooks.push({ type: 'command', command: OURS, timeout: 10 });
  const pos = ourPositions(doc, OURS);
  assert.deepEqual(pos.find((p) => p.event === 'PostToolUse'), { event: 'PostToolUse', group: 3, hook: 0 });
  assert.deepEqual(pos.find((p) => p.event === 'SessionStart'), { event: 'SessionStart', group: 1, hook: 0 });
  assert.ok(pos.some((p) => p.event === 'Stop' && p.group === 0 && p.hook === 1));
  assert.deepEqual(ourPositions({}, OURS), []);
});

test('install into a group shared with foreign hooks updates only our hook entry', () => {
  const doc = foreignDoc();
  doc.hooks.Stop[1].hooks.push({ type: 'command', command: OURS, timeout: 99 });
  const r = installCodexHooks(doc, OURS);
  assert.deepEqual(r.doc.hooks.Stop[1].hooks[0], doc.hooks.Stop[1].hooks[0]);
  assert.equal(r.doc.hooks.Stop[1].hooks[1].timeout, 10);
  assert.equal(r.doc.hooks.Stop.length, 2);
});

test('remove: ours last -> shifted []; a foreign group after ours -> shifted lists that event', () => {
  const installed = installCodexHooks(foreignDoc(), OURS).doc;
  const r = removeCodexHooks(clone(installed), OURS);
  assert.equal(r.changed, true);
  assert.deepEqual(r.shifted, []);
  assert.deepEqual(r.doc, foreignDoc());

  const moved = clone(installed);
  const ours = moved.hooks.PostToolUse.pop();
  moved.hooks.PostToolUse.unshift(ours);
  const r2 = removeCodexHooks(moved, OURS);
  assert.deepEqual(r2.shifted, ['PostToolUse']);
  assert.deepEqual(r2.doc, foreignDoc());
});

test('remove: shared group keeps foreign hooks, emptied event and hooks object go away', () => {
  const ours = { type: 'command', command: OURS };
  const fx = { type: 'command', command: 'node fake.js' };
  const r = removeCodexHooks({ hooks: { Stop: [{ matcher: '', hooks: [fx, ours] }] } }, OURS);
  assert.deepEqual(r.doc, { hooks: { Stop: [{ matcher: '', hooks: [fx] }] } });
  assert.deepEqual(r.shifted, []);

  // a foreign hook after ours inside the same group moves down
  const r1 = removeCodexHooks({ hooks: { Stop: [{ matcher: '', hooks: [ours, fx] }] } }, OURS);
  assert.deepEqual(r1.doc, { hooks: { Stop: [{ matcher: '', hooks: [fx] }] } });
  assert.deepEqual(r1.shifted, ['Stop']);

  const only = installCodexHooks({}, OURS).doc;
  const r3 = removeCodexHooks(only, OURS);
  assert.deepEqual(r3.doc, {});
  assert.equal(r3.changed, true);

  const none = removeCodexHooks(foreignDoc(), OURS);
  assert.equal(none.changed, false);
  assert.deepEqual(none.shifted, []);
});

test('Review Focus 3: approvalMissing reports our positions with no hooks.state entry, including after our group moved', () => {
  const hooksPath = 'C:\\Users\\someone\\.codex\\hooks.json';
  const doc = installCodexHooks(foreignDoc(), OURS).doc;
  const pos = ourPositions(doc, OURS);
  const header = (ev, g, h, p = hooksPath) => `[hooks.state.'${p}:${ev}:${g}:${h}']\ntrusted_hash = "abc"\n`;
  const snake = { SessionStart: 'session_start', SessionEnd: 'session_end', UserPromptSubmit: 'user_prompt_submit', PreToolUse: 'pre_tool_use', PermissionRequest: 'permission_request', PostToolUse: 'post_tool_use', Stop: 'stop', Interrupt: 'interrupt', SubagentStart: 'subagent_start', SubagentStop: 'subagent_stop' };
  const all = pos.map((p) => header(snake[p.event], p.group, p.hook)).join('\n');
  assert.deepEqual(approvalMissing(all, hooksPath, pos), []);

  // path compare ignores case and slash direction
  const alt = pos.map((p) => header(snake[p.event], p.group, p.hook, 'c:/users/SOMEONE/.codex/hooks.json')).join('\n');
  assert.deepEqual(approvalMissing(alt, hooksPath, pos), []);

  // PostToolUse approved at index 3, then our group moves to 0 -> position 0 has no header
  const moved = clone(doc);
  moved.hooks.PostToolUse.unshift(moved.hooks.PostToolUse.pop());
  assert.deepEqual(approvalMissing(all, hooksPath, ourPositions(moved, OURS)), ['PostToolUse']);

  // a header for another file's same position does not count
  const other = pos.map((p) => header(snake[p.event], p.group, p.hook, 'C:\\other\\hooks.json')).join('\n');
  assert.deepEqual(approvalMissing(other, hooksPath, pos), CODEX_EVENTS);

  // empty / unparseable -> everything unproven
  assert.deepEqual(approvalMissing('', hooksPath, pos), CODEX_EVENTS);
  assert.deepEqual(approvalMissing('[[[ not toml', hooksPath, pos), CODEX_EVENTS);
  assert.deepEqual(approvalMissing(undefined, hooksPath, pos), CODEX_EVENTS);
});

test('file: missing -> created with only ours; unparseable -> ok:false and file unchanged; CRLF kept', () => {
  const t = tmp();
  try {
    const r = installCodexHooksFile(t.file, OURS);
    assert.equal(r.ok, true); assert.equal(r.changed, true);
    const written = JSON.parse(fs.readFileSync(t.file, 'utf8'));
    assert.deepEqual(Object.keys(written), ['hooks']);
    assert.ok(Object.values(written.hooks).every((gs) => gs.length === 1 && isOurs(gs[0])));

    fs.writeFileSync(t.file, '{ nope');
    const bad = installCodexHooksFile(t.file, OURS);
    assert.equal(bad.ok, false);
    assert.equal(fs.readFileSync(t.file, 'utf8'), '{ nope');
    assert.equal(removeCodexHooksFile(t.file, OURS).ok, false);

    fs.writeFileSync(t.file, '{"hooks":[]}');
    assert.equal(installCodexHooksFile(t.file, OURS).ok, false);
    assert.equal(fs.readFileSync(t.file, 'utf8'), '{"hooks":[]}');

    const crlf = JSON.stringify(foreignDoc(), null, 2).replace(/\n/g, '\r\n') + '\r\n';
    fs.writeFileSync(t.file, crlf);
    assert.equal(installCodexHooksFile(t.file, OURS).ok, true);
    const text = fs.readFileSync(t.file, 'utf8');
    assert.ok(!/[^\r]\n/.test(text));
    assert.ok(text.endsWith('\r\n'));
    assert.ok(fs.existsSync(t.file + '.agent-hud.bak'));

    const rm = removeCodexHooksFile(t.file, OURS);
    assert.equal(rm.ok, true); assert.equal(rm.changed, true); assert.deepEqual(rm.shifted, []);
    assert.deepEqual(JSON.parse(fs.readFileSync(t.file, 'utf8')), foreignDoc());
  } finally { t.done(); }
});

test('removeCodexHooksFile on a missing file is a no-op and creates nothing', () => {
  const t = tmp();
  try {
    const r = removeCodexHooksFile(t.file, OURS);
    assert.equal(r.ok, true); assert.equal(r.changed, false); assert.deepEqual(r.shifted, []);
    assert.equal(fs.existsSync(t.file), false);
  } finally { t.done(); }
});

test('codexHookCommand quotes the .cmd path', () => {
  assert.equal(codexHookCommand('C:\\x\\resources'), '"C:\\x\\resources\\codex-hook.cmd"');
});

test('remove shifted: surviving shared group does not shift later groups; a kept group after a deleted one does', () => {
  const ours = { type: 'command', command: OURS };
  const f1 = { type: 'command', command: 'node f1.js' };
  const f2 = { type: 'command', command: 'node f2.js' };
  // A: ours shares group 0 with a foreign hook that sits before it; group 1 stays at index 1
  const a = removeCodexHooks({ hooks: { Stop: [{ matcher: '', hooks: [f1, ours] }, { matcher: '', hooks: [f2] }] } }, OURS);
  assert.deepEqual(a.shifted, []);
  // B: group 0 (ours only) is deleted, so the foreign hook in the next group moves from 1:0 to 0:0
  const b = removeCodexHooks({ hooks: { Stop: [{ matcher: '', hooks: [ours] }, { matcher: '', hooks: [f1, ours] }] } }, OURS);
  assert.deepEqual(b.shifted, ['Stop']);
  assert.deepEqual(b.doc, { hooks: { Stop: [{ matcher: '', hooks: [f1] }] } });
});

const SNAKE = { SessionStart: 'session_start', SessionEnd: 'session_end', UserPromptSubmit: 'user_prompt_submit', PreToolUse: 'pre_tool_use', PermissionRequest: 'permission_request', PostToolUse: 'post_tool_use', Stop: 'stop', Interrupt: 'interrupt', SubagentStart: 'subagent_start', SubagentStop: 'subagent_stop' };
test('approvalMissing: approved foreign positions do not hide our unapproved position', () => {
  const hooksPath = 'C:\Users\someone\.codex\hooks.json';
  const doc = installCodexHooks(foreignDoc(), OURS).doc;
  const foreignOnly = ourPositions(doc, OURS).map((p) => `[hooks.state.'${hooksPath}:${SNAKE[p.event]}:0:0']\ntrusted_hash = "x"\n`).join('\n');
  const missing = approvalMissing(foreignOnly, hooksPath, ourPositions(doc, OURS));
  assert.ok(missing.includes('PostToolUse') && missing.includes('Stop') && missing.includes('PreToolUse'));
});

test('file: indentation of the original is kept and foreign text is untouched by install and remove', () => {
  const t = tmp();
  try {
    const orig = JSON.stringify(foreignDoc(), null, 4) + '\n';
    fs.writeFileSync(t.file, orig);
    const start = orig.indexOf('"PostToolUse"');
    const block = orig.slice(start, orig.indexOf('"statusMessage"', start) + 30);
    assert.equal(installCodexHooksFile(t.file, OURS).ok, true);
    const text = fs.readFileSync(t.file, 'utf8');
    assert.ok(text.includes(block));
    assert.ok(/\n {4}"hooks": \{\n {8}"/.test(text));
    assert.equal(removeCodexHooksFile(t.file, OURS).ok, true);
    assert.equal(fs.readFileSync(t.file, 'utf8'), orig);

    const tabs = JSON.stringify(foreignDoc(), null, '\t');
    fs.writeFileSync(t.file, tabs);
    installCodexHooksFile(t.file, OURS);
    assert.ok(/\n\t"hooks": \{\n\t\t"/.test(fs.readFileSync(t.file, 'utf8')));
  } finally { t.done(); }
});

const HP = 'C:\\Users\\someone\\.codex\\hooks.json';
const hdr = (ev, g, h, hash) => `[hooks.state.'${HP}:${SNAKE[ev]}:${g}:${h}']\ntrusted_hash = "${hash}"\n`;
const cfgOf = (rows) => rows.map(([ev, g, h, hash]) => hdr(ev, g, h, hash)).join('\n');
const posKeys = (pos) => pos.map((p) => [p.event, p.group, p.hook]);

test('approvalState: fresh install is missing until a header appears, then approved', () => {
  const pos = ourPositions(installCodexHooks({}, OURS).doc, OURS);
  const a = approvalState('', HP, pos, {});
  assert.deepEqual(a.missing, CODEX_EVENTS);
  const b = approvalState(cfgOf(posKeys(pos).map((k) => [...k, 'O'])), HP, pos, a.memory);
  assert.deepEqual(b.missing, []);
  assert.deepEqual(approvalState('[[[ not toml', HP, pos, {}).missing, CODEX_EVENTS);
  assert.deepEqual(approvalState(undefined, HP, pos, {}).missing, CODEX_EVENTS);
});

test('approvalState: our group moving into a slot approved for another hook is missing until re-approved', () => {
  const doc = installCodexHooks(foreignDoc(), OURS).doc; // PostToolUse: foreign 0..2, ours at 3
  const pos = ourPositions(doc, OURS);
  const rows = [];
  for (const p of pos) {
    if (p.event === 'PostToolUse') { for (let g = 0; g < 3; g++) rows.push(['PostToolUse', g, 0, 'F' + g]); rows.push(['PostToolUse', 3, 0, 'O']); }
    else rows.push([p.event, p.group, p.hook, 'O']);
  }
  const cfg = cfgOf(rows);
  const a = approvalState(cfg, HP, pos, {});
  assert.deepEqual(a.missing, []);
  // (c) unchanged positions stay approved
  const again = approvalState(cfg, HP, pos, a.memory);
  assert.deepEqual(again.missing, []);
  // a foreign group before ours is removed: ours moves to 2, whose header still has the foreign hash
  const moved = clone(doc); moved.hooks.PostToolUse.shift();
  const mpos = ourPositions(moved, OURS);
  const m1 = approvalState(cfg, HP, mpos, again.memory);
  assert.deepEqual(m1.missing, ['PostToolUse']);
  assert.deepEqual(approvalState(cfg, HP, mpos, m1.memory).missing, ['PostToolUse']); // still pending
  // Codex re-approves: the header at 2 changes
  const cfg2 = cfgOf(rows.map((r) => (r[0] === 'PostToolUse' && r[1] === 2 ? ['PostToolUse', 2, 0, 'O'] : r)));
  const m2 = approvalState(cfg2, HP, mpos, m1.memory);
  assert.deepEqual(m2.missing, []);
  assert.deepEqual(approvalState(cfg2, HP, mpos, m2.memory).missing, []);
});
