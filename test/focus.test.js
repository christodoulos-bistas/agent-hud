import test from 'node:test'; import assert from 'node:assert/strict';
import { openCommandFor, resolveCodeCmd, canOpen, CODEX_ACTIVATE } from '../src/main/focus.js';

const S = (o = {}) => ({ sessionId: 's1', pid: 1, cwd: 'c:\\Consortis_projects\\arsenal', kind: 'interactive', name: 'arsenal-e0', nameSource: 'derived', status: 'idle', startedAt: 0, ...o });
const CODE = 'C:\\Users\\u\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd';

test('claude-vscode -> the full code.cmd path with the cwd (a bare "code" breaks %~dp0 in code.cmd)', () => {
  assert.deepEqual(openCommandFor(S({ entrypoint: 'claude-vscode' }), { codeCmd: CODE }), { cmd: CODE, args: ['c:\\Consortis_projects\\arsenal'] });
});

test('claude-vscode without a resolved code.cmd -> nothing to open (never the folder)', () => {
  assert.equal(openCommandFor(S({ entrypoint: 'claude-vscode' }), {}), null);
});

test('claude-desktop -> PowerShell AppActivate of the Claude window', () => {
  assert.deepEqual(openCommandFor(S({ entrypoint: 'claude-desktop' })), {
    cmd: 'powershell',
    args: ['-NoProfile', '-Command', "(New-Object -ComObject WScript.Shell).AppActivate('Claude')"],
  });
});

test('any other entrypoint -> nothing to open (no Explorer folder)', () => {
  assert.equal(openCommandFor(S({ entrypoint: 'cli' }), { codeCmd: CODE }), null);
  assert.equal(openCommandFor(S({ entrypoint: undefined }), { codeCmd: CODE }), null);
});

test('canOpen mirrors openCommandFor', () => {
  assert.equal(canOpen(S({ entrypoint: 'claude-vscode' }), { codeCmd: CODE }), true);
  assert.equal(canOpen(S({ entrypoint: 'claude-vscode' }), {}), false);
  assert.equal(canOpen(S({ entrypoint: 'claude-desktop' }), {}), true);
  assert.equal(canOpen(S({ entrypoint: 'cli' }), { codeCmd: CODE }), false);
  assert.equal(canOpen(null, { codeCmd: CODE }), false);
});

test('resolveCodeCmd: first code.cmd on PATH, else the default per-user install, else null', () => {
  const have = new Set(['D:\\tools\\code.cmd', 'C:\\L\\Programs\\Microsoft VS Code\\bin\\code.cmd']);
  const exists = (p) => have.has(p);
  assert.equal(resolveCodeCmd({ pathEnv: 'C:\\Windows;D:\\tools;E:\\x', localAppData: 'C:\\L', exists }), 'D:\\tools\\code.cmd');
  assert.equal(resolveCodeCmd({ pathEnv: 'C:\\Windows', localAppData: 'C:\\L', exists }), 'C:\\L\\Programs\\Microsoft VS Code\\bin\\code.cmd');
  assert.equal(resolveCodeCmd({ pathEnv: '', localAppData: 'C:\\nowhere', exists }), null);
  assert.equal(resolveCodeCmd({ pathEnv: undefined, localAppData: undefined, exists }), null);
});

const X = (host, o = {}) => S({ entrypoint: 'codex', source: 'codex', host, ...o });
const CODEX_ARG = 'shell:AppsFolder\\OpenAI.Codex_2p2nqsd0c76g0!App';

test('CODEX_ACTIVATE is the Store-package AppsFolder activation (one backslash)', () => {
  assert.deepEqual(CODEX_ACTIVATE, { cmd: 'explorer.exe', args: [CODEX_ARG] });
  assert.equal(CODEX_ACTIVATE.args[0].split('\\').length, 2);
});

test('codex desktop host -> codexActivate', () => {
  assert.deepEqual(openCommandFor(X('desktop'), { codeCmd: CODE, codexActivate: CODEX_ACTIVATE }), CODEX_ACTIVATE);
});

test('codex vscode host -> code.cmd with the cwd', () => {
  assert.deepEqual(openCommandFor(X('vscode'), { codeCmd: CODE, codexActivate: CODEX_ACTIVATE }), { cmd: CODE, args: ['c:\\Consortis_projects\\arsenal'] });
});

