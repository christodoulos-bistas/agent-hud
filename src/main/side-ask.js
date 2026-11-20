import { spawn } from 'node:child_process';
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

export function askSide({ exe, sessionId, cwd, question, history = [], model = null, env, spawnFn = spawn,
  timeoutMs = 300000, initFallbackMs = 2000, exitGraceMs = 5000, signal } = {}) {
  if (!exe) return Promise.resolve({ error: SIDE_ERRORS.notFound });
  return new Promise((resolve) => {
    let settled = false;
    let asked = false;
    let exited = false;
    let child = null;
    let buf = '';
    const timers = [];
    const kill = () => { try { if (child && !exited) child.kill(); } catch { /* already gone */ } };
    const settle = (result) => {
      if (settled) return;
      settled = true;
      timers.forEach(clearTimeout);
      if (signal) signal.removeEventListener('abort', onAbort);
      try { child && child.stdin.end(); } catch { /* closed */ }
      if (!exited) {
        const t = setTimeout(kill, exitGraceMs);
        if (t.unref) t.unref();
        if (child) child.once('exit', () => clearTimeout(t));
      }
      resolve(result);
    };
    const onAbort = () => { kill(); settle({ error: 'cancelled' }); };

    if (signal) {
      if (signal.aborted) return resolve({ error: 'cancelled' });
      signal.addEventListener('abort', onAbort, { once: true });
    }

    const lines = requestLines({ question, history });
    try {
      child = spawnFn(exe.file, [...(exe.args || []), ...sideArgs({ sessionId, model })],
        { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    } catch (err) {
      return settle({ error: SIDE_ERRORS.notFound, detail: err.message });
    }
    const write = (s) => { try { child.stdin.write(s); } catch { /* child gone */ } };
    const ask = () => { if (asked || settled) return; asked = true; write(lines.ask); };

    child.on('error', (err) => { exited = true; settle({ error: SIDE_ERRORS.notFound, detail: err.message }); });
    if (child.stdin) child.stdin.on('error', () => {});
    child.on('exit', (code) => {
      exited = true;
      settle({ error: SIDE_ERRORS.refused, detail: `exited ${code}` });
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const reply = parseReply(line);
        if (reply) return settle(reply);
        try {
          const o = JSON.parse(line);
          if (o && o.type === 'control_response' && o.response && o.response.request_id === 'init') ask();
        } catch { /* noise */ }
      }
    });

    timers.push(setTimeout(ask, initFallbackMs));
    timers.push(setTimeout(() => { kill(); settle({ error: SIDE_ERRORS.timeout }); }, timeoutMs));
    write(lines.init);
  });
}
