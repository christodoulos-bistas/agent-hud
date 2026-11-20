// Per-chat side-question log: one JSON Lines file per chat under `dir`.
import nodeFs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const ID_RE = /^[A-Za-z0-9-]{8,64}$/;

export function validSessionId(sessionId) {
  return typeof sessionId === 'string' && ID_RE.test(sessionId);
}

export function createSideLog({
  dir,
  now = Date.now,
  fs = nodeFs,
  newId = () => 'h' + randomUUID().slice(0, 12),
}) {
  // sessionId -> { entries, stamp }: the stamp is the file's mtime and size when the cache last saw it,
  // so a log deleted or changed on disk while the HUD runs is read again (and never resurrected).
  const cache = new Map();

  const fileOf = (sessionId) => path.join(dir, sessionId + '.jsonl');
  const stampOf = (sessionId) => {
    try { const st = fs.statSync(fileOf(sessionId)); return st.mtimeMs + ':' + st.size; } catch { return 'none'; }
  };
  const restamp = (sessionId) => { const c = cache.get(sessionId); if (c) c.stamp = stampOf(sessionId); };

  function load(sessionId) {
    const stamp = stampOf(sessionId);
    const c = cache.get(sessionId);
    if (c && c.stamp === stamp) return c.entries;
    const entries = [];
    let text = '';
    try {
      text = fs.readFileSync(fileOf(sessionId), 'utf8');
    } catch {
      text = '';
    }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        if (e && typeof e === 'object' && typeof e.id === 'string' && typeof e.question === 'string') {
          entries.push(e);
        }
      } catch {
        // corrupt line: skip
      }
    }
    cache.set(sessionId, { entries, stamp });
    return entries;
  }

  function appendLines(sessionId, entries) {
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(fileOf(sessionId), entries.map((e) => JSON.stringify(e) + '\n').join(''));
  }

  const copy = (e) => ({ ...e });

  function list(sessionId) {
    if (!validSessionId(sessionId)) return [];
    return load(sessionId).map(copy);
  }

  function add(sessionId, { source, question, response = null, error, at } = {}) {
    if (!validSessionId(sessionId)) return null;
    const entries = load(sessionId);
    const entry = { id: newId(), at: at ?? now(), source, question, response };
    if (error !== undefined) entry.error = error;
    appendLines(sessionId, [entry]);
    entries.push(entry);
    restamp(sessionId);
    return copy(entry);
  }

  function remove(sessionId, entryId) {
    if (!validSessionId(sessionId)) return false;
    const entries = load(sessionId);
    const idx = entries.findIndex((e) => e.id === entryId);
    if (idx < 0) return false;
    const next = entries.filter((e) => e.id !== entryId);
    // Atomic rewrite; throws on I/O failure (cache left untouched in that case).
    const file = fileOf(sessionId);
    const tmp = file + '.tmp';
    fs.mkdirSync(dir, { recursive: true });
    try {
      fs.writeFileSync(tmp, next.map((e) => JSON.stringify(e) + '\n').join(''));
      fs.renameSync(tmp, file);
    } catch (err) {
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
      throw err;
    }
    cache.set(sessionId, { entries: next, stamp: stampOf(sessionId) });
    return true;
  }

  function importVscode(items) {
    const changed = [];
    const list_ = Array.isArray(items) ? items : [];
    for (let i = 0; i < list_.length; ) {
      let j = i;
      while (j + 1 < list_.length && list_[j + 1]?.sessionId === list_[i]?.sessionId) j++;
      const batch = list_.slice(i, j + 1);
      i = j + 1;
      const sessionId = batch[0]?.sessionId;
      if (!validSessionId(sessionId)) continue;
      const entries = load(sessionId);
      const seen = new Set(entries.map((e) => e.id));
      const fresh = [];
      batch.forEach((it, k) => {
        const question = it.question;
        const response = it.response;
        const id =
          'v' +
          createHash('sha1')
            .update(sessionId + '\n' + question + '\n' + response)
            .digest('hex')
            .slice(0, 16);
        if (seen.has(id)) return;
        seen.add(id);
        const last = k === batch.length - 1;
        const at = last && Number.isFinite(it.updatedAt) ? it.updatedAt : now();
        fresh.push({ id, at, source: 'vscode', question, response });
      });
      if (!fresh.length) continue;
      appendLines(sessionId, fresh);
      entries.push(...fresh);
      restamp(sessionId);
      changed.push(sessionId);
    }
    return changed;
  }

  function history(sessionId, n = 10) {
    if (!validSessionId(sessionId)) return [];
    return load(sessionId)
      .filter((e) => typeof e.response === 'string')
      .slice(-n)
      .map((e) => ({ question: e.question, response: e.response }));
  }

  function count(sessionId) {
    return validSessionId(sessionId) ? load(sessionId).length : 0;
  }

  return { validId: validSessionId, list, add, remove, importVscode, history, count };
}