test('codex vscode host without code.cmd or cwd -> null', () => {
  assert.equal(openCommandFor(X('vscode'), { codexActivate: CODEX_ACTIVATE }), null);
  assert.equal(openCommandFor(X('vscode', { cwd: '' }), { codeCmd: CODE }), null);
});

test('codex cli / unknown host -> null', () => {
  assert.equal(openCommandFor(X('cli'), { codeCmd: CODE, codexActivate: CODEX_ACTIVATE }), null);
  assert.equal(openCommandFor(X('unknown'), { codeCmd: CODE, codexActivate: CODEX_ACTIVATE }), null);
});

test('codex desktop with codexActivate null/absent -> null, and canOpen follows', () => {
  assert.equal(openCommandFor(X('desktop'), { codeCmd: CODE, codexActivate: null }), null);
  assert.equal(openCommandFor(X('desktop'), { codeCmd: CODE }), null);
  assert.equal(canOpen(X('desktop'), { codexActivate: CODEX_ACTIVATE }), true);
  assert.equal(canOpen(X('desktop'), {}), false);
  assert.equal(canOpen(X('cli'), { codexActivate: CODEX_ACTIVATE }), false);
});

// Open window to the exact chat (17 Nov): chatLinkFor builds each app's own chat link.
import { chatLinkFor, VSCODE_LINK_WAIT_MS } from '../src/main/focus.js';
const ID = '4256fdae-9f5d-4442-a000-98dbdd29a2c9';

test('chatLinkFor: Claude app chat → claude://code/continue with its session id', () => {
  assert.deepEqual(chatLinkFor(S({ sessionId: ID, entrypoint: 'claude-desktop' })), { url: `claude://code/continue?session=${ID}` });
});

test('chatLinkFor: Codex app chat → codex://threads/<id>; Codex in VS Code, CLI or unknown → null', () => {
  assert.deepEqual(chatLinkFor(S({ sessionId: ID, entrypoint: 'codex', host: 'desktop' })), { url: `codex://threads/${ID}` });
  for (const host of ['vscode', 'cli', 'unknown', undefined]) assert.equal(chatLinkFor(S({ sessionId: ID, entrypoint: 'codex', host })), null, String(host));
});

test('Review Focus 1: a VS Code chat brings its window forward first, waits 1500 ms, then opens the chat', () => {
  assert.equal(VSCODE_LINK_WAIT_MS, 1500);
  assert.deepEqual(chatLinkFor(S({ sessionId: ID, entrypoint: 'claude-vscode' }), { codeCmd: CODE }), {
    first: { cmd: CODE, args: [S().cwd] }, waitMs: 1500, url: `vscode://anthropic.claude-code/open?session=${ID}`,
  });
  assert.equal(chatLinkFor(S({ sessionId: ID, entrypoint: 'claude-vscode' })), null, 'no code.cmd → no link (no window step possible)');
  assert.equal(chatLinkFor(S({ sessionId: ID, entrypoint: 'claude-vscode', cwd: '' }), { codeCmd: CODE }), null, 'no cwd');
});

test('Review Focus 2/3: non-UUID ids, terminal chats and missing sessions get no link', () => {
  for (const bad of ['abc', `${ID}&x=1`, `${ID}/x`, '', undefined]) {
    for (const entrypoint of ['claude-desktop', 'claude-vscode']) assert.equal(chatLinkFor(S({ sessionId: bad, entrypoint }), { codeCmd: CODE }), null, `${entrypoint} ${bad}`);
    assert.equal(chatLinkFor(S({ sessionId: bad, entrypoint: 'codex', host: 'desktop' })), null, `codex ${bad}`);
  }
  assert.equal(chatLinkFor(S({ sessionId: ID, entrypoint: 'cli' }), { codeCmd: CODE }), null);
  assert.equal(chatLinkFor(null), null);
});

// Review fixes (17 Nov): the VS Code link is sent only when a VS Code window shows the chat's folder and the
// window step succeeded; one pending open at a time; the whole flow is testable through injected effects.
import { vscodeHoldsFolder, createChatOpener } from '../src/main/focus.js';

