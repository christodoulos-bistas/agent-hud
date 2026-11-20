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

export function withBusyNote(question, current, now) {
  if (!current) return question;
  return `${question}\n\n(Agent HUD note: this chat is still working right now. Current step: ${current.doing}, for ${fmtDuration(now - current.startedAt)}. Anything unfinished in the conversation is still running, not interrupted.)`;
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
