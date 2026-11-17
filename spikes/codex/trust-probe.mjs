// Spike 10 (throwaway): talk to Codex's app-server. `list` prints our view of every hook; `trust <key>` upserts
// that key's trusted_hash via config/batchWrite (the app's own Trust path), then lists again.
import { spawn } from 'node:child_process'; import os from 'node:os';
const [exe, cmd, key] = process.argv.slice(2);
const p = spawn(exe, ['app-server'], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
let id = 0, buf = ''; const waiting = new Map();
const req = (method, params) => new Promise((res) => { waiting.set(++id, res); p.stdin.write(JSON.stringify({ id, method, params }) + '\n'); });
p.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); waiting.get(m.id)?.(m); } catch {} } });
const show = (r) => { for (const d of r.result?.data ?? []) for (const h of d.hooks) console.log(h.key, h.trustStatus, h.currentHash); };
const t = setTimeout(() => { console.log('timeout'); p.kill(); process.exit(1); }, 20000);
await req('initialize', { clientInfo: { name: 'agent-hud', version: '0.1.0' } });
p.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
let list = await req('hooks/list', { cwds: [os.homedir()] });
if (cmd === 'trust') {
  const h = list.result.data.flatMap((d) => d.hooks).find((x) => x.key === key);
  const w = await req('config/batchWrite', { edits: [{ keyPath: `hooks.state.${JSON.stringify(key)}.trusted_hash`, value: h.currentHash, mergeStrategy: 'upsert' }], filePath: null, expectedVersion: null, reloadUserConfig: true });
  console.log('batchWrite ->', JSON.stringify(w).slice(0, 300));
  list = await req('hooks/list', { cwds: [os.homedir()] });
}
show(list); clearTimeout(t); p.kill();