test('vscodeHoldsFolder: a title with the folder as its root name, case-insensitive; a worktree or subfolder does not count', () => {
  const titles = ['Skill and agent model se. - arsenal - Visual Studio Code', 'mobi-monorepo - Visual Studio Code'];
  assert.equal(vscodeHoldsFolder(titles, 'c:\\Consortis_projects\\arsenal'), true);
  assert.equal(vscodeHoldsFolder(titles, 'C:\\Consortis_projects\\Mobi-Platform\\MOBI-MONOREPO\\'), true, 'no-editor title and trailing slash');
  assert.equal(vscodeHoldsFolder(titles, 'c:\\Consortis_projects\\arsenal\\.claude\\worktrees\\improve-by-prompt'), false);
  assert.equal(vscodeHoldsFolder(titles, ''), false);
  assert.equal(vscodeHoldsFolder([], 'c:\\x\\arsenal'), false);
});

function harness({ titles = ['x - arsenal - Visual Studio Code'], spawnOk = true, openRejects = false } = {}) {
  const calls = [];
  const timers = [];
  const deps = {
    commandFor: (s) => (s ? { cmd: 'APP', args: [s.sessionId] } : null),
    linkFor: (s) => s.link ?? null,
    spawnQuiet: (cmd, args) => { calls.push(['spawn', cmd, ...args]); return Promise.resolve(spawnOk); },
    windowTitles: async () => { calls.push(['titles']); return titles; },
    openExternal: async (url) => { calls.push(['link', url]); if (openRejects) throw new Error('no handler'); },
    setTimer: (fn, ms) => { const t = { fn, ms }; timers.push(t); calls.push(['wait', ms]); return t; },
    clearTimer: (t) => { t.cleared = true; },
    log: () => {},
  };
  const fire = () => { for (const t of timers.splice(0)) if (!t.cleared) t.fn(); };
  return { open: createChatOpener(deps), calls, fire };
}
const flush = () => new Promise((r) => setImmediate(r));
const VS = (id = 'A', cwd = 'c:\\p\\arsenal') => ({ sessionId: id, cwd, link: { first: { cmd: 'code.cmd', args: [cwd] }, waitMs: 1500, url: `vscode://x/open?session=${id}` } });

test('opener: VS Code chat — titles checked first, then the window step, then the wait, then the link', async () => {
  const h = harness();
  const done = h.open(VS());
  await flush(); h.fire(); const r = await done;
  assert.equal(r, 'link');
  assert.deepEqual(h.calls, [['titles'], ['spawn', 'code.cmd', 'c:\\p\\arsenal'], ['wait', 1500], ['link', 'vscode://x/open?session=A']]);
});

test('opener: no VS Code window shows the folder → today\'s behaviour only, no link', async () => {
  const h = harness({ titles: ['x - other - Visual Studio Code'] });
  assert.equal(await h.open(VS()), 'window-only');
  assert.deepEqual(h.calls, [['titles'], ['spawn', 'APP', 'A']]);
});

test('opener: a failed window step → no link', async () => {
  const h = harness({ spawnOk: false });
  assert.equal(await h.open(VS()), 'window-failed');
  assert.ok(!h.calls.some((c) => c[0] === 'link'));
});

test('opener: a second click cancels the first; only the second link opens', async () => {
  const h = harness();
  const first = h.open(VS('A'));
  await flush();
  const second = h.open(VS('B'));
  await flush(); h.fire();
  assert.equal(await first, 'cancelled');
  assert.equal(await second, 'link');
  assert.deepEqual(h.calls.filter((c) => c[0] === 'link'), [['link', 'vscode://x/open?session=B']]);
});

test('opener: app links open straight away; a rejected link falls back to the app command; no link → app command', async () => {
  const ok = harness();
  const p = ok.open({ sessionId: 'C', link: { url: 'claude://code/continue?session=C' } }); await flush(); ok.fire();
  assert.equal(await p, 'link');
  assert.deepEqual(ok.calls, [['wait', 0], ['link', 'claude://code/continue?session=C']]);
  const bad = harness({ openRejects: true });
  const q = bad.open({ sessionId: 'D', link: { url: 'codex://threads/D' } }); await flush(); bad.fire();
  assert.equal(await q, 'fallback');
  assert.deepEqual(bad.calls.at(-1), ['spawn', 'APP', 'D']);
  const none = harness();
  assert.equal(await none.open({ sessionId: 'E' }), 'app');
  assert.equal(await none.open(null), 'none');
});
