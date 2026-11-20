// Fake `claude -p --input-format stream-json` for side-ask tests.
// Exits at once unless started with -p (node --test also executes files under test/fixtures).
import fs from 'node:fs';
import readline from 'node:readline';

if (!process.argv.includes('-p')) process.exit(0);

const env = process.env;
if (env.FAKE_CLAUDE_OUT) {
  fs.appendFileSync(env.FAKE_CLAUDE_OUT, JSON.stringify({
    argv: process.argv.slice(2), cwd: process.cwd(),
    entry: env.CLAUDE_CODE_ENTRYPOINT, runAsNode: env.ELECTRON_RUN_AS_NODE ?? null,
  }) + '\n');
}
const mode = env.FAKE_CLAUDE_MODE || 'answer';
const send = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const reply = (id, response, extra = {}) => send({ type: 'control_response', response: { subtype: 'success', request_id: id, response, ...extra } });

if (mode === 'hang') {
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
      if (mode === 'null') return reply('sq', null);
      if (mode === 'error') return send({ type: 'control_response', response: { subtype: 'error', request_id: 'sq', error: 'Unknown subtype' } });
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
