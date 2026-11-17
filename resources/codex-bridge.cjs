// Codex hook bridge: Codex runs this as a command hook (via codex-hook.cmd, using the HUD's own exe as Node).
// It reads the hook's JSON from stdin, POSTs it to the HUD's local hook server, and prints the reply on stdout.
// Every failure path prints nothing and exits 0, so Codex falls back to its own behaviour (fail open).
// CommonJS on purpose, hence .cjs: the repo's package.json is "type":"module".
const http = require('http');
const fs = require('fs');
const path = require('path');

function readConfig(file) {
  try {
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!cfg || !Number.isInteger(cfg.port) || typeof cfg.secret !== 'string' || !cfg.secret) return null;
    return { port: cfg.port, secret: cfg.secret };
  } catch { return null; }
}

// Permission prompts wait for a human; every other event must stay snappy.
function timeoutFor(eventName) {
  return eventName === 'PermissionRequest' ? 590000 : 5000;
}

function forward(stdinText, { port, secret, timeoutMs, connectMs = 2000 }) {
  return new Promise((resolve) => {
    let done = false;
    let req = null;
    const timers = [];
    const finish = (value) => {
      if (done) return;
      done = true;
      timers.forEach(clearTimeout);
      if (req) req.destroy();
      resolve(value);
    };
    try {
      req = http.request({
        host: '127.0.0.1', port, path: '/agent-hud/hook', method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(stdinText),
          'x-agent-hud': secret || '',
          'x-agent-hud-source': 'codex',
        },
      }, (res) => {
        let out = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { out += c; });
        res.on('end', () => finish(res.statusCode === 200 ? out : ''));
        res.on('error', () => finish(''));
        res.on('aborted', () => finish(''));
        res.on('close', () => finish(''));
      });
      req.on('error', () => finish(''));
      req.on('socket', (socket) => {
        if (socket.connecting) {
          const t = setTimeout(() => finish(''), connectMs);
          timers.push(t);
          socket.once('connect', () => clearTimeout(t));
        }
      });
      timers.push(setTimeout(() => finish(''), timeoutMs));
      req.end(stdinText);
    } catch { finish(''); }
  });
}

function readStdin() {
  return new Promise((resolve) => {
    let body = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { body += c; });
    process.stdin.on('end', () => resolve(body));
    process.stdin.on('error', () => resolve(body));
  });
}

async function main() {
  let out = '';
  try {
    const input = await readStdin();
    const cfg = readConfig(path.join(process.env.APPDATA || '', 'agent-hud', 'config.json'));
    if (cfg) {
      let eventName;
      try { eventName = JSON.parse(input).hook_event_name; } catch { /* unparsable: default timeout */ }
      out = await forward(input, { ...cfg, timeoutMs: timeoutFor(eventName) });
    }
  } catch { out = ''; }
  if (out) process.stdout.write(out);
  process.exit(0);
}

module.exports = { readConfig, timeoutFor, forward };
if (require.main === module) main();
