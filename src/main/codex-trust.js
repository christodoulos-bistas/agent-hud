import path from 'node:path';
import { spawn } from 'node:child_process';
import readline from 'node:readline';

const normPath = (p) => path.win32.normalize(p).toLowerCase();

// The HUD's own hook: user layer, not managed, our hooks file, our exact command. Trust status is ignored.
export function isOurs(hook, { hooksPath, command }) {
  return !!hook && hook.source === 'user' && hook.isManaged === false
    && typeof hook.sourcePath === 'string' && normPath(hook.sourcePath) === normPath(hooksPath)
    && hook.command === command;
}

// Every hook in a hooks/list result, deduped by key (the same hook can appear under several cwds).
function uniqueHooks(listResult) {
  const data = Array.isArray(listResult?.data) ? listResult.data : [];
  const byKey = new Map();
  for (const entry of data) {
    if (!Array.isArray(entry?.hooks)) continue;
    for (const h of entry.hooks) if (h && typeof h.key === 'string' && !byKey.has(h.key)) byKey.set(h.key, h);
  }
  return [...byKey.values()];
}

// Our hooks that Codex has not trusted yet: what the trust edits must cover.
export function pickOurUntrusted(listResult, opts) {
  return uniqueHooks(listResult)
    .filter((h) => isOurs(h, opts) && h.trustStatus !== 'trusted')
    .map((h) => ({ key: h.key, hash: h.currentHash, event: h.eventName }));
}

// Config edits that record each picked hook's current hash as trusted.
export function trustEdits(picked) {
  return picked.map((p) => ({ keyPath: `hooks.state.${JSON.stringify(p.key)}.trusted_hash`, value: p.hash, mergeStrategy: 'upsert' }));
}

// Counts our hooks and lists their event names split by trust.
export function trustSummary(listResult, opts) {
  const ours = uniqueHooks(listResult).filter((h) => isOurs(h, opts));
  return {
    ours: ours.length,
    trusted: ours.filter((h) => h.trustStatus === 'trusted').map((h) => h.eventName),
    untrusted: ours.filter((h) => h.trustStatus !== 'trusted').map((h) => h.eventName),
  };
}

// Runs the trust step against `codex app-server`, the way the Codex app's own Trust button does:
// hooks/list -> config/batchWrite(trusted_hash edits) -> hooks/list. Never rejects; always kills the child.
export function trustCodexHooks({ exe, hooksPath, command, cwd, timeoutMs = 15000, spawnFn = spawn, env = process.env }) {
  const opts = { hooksPath, command };
  const out = { ok: false, trusted: [], already: [], untrusted: [] };
  if (!exe) return Promise.resolve({ ...out, error: 'not-found' });

  return new Promise((resolve) => {
    let child = null;
    let rl = null;
    let timer = null;
    let settled = false;
    let nextId = 1;
    const pending = new Map();
    const lists = [];

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { rl?.close(); } catch {}
      try { child?.stdin?.destroy(); } catch {}
      try { child?.kill(); } catch {}
      resolve(result);
    };
    const summaryOf = (list) => (list ? trustSummary(list, opts) : null);
    const partial = (error) => {
      const first = summaryOf(lists[0]);
      const last = summaryOf(lists[lists.length - 1]);
      return { ok: false, already: first?.trusted ?? [], trusted: [], untrusted: last?.untrusted ?? [], error };
    };

    const send = (msg) => { child.stdin.write(`${JSON.stringify(msg)}\n`); };
    const request = (method, params) => new Promise((res) => {
      const id = nextId++;
      pending.set(id, res);
      send({ id, method, params });
    });
    // Resolves with the reply's result, or throws 'rpc' when the reply carries an error.
    const call = async (method, params) => {
      const reply = await request(method, params);
      if (reply.gone) throw new Error('exit');
      if (reply.error !== undefined) throw new Error('rpc');
      return reply.result;
    };

    try {
      child = spawnFn(exe.file, [...(exe.args || []), 'app-server'], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'], env });
    } catch {
      return finish({ ...out, error: 'exit' });
    }
    timer = setTimeout(() => finish(partial('timeout')), timeoutMs);
    const onGone = () => { for (const res of pending.values()) res({ gone: true }); pending.clear(); };
    child.on('error', () => { if (!settled) finish(partial('exit')); });
    child.on('close', onGone);
    child.stdin.on('error', () => {});
    rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch { return; }
      const res = msg && pending.get(msg.id);
      if (!res) return;
      pending.delete(msg.id);
      res(msg);
    });

    (async () => {
      try {
        await call('initialize', { clientInfo: { name: 'agent-hud', version: '0.1.0' } });
        send({ method: 'initialized' });
        const first = await call('hooks/list', { cwds: [cwd] });
        lists.push(first);
        const picked = pickOurUntrusted(first, opts);
        if (picked.length === 0) {
          const s = trustSummary(first, opts);
          return finish({ ok: true, trusted: [], already: s.trusted, untrusted: s.untrusted });
        }
        await call('config/batchWrite', { edits: trustEdits(picked), filePath: null, expectedVersion: null, reloadUserConfig: true });
        const second = await call('hooks/list', { cwds: [cwd] });
        lists.push(second);
        const before = trustSummary(first, opts).trusted;
        const after = trustSummary(second, opts);
        finish({ ok: true, trusted: after.trusted.filter((e) => !before.includes(e)), already: before, untrusted: after.untrusted });
      } catch (e) {
        if (e?.message === 'rpc') finish(partial('rpc'));
        else finish(partial('exit'));
      }
    })();
  });
}
