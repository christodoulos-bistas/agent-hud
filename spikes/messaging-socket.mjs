// Spike 14: Claude session messaging socket. Throwaway.
// Default: read-only listing. Never connects. `--send <sessionId>` does the hands-on step.
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const dir = path.join(os.homedir(), '.claude', 'sessions');
const SPIKE_CWD = 'C:\\Consortis_projects\\agent-hud-spike';

const sessions = [];
for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json'))) {
  try { sessions.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))); } catch { /* skip */ }
}

function pipeNames() {
  try { return new Set(fs.readdirSync('\\\\.\\pipe\\').map((n) => n.toLowerCase())); } catch { return null; }
}

function exists(p, pipes) {
  if (!p) return 'no path';
  const m = /^\\\\\.\\pipe\\(.+)$/.exec(p);
  if (m) return pipes ? String(pipes.has(m[1].toLowerCase())) : 'unknown';
  try { fs.statSync(p); return 'true'; } catch { return 'false'; }
}

const sendIdx = process.argv.indexOf('--send');
if (sendIdx < 0) {
  const pipes = pipeNames();
  for (const s of sessions) {
    console.log(JSON.stringify({
      pid: s.pid,
      sessionId: s.sessionId,
      entrypoint: s.entrypoint,
      kind: s.kind,
      messagingSocketPath: s.messagingSocketPath,
      exists: exists(s.messagingSocketPath, pipes),
    }));
  }
} else {
  const id = process.argv[sendIdx + 1];
  const s = sessions.find((x) => x.sessionId === id);
  if (!s) { console.error('no such session'); process.exit(1); }
  if (String(s.cwd || '').toLowerCase() !== SPIKE_CWD.toLowerCase()) {
    console.error(`refused: session cwd is not ${SPIKE_CWD}`);
    process.exit(1);
  }
  const sock = net.connect(s.messagingSocketPath);
  sock.on('connect', () => sock.write(JSON.stringify({ type: 'user_message', text: 'Say PINEAPPLE' }) + '\n'));
  sock.on('data', (d) => console.log('recv:', d.toString('utf8')));
  sock.on('error', (e) => console.log('error:', e.message));
  setTimeout(() => { console.log('done (5s)'); sock.destroy(); process.exit(0); }, 5000);
}
