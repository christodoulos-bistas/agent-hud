import { spawn } from 'node:child_process';
import nodeFs from 'node:fs';
import path from 'node:path';
import { SIDE_ENTRYPOINT } from './sessions.js';
import { fmtDuration } from '../renderer/format.js';

export const SIDE_ERRORS = {
  notFound: 'Claude Code CLI not found',
  noAnswer: 'Claude gave no answer',
  timeout: 'No answer after 5 minutes',
  refused: "Claude didn't take the side question: this Claude version may have changed how they work. Ask in the chat with /btw.",
};

export function findClaudeExe({ env, home, exists }) {
  const candidates = [];
  if (env.AGENT_HUD_CLAUDE_EXE) candidates.push(env.AGENT_HUD_CLAUDE_EXE);
  if (home) candidates.push(path.win32.join(home, '.local', 'bin', 'claude.exe'));
  const pathVar = env.PATH ?? env.Path ?? '';
  for (const dir of pathVar.split(';')) {
    if (dir) candidates.push(path.win32.join(dir, 'claude.exe'));
  }
  return candidates.find((p) => exists(p)) ?? null;
}

export function childEnv(env) {
  const e = { ...env };
  delete e.ELECTRON_RUN_AS_NODE;
  delete e.CLAUDECODE;
  e.CLAUDE_CODE_ENTRYPOINT = SIDE_ENTRYPOINT;
  return e;
}

export function sideArgs({ sessionId, model }) {
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--resume', sessionId, '--no-session-persistence', '--settings', '{"disableAllHooks":true}'];
  if (model) args.push('--model', model);
  return args;
}

export function requestLines({ question, history }) {
  const request = { subtype: 'side_question', question };
  if (history && history.length) request.history = history;
  return {
    init: JSON.stringify({ type: 'control_request', request_id: 'init', request: { subtype: 'initialize' } }) + '\n',
    ask: JSON.stringify({ type: 'control_request', request_id: 'sq', request }) + '\n',
  };
}

export function parseReply(line) {
  let o;
  try { o = JSON.parse(line); } catch { return null; }
  if (!o || o.type !== 'control_response' || !o.response || o.response.request_id !== 'sq') return null;
  const r = o.response;
  if (r.subtype === 'success') {
    const text = r.response && r.response.response;
    if (typeof text === 'string' && text) return { answer: text };
    return { error: SIDE_ERRORS.noAnswer, detail: 'null response' };
  }
  return { error: SIDE_ERRORS.refused, detail: String(r.error ?? r.subtype ?? 'error') };
}

// The busy note: the chat is thinking or working. With an open step it names the step; between
// steps (working, no step open) it says only that the chat is busy. Otherwise the plain question.
export function withBusyNote(question, current, now, { working = false } = {}) {
  if (current) return `${question}\n\n(Agent HUD note: this chat is still working right now. Current step: ${current.doing}, for ${fmtDuration(now - current.startedAt)}. Anything unfinished in the conversation is still running, not interrupted.)`;
  if (working) return `${question}\n\n(Agent HUD note: this chat is still working right now. Anything unfinished in the conversation is still running, not interrupted.)`;
  return question;
}

