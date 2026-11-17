// Fake `codex app-server`: newline-delimited JSON-RPC over stdio. State lives in the JSON file FAKE_CODEX_STATE.
import fs from 'node:fs';
import readline from 'node:readline';

// `node --test test/` also runs this file as if it were a test; only serve when started as the app-server.
if (process.argv[2] !== 'app-server') process.exit(0);

const STATE = process.env.FAKE_CODEX_STATE;
const MODE = process.env.FAKE_CODEX_MODE || 'normal';
const readState = () => JSON.parse(fs.readFileSync(STATE, 'utf8'));

function send(msg) {
  if (MODE === 'noise') process.stdout.write('booting…\n');
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.id === undefined || msg.id === null) return; // notification
  if (MODE === 'hang') return;
  if (msg.method === 'initialize') {
    send({ id: msg.id, result: { userAgent: 'fake' } });
    if (MODE === 'exit') process.exit(3);
  } else if (msg.method === 'hooks/list') {
    const cwd = msg.params?.cwds?.[0] ?? null;
    send({ id: msg.id, result: { data: [{ cwd, hooks: readState().hooks }] } });
  } else if (msg.method === 'config/batchWrite') {
    if (MODE === 'error') { send({ id: msg.id, error: { code: -1, message: 'nope' } }); return; }
    const state = readState();
    for (const edit of msg.params?.edits ?? []) {
      for (const h of state.hooks) if (edit.keyPath === `hooks.state.${JSON.stringify(h.key)}.trusted_hash`) h.trustStatus = 'trusted';
    }
    fs.writeFileSync(STATE, JSON.stringify(state));
    fs.appendFileSync(`${STATE}.writes.jsonl`, `${JSON.stringify(msg.params)}\n`);
    send({ id: msg.id, result: { status: 'ok' } });
  } else {
    send({ id: msg.id, error: { code: -32601, message: 'method not found' } });
  }
});
