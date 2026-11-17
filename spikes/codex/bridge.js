// Spike bridge (throwaway): Codex runs this as a command hook. It reads the hook's JSON from stdin,
// POSTs it to a local HTTP endpoint, and prints the endpoint's reply on stdout (the hook's answer).
// Any failure prints nothing and exits 0, so Codex falls back to its own behaviour.
// node bridge.js <url> <secret>   (or: ELECTRON_RUN_AS_NODE=1 "Agent HUD.exe" bridge.js <url> <secret>)
const http = require('http');
const [url, secret] = process.argv.slice(2);
let body = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { body += c; });
process.stdin.on('end', () => {
  const u = new URL(url);
  const req = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: 'POST',
    headers: { 'content-type': 'application/json', 'x-agent-hud': secret || '', 'x-agent-hud-source': 'codex' } }, (res) => {
    let out = '';
    res.setEncoding('utf8');
    res.on('data', (c) => { out += c; });
    res.on('end', () => { if (res.statusCode === 200 && out) process.stdout.write(out); process.exit(0); });
  });
  req.on('error', () => process.exit(0));
  req.setTimeout(600000, () => { req.destroy(); process.exit(0); });
  req.end(body);
});
