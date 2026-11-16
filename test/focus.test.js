import test from 'node:test'; import assert from 'node:assert/strict';
import { openCommandFor } from '../src/main/focus.js';

const S = (o = {}) => ({ sessionId: 's1', pid: 1, cwd: 'c:\\Consortis_projects\\arsenal', kind: 'interactive', name: 'arsenal-e0', nameSource: 'derived', status: 'idle', startedAt: 0, ...o });

test('claude-vscode -> code <cwd> (focuses the window for that folder)', () => {
  assert.deepEqual(openCommandFor(S({ entrypoint: 'claude-vscode' })), { cmd: 'code', args: ['c:\\Consortis_projects\\arsenal'] });
});

test('claude-desktop -> PowerShell AppActivate of the Claude window', () => {
  assert.deepEqual(openCommandFor(S({ entrypoint: 'claude-desktop' })), {
    cmd: 'powershell',
    args: ['-NoProfile', '-Command', "(New-Object -ComObject WScript.Shell).AppActivate('Claude')"],
  });
});

test('any other entrypoint -> open the cwd folder', () => {
  assert.deepEqual(openCommandFor(S({ entrypoint: 'cli' })), { openPath: 'c:\\Consortis_projects\\arsenal' });
  assert.deepEqual(openCommandFor(S({ entrypoint: undefined })), { openPath: 'c:\\Consortis_projects\\arsenal' });
});
