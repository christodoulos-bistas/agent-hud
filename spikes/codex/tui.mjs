// Spike (throwaway): interactive Codex in this terminal, in a scratch folder, with the spike hooks passed as
// config overrides (nothing written to ~/.codex). node tui.mjs <allow-me|deny-me>
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const HERE = dirname(fileURLToPath(import.meta.url));
const PROJ = 'C:\\Consortis_projects\\agent-hud-spike\\codex-proj';
mkdirSync(PROJ, { recursive: true });
const CODEX = process.env.LOCALAPPDATA + '\\OpenAI\\Codex\\bin\\9e1da79431da526b\\codex.exe';
const word = process.argv[2] || 'allow-me';
const hook = `[{matcher="",hooks=[{type="command",command='${join(HERE, 'bridge.cmd')}',timeout=120}]}]`;
const args = ['--dangerously-bypass-hook-trust', '-C', PROJ, '-s', 'read-only', '-a', 'on-request',
  ...['PreToolUse', 'PermissionRequest', 'PostToolUse', 'Stop', 'SessionStart', 'UserPromptSubmit'].flatMap((e) => ['-c', `hooks.${e}=${hook}`]),
  `The sandbox is read-only, so run this one shell command with escalated permissions, asking for approval first (sandbox_permissions require_escalated, with a short justification): echo ${word} > out-${word}.txt  Do not try anything else. Then say in one line whether it ran or was refused.`];
spawn(CODEX, args, { stdio: 'inherit' }).on('exit', (c) => process.exit(c ?? 0));
