// Fake `claude -p --input-format stream-json` for side-ask tests.
// Exits at once unless started with -p (node --test also executes files under test/fixtures).
import fs from 'node:fs';
import readline from 'node:readline';

if (!process.argv.includes('-p')) process.exit(0);

const env = process.env;
if (env.FAKE_CLAUDE_OUT) {
  fs.appendFileSync(env.FAKE_CLAUDE_OUT, JSON.stringify({
    pid: process.pid, argv: process.argv.slice(2), cwd: process.cwd(),
    entry: env.CLAUDE_CODE_ENTRYPOINT, runAsNode: env.ELECTRON_RUN_AS_NODE ?? null,
  }) + '\n');
}
const mode = env.FAKE_CLAUDE_MODE || 'answer';
const note = (o) => { if (env.FAKE_CLAUDE_OUT) fs.appendFileSync(env.FAKE_CLAUDE_OUT, JSON.stringify(o) + '\n'); };
const send = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const reply = (id, response, extra = {}) => send({ type: 'control_response', response: { subtype: 'success', request_id: id, response, ...extra } });

if (mode === 'hang' || mode === 'hang-eof') {
  // hang: ignores EOF (only a kill ends it); hang-eof: exits on EOF like the real CLI.
  process.stdin.on('end', () => { note({ event: 'stdin-end' }); if (mode === 'hang-eof') process.exit(0); });
  process.stdin.resume();
  setInterval(() => {}, 1000);
} else {
  if (mode === 'answer') send({ type: 'system' });
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    let m; try { m = JSON.parse(line); } catch { return; }
    const sub = m.request && m.request.subtype;
    if (sub === 'initialize') {
      if (mode !== 'noinit') reply('init', {});
    } else if (sub === 'side_question') {
      if (mode === 'exit') process.exit(3);
      if (mode === 'exit-noisy') {
        process.stdout.write('Error: No conversation found with session ID: s1\n', () =>
          process.stderr.write('warn: something\nfatal: cannot resume\n', () => process.exit(1)));
        return;
      }
      if (mode === 'null') return reply('sq', null);
      if (mode === 'error') return send({ type: 'control_response', response: { subtype: 'error', request_id: 'sq', error: 'Unknown subtype' } });
      if (mode === 'split-utf8') {
        const b = Buffer.from(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: 'sq', response: { response: 'Ναι, ξεκίνα' } } }) + '\n');
        const at = b.indexOf(Buffer.from('Ν')) + 1;
        process.stdout.write(b.subarray(0, at));
        return void setTimeout(() => process.stdout.write(b.subarray(at)), 20);
      }
      const text = 'A:' + m.request.question + '|h' + (m.request.history?.length ?? 0);
      if (mode === 'split') {
        const s = JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: 'sq', response: { response: text } } }) + '\n';
        const mid = Math.floor(s.length / 2);
        process.stdout.write(s.slice(0, mid));
        setTimeout(() => process.stdout.write(s.slice(mid)), 20);
      } else {
        reply('sq', { response: text });
      }
    }
  });
  rl.on('close', () => process.exit(0));
}
