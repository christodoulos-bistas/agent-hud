// Throwaway spike probe: logs Claude Code HTTP hook payloads and answers per --mode.
// Usage: node spikes/hook-probe.mjs --mode log|hold|allow|answer|reply|plan-allow-auto|plan-keep|plan-hold|record [--holdMs 30000]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const mode = opt('mode', 'log');
const holdMs = Number(opt('holdMs', '30000'));
const dir = path.dirname(fileURLToPath(import.meta.url));
const logDir = path.join(dir, 'logs');
fs.mkdirSync(logDir, { recursive: true });
const logFile = path.join(logDir, 'hooks.jsonl');
const repliedSessions = new Set();

function send(res, body) {
  if (body === undefined) {
    res.writeHead(200);
    res.end();
  } else {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  }
}

http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    let body;
    try { body = JSON.parse(raw); } catch { body = { _unparsed: raw }; }
    fs.appendFileSync(logFile, JSON.stringify({ t: Date.now(), mode, url: req.url, headers: req.headers, body }) + '\n');
    const ev = body.hook_event_name;
    const tool = body.tool_name;

    const isPlan = ev === 'PermissionRequest' && tool === 'ExitPlanMode';
    if (mode === 'plan-allow-auto' && isPlan) {
      return send(res, {
        hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow', updatedPermissions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }] } },
        systemMessage: 'Agent HUD · Plan approved (auto-accept edits)',
      });
    }
    if (mode === 'plan-keep' && isPlan) {
      return send(res, {
        hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: 'Keep planning: add a rollback step' } },
        systemMessage: 'Agent HUD · Keep planning: add a rollback step',
      });
    }
    if (mode === 'plan-hold' && isPlan) {
      return setTimeout(() => send(res), holdMs);
    }
    if (mode === 'record' && ev === 'PermissionRequest') {
      return send(res, {
        hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } },
        systemMessage: `Agent HUD · Allowed: ${tool}`,
      });
    }

    if (mode === 'hold' && (ev === 'PermissionRequest' || (ev === 'PreToolUse' && tool === 'AskUserQuestion'))) {
      return setTimeout(() => send(res), holdMs);
    }
    if (mode === 'hold' && ev === 'Stop') {
      return setTimeout(() => send(res), holdMs);
    }
    // Spike 12b: answer ExitPlanMode at PreToolUse (as AskUserQuestion is answered), not at PermissionRequest.
    if (mode === 'plan-pre-allow' && ev === 'PreToolUse' && tool === 'ExitPlanMode') {
      return send(res, {
        hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: 'Agent HUD · Plan approved' },
      });
    }
    if (mode === 'allow' && ev === 'PermissionRequest') {
      return send(res, { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } });
    }
    if (mode === 'answer' && ev === 'PreToolUse' && tool === 'AskUserQuestion') {
      const input = body.tool_input || {};
      const answers = {};
      for (const q of input.questions || []) answers[q.question] = q.options?.[0]?.label ?? '';
      return send(res, {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          updatedInput: { ...input, answers },
        },
      });
    }
    if (mode === 'reply' && ev === 'Stop' && !repliedSessions.has(body.session_id)) {
      repliedSessions.add(body.session_id);
      return send(res, { decision: 'block', reason: 'Spike reply: say the word PINEAPPLE and stop.' });
    }
    send(res);
  });
}).listen(47822, '127.0.0.1', () => console.log(`probe listening on 127.0.0.1:47822 mode=${mode}`));
