// Spike (throwaway): one `codex exec` run in a scratch folder with the spike hooks passed as config
// overrides (no files touched in ~/.codex). node run.mjs <allow-me|deny-me>
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const HERE = dirname(fileURLToPath(import.meta.url));
const PROJ = join(HERE, 'proj');
mkdirSync(PROJ, { recursive: true });
const CODEX = process.env.LOCALAPPDATA + '\\OpenAI\\Codex\\bin\\9e1da79431da526b\\codex.exe';
const word = process.argv[2] || 'allow-me';
const hook = `[{matcher="",hooks=[{type="command",command='${join(HERE, 'bridge.cmd')}',timeout=120}]}]`;
const args = ['exec', '--skip-git-repo-check', '--dangerously-bypass-hook-trust', '-C', PROJ, '-s', 'read-only',
  '-c', 'approval_policy="on-request"',
  ...['PreToolUse', 'PermissionRequest', 'PostToolUse', 'Stop', 'SessionStart', 'UserPromptSubmit'].flatMap((e) => ['-c', `hooks.${e}=${hook}`]),
  `The sandbox is read-only, so run this one shell command with escalated permissions, asking for approval first (sandbox_permissions require_escalated, with a short justification): echo ${word} > out-${word}.txt  Do not try anything else. Then say in one line whether it ran or was refused.`];
const s = performance.now();
const r = spawnSync(CODEX, args, { encoding: 'utf8', timeout: 240000 });
console.log(`exit=${r.status} signal=${r.signal} ${Math.round((performance.now() - s) / 1000)}s`);
console.log('--- stdout tail:\n' + String(r.stdout || '').split('\n').slice(-8).join('\n'));
console.log('--- stderr tail:\n' + String(r.stderr || '').split('\n').filter((l) => l.trim()).slice(-12).join('\n'));