export function transcriptPathFor(home, cwd, sessionId) {
  return path.win32.join(home, '.claude', 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${sessionId}.jsonl`);
}

export function modelFromTranscriptTail(text) {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    let o;
    try { o = JSON.parse(lines[i]); } catch { continue; }
    if (o && o.type === 'assistant') {
      const m = o.message && o.message.model;
      if (typeof m === 'string' && m && !m.startsWith('<')) return m;
    }
  }
  return null;
}

const TASKKILL = process.env.SystemRoot ? path.win32.join(process.env.SystemRoot, 'System32', 'taskkill.exe') : 'taskkill.exe';

// Ends a child and everything it started. On Windows child.kill() is TerminateProcess: claude.exe gets
// no chance to remove its ~/.claude/sessions files and its own children (MCP servers) are orphaned,
// so the whole tree goes with taskkill /T /F (no shell). Resolves once taskkill is done (bounded).
export function killTree(child, { platform = process.platform, spawnFn = spawn, waitMs = 3000 } = {}) {
  if (!child) return Promise.resolve();
  if (platform !== 'win32' || !child.pid) {
    try { child.kill(); } catch { /* already gone */ }
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let tk;
    const t = setTimeout(done, waitMs);
    function done() { clearTimeout(t); resolve(); }
    try {
      tk = spawnFn(TASKKILL, ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } catch {
      try { child.kill(); } catch { /* already gone */ }
      return done();
    }
    tk.once('error', () => { try { child.kill(); } catch { /* already gone */ } done(); });
    tk.once('exit', done);
  });
}

const STDERR_KEEP = 2048;
const LINE_KEEP = 300;
const isDir = (p) => { try { return nodeFs.statSync(p).isDirectory(); } catch { return false; } };

// Ends a side question's child (after an answer, an abort, a timeout): stdin is closed first, and
// `claude -p --input-format stream-json` exits on EOF and cleans up after itself. Only a child still
// alive after the grace is killed, tree and all (killTree, injectable for the tests).
// On abort (the HUD quitting) the result comes once the child is gone, so quit can wait for it;
// every other result comes at once and the child is reaped in the background.
export function askSide({ exe, sessionId, cwd, question, history = [], model = null, env, spawnFn = spawn,
  timeoutMs = 300000, initFallbackMs = 2000, exitGraceMs = 5000, abortGraceMs = exitGraceMs, signal,
  treeKill = killTree, dirExists = isDir } = {}) {
  if (!exe) return Promise.resolve({ error: SIDE_ERRORS.notFound });
  if (!cwd || !dirExists(cwd)) return Promise.resolve({ error: SIDE_ERRORS.refused, detail: `cwd missing: ${cwd}` });
  return new Promise((resolve) => {
    let settled = false;
    let asked = false;
    let exited = false;
    let child = null;
    let buf = '';
    let stderr = '';
    let lastOut = '';
    const timers = [];
    let gone = null;
    // Closes stdin, waits `graceMs` for the child to leave, then kills its tree. One reap per child.
    const reap = (graceMs) => {
      if (gone) return gone;
      try { child && child.stdin && child.stdin.end(); } catch { /* closed */ }
      if (!child || exited) return (gone = Promise.resolve());
      gone = new Promise((done) => {
        const t = setTimeout(() => {
          if (exited) return done();
          Promise.resolve().then(() => treeKill(child)).catch(() => {}).then(done, done);
        }, graceMs);
        if (t.unref) t.unref();
        child.once('exit', () => { clearTimeout(t); done(); });
      });
      return gone;
    };
    // What the CLI said last: the stderr tail and the last stdout line that wasn't a control message.
    const context = (detail) => {
      const parts = [detail];
      const err = stderr.trim();
      if (err) parts.push(`stderr: ${err}`);
      if (lastOut) parts.push(`stdout: ${lastOut}`);
      return parts.join(' | ');
    };
    const settle = (result, { graceMs = exitGraceMs, waitGone = false } = {}) => {
      if (settled) return;
      settled = true;
      timers.forEach(clearTimeout);
      if (signal) signal.removeEventListener('abort', onAbort);
      const g = reap(graceMs);
      if (waitGone) g.then(() => resolve(result)); else resolve(result);
    };
    const onAbort = () => settle({ error: 'cancelled' }, { graceMs: abortGraceMs, waitGone: true });

    if (signal) {
      if (signal.aborted) return resolve({ error: 'cancelled' });
      signal.addEventListener('abort', onAbort, { once: true });
    }

    const lines = requestLines({ question, history });
    try {
      child = spawnFn(exe.file, [...(exe.args || []), ...sideArgs({ sessionId, model })],
        { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      return settle({ error: SIDE_ERRORS.notFound, detail: err.message });
    }
    const write = (s) => { try { child.stdin.write(s); } catch { /* child gone */ } };
    const ask = () => { if (asked || settled) return; asked = true; write(lines.ask); };

    const onLine = (raw) => {
      const line = raw.trim();
      if (!line) return;
      const reply = parseReply(line);
      if (reply) {
        if (reply.error === SIDE_ERRORS.refused) reply.detail = context(reply.detail);
        return settle(reply);
      }
      let o = null;
      try { o = JSON.parse(line); } catch { /* noise */ }
      if (o && o.type === 'control_response' && o.response && o.response.request_id === 'init') ask();
      if (!o || typeof o.type !== 'string' || !o.type.startsWith('control_')) lastOut = line.slice(0, LINE_KEEP);
    };

    child.on('error', (err) => { exited = true; settle({ error: SIDE_ERRORS.notFound, detail: err.message }); });
    if (child.stdin) child.stdin.on('error', () => {});
    if (child.stderr) {
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-STDERR_KEEP); });
    }
    // The output may still be in flight at 'exit': wait for 'close' (all pipes drained), but never for
    // long, since a grandchild holding a pipe open would keep 'close' away.
    child.on('exit', (code) => {
      exited = true;
      const done = () => {
        clearTimeout(t);
        if (buf.trim()) { const rest = buf; buf = ''; onLine(rest); }
        settle({ error: SIDE_ERRORS.refused, detail: context(`exited ${code}`) });
      };
      const t = setTimeout(done, 200);
      child.once('close', done);
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let nl;
      while (!settled && (nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        onLine(line);
      }
    });

    timers.push(setTimeout(ask, initFallbackMs));
    timers.push(setTimeout(() => settle({ error: SIDE_ERRORS.timeout }), timeoutMs));
    write(lines.init);
  });
}
