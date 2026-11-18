// Spike 13: set RECORD=1 to answer EVERY PermissionRequest with allow + systemMessage "Agent HUD · Allowed: <tool>".
// Spike receiver (throwaway) on 127.0.0.1:47997: logs every Codex hook event to events.jsonl and answers
// PermissionRequest with allow when the command mentions "allow-me", deny when it mentions "deny-me".
import http from 'node:http';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const LOG = join(dirname(fileURLToPath(import.meta.url)), 'events.jsonl');
http.createServer((req, res) => {
  let body = '';
  req.setEncoding('utf8');
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    let ev = {};
    try { ev = JSON.parse(body); } catch { /* keep raw */ }
    const cmd = JSON.stringify(ev.tool_input ?? '');
    let reply = '';
    if (ev.hook_event_name === 'PermissionRequest') {
      const behavior = cmd.includes('deny-me') ? 'deny' : cmd.includes('allow-me') ? 'allow' : null;
      if (behavior) reply = JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior, ...(behavior === 'deny' ? { message: 'Denied from the HUD spike' } : {}) } } });
    }
    if (process.env.RECORD && ev.hook_event_name === 'PermissionRequest') {
      reply = JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } }, systemMessage: `Agent HUD · Allowed: ${ev.tool_name}` });
    }
    appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), source: req.headers['x-agent-hud-source'], event: ev.hook_event_name, keys: Object.keys(ev), tool: ev.tool_name, inputKeys: ev.tool_input && typeof ev.tool_input==='object' ? Object.keys(ev.tool_input) : typeof ev.tool_input, input: cmd.slice(0, 160), session: ev.session_id, reply: reply || null }) + '\n');
    const wait = ev.hook_event_name === 'PermissionRequest' ? Number(process.env.DELAY_MS || 0) : 0; // spike 7b: hold like the HUD would
    setTimeout(() => res.writeHead(200, { 'content-type': 'application/json' }).end(reply), wait);
  });
}).listen(47997, '127.0.0.1', () => console.log('receiver up'));
