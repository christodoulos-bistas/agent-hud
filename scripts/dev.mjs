// `npm run dev`: start the dev build pointed at the spike's settings file, never the user's own
// ~/.claude/settings.json. Extra arguments are passed through to Electron (e.g. --no-first-run).
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

const SPIKE_SETTINGS = 'C:\\Consortis_projects\\agent-hud-spike\\.claude\\settings.local.json';
// Codex: DEV_CODEX_TARGET = null (spike 9: Codex does not load project-layer hooks in an untrusted folder),
// so AGENT_HUD_CODEX_HOOKS_PATH is deliberately not set: a dev build's Codex target is blocked and
// `npm run dev` never writes ~/.codex/hooks.json. Set it by hand for tests or manual use only.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const child = spawn(electron, [root, ...process.argv.slice(2)], {
  stdio: 'inherit',
  windowsHide: false,
  env: { ...process.env, AGENT_HUD_SETTINGS_PATH: SPIKE_SETTINGS },
});
child.on('error', (err) => { console.error('[dev]', err.message); process.exit(1); });
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
