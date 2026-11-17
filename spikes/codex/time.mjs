// Spike timer (throwaway): a local echo endpoint on 127.0.0.1:47998 that answers at once, then times
// N runs of the bridge under each runtime: system node, the installed HUD exe as node, PowerShell.
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const HERE = dirname(fileURLToPath(import.meta.url));
const BRIDGE = join(HERE, 'bridge.cjs');
const HUD = process.env.LOCALAPPDATA + '\\Programs\\Agent HUD\\Agent HUD.exe';
const URL_ = 'http://127.0.0.1:47998/agent-hud/hook';
const payload = JSON.stringify({ session_id: 'spike', hook_event_name: 'PreToolUse', tool_name: 'shell', tool_input: { command: ['echo', 'hi'] }, cwd: 'C:\\x' });
import { spawn } from 'node:child_process';
const srv = spawn('node', ['-e', "require('http').createServer((q,s)=>{q.resume();q.on('end',()=>s.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({ok:true})))}).listen(47998,'127.0.0.1',()=>console.log('up'))"], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => srv.stdout.once('data', r));
const runs = {
  'node (system)': () => spawnSync('node', [BRIDGE, URL_, 's'], { input: payload, encoding: 'utf8', timeout: 20000 }),
  'HUD exe as node': () => spawnSync(HUD, [BRIDGE, URL_, 's'], { input: payload, encoding: 'utf8', timeout: 20000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }),
};
for (const [name, run] of Object.entries(runs)) {
  const t = [];
  let out = '';
  for (let i = 0; i < 6; i++) { const s = performance.now(); const r = run(); t.push(performance.now() - s); out = (r.stdout || '') + (r.stderr ? ' ERR:' + r.stderr.slice(0, 120) : ''); }
  t.shift(); // first run warms the disk cache
  t.sort((a, b) => a - b);
  console.log(`${name.padEnd(16)} median ${Math.round(t[2])} ms  min ${Math.round(t[0])}  max ${Math.round(t[4])}  reply=${out.trim().slice(0, 60)}`);
}
srv.kill();
