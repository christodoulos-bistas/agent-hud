import path from 'node:path';

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
