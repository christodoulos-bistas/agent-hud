// Spike (throwaway): interactive Codex in this terminal, in a scratch folder.
//   node tui.mjs <allow-me|deny-me> [overrides|project] [shell|patch]
// overrides (default): the spike hooks are passed as `-c hooks.*` overrides, nothing written to ~/.codex.
// project: NO overrides; hooks must come from <scratch>\.codex\hooks.json (spike 9, project-layer hooks).
// patch: the prompt asks for an apply_patch (create a file) instead of a shell command.
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const HERE = dirname(fileURLToPath(import.meta.url));
const word = process.argv[2] || 'allow-me';
const MODE = process.argv[3] || 'overrides';
const TOOL = process.argv[4] || 'shell';
const PROJ = 'C:\\Consortis_projects\\agent-hud-spike\\' + (MODE.startsWith('project') ? 'hooks-proj' : 'codex-proj');
mkdirSync(PROJ, { recursive: true });
const BIN = process.env.LOCALAPPDATA + '\\OpenAI\\Codex\\bin';
const CODEX = readdirSync(BIN)
  .map((d) => BIN + '\\' + d + '\\codex.exe')
  .filter((p) => { try { return statSync(p).isFile(); } catch { return false; } })
  .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
const hook = `[{matcher="",hooks=[{type="command",command='${join(HERE, 'bridge.cmd')}',timeout=120}]}]`;
const overrides = MODE === 'project' ? [] :
  ['PreToolUse', 'PermissionRequest', 'PostToolUse', 'Stop', 'SessionStart', 'UserPromptSubmit'].flatMap((e) => ['-c', `hooks.${e}=${hook}`]);
const prompt = TOOL === 'patch'
  ? `The sandbox is read-only. Use the apply_patch tool to create a new file named patch-${word}.txt containing the single line ${word}. Do not use the shell. Then say in one line whether it was applied or refused.`
  : `The sandbox is read-only, so run this one shell command with escalated permissions, asking for approval first (sandbox_permissions require_escalated, with a short justification): echo ${word} > out-${word}.txt  Do not try anything else. Then say in one line whether it ran or was refused.`;
const args = ['--dangerously-bypass-hook-trust', '-C', PROJ, '-s', 'read-only', '-a', 'on-request', ...overrides, prompt];
spawn(CODEX, args, { stdio: 'inherit' }).on('exit', (c) => process.exit(c ?? 0));
