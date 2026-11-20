// Reads the /btw side threads the VS Code Claude panel keeps in each workspace's
// state.vscdb. node:sqlite is imported lazily so this module loads on any Node.
import fs from 'node:fs';
import path from 'node:path';

export const VSCODE_STORAGE = (appData) => path.join(appData, 'Code', 'User', 'workspaceStorage');

const isObj = (v) => v !== null && typeof v === 'object';

export function extractThreads(value) {
  const out = { found: 0, items: [] };
  const walk = (node, depth) => {
    if (depth > 40) return;
    if (typeof node === 'string') {
      const s = node.trimStart();
      if (s[0] !== '{' && s[0] !== '[') return;
      let parsed;
      try { parsed = JSON.parse(s); } catch { return; }
      walk(parsed, depth + 1);
      return;
    }
    if (!isObj(node)) return;
    if (!Array.isArray(node) && isObj(node.sideQuestionThreads) && !Array.isArray(node.sideQuestionThreads)) {
      out.found += 1;
      for (const [key, thread] of Object.entries(node.sideQuestionThreads)) {
        if (!isObj(thread) || !Array.isArray(thread.entries)) continue;
        const sessionId = key.split(' ')[0];
        for (const e of thread.entries) {
          if (isObj(e) && e.kind === 'answer' && typeof e.question === 'string' && typeof e.response === 'string') {
            out.items.push({ sessionId, question: e.question, response: e.response, updatedAt: thread.updatedAt });
          }
        }
      }
    }
    for (const v of Object.values(node)) walk(v, depth + 1);
  };
  try { walk(value, 0); } catch { return { found: 0, items: [] }; }
  return out;
}

const defaultListDbs = (root) => {
  let entries;
  try { entries = fs.readdirSync(root); } catch { return []; }
  return entries.map((e) => path.join(root, e, 'state.vscdb')).filter((p) => fs.existsSync(p));
};

const defaultStatMtime = (p) => fs.statSync(p).mtimeMs;

async function defaultOpenDb(p) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(p, { readOnly: true });
  try {
    return db.prepare("SELECT value FROM ItemTable WHERE value LIKE '%sideQuestionThreads%'").all()
      .map((r) => String(r.value));
  } finally {
    db.close();
  }
}

export function createVscodeReader({
  root,
  listDbs = defaultListDbs,
  statMtime = defaultStatMtime,
  openDb = defaultOpenDb,
  failLimit = 3,
} = {}) {
  const lastMtime = new Map();
  const failures = new Map();
  const badShape = new Set();

  async function pass() {
    const items = [];
    let healthy = true;
    try {
      const dbs = await listDbs(root);
      for (const p of dbs) {
        try {
          const mtime = statMtime(p);
          if (lastMtime.get(p) === mtime) continue;
          const rows = await openDb(p);
          let bad = false;
          for (const row of rows) {
            const r = extractThreads(row);
            if (r.found === 0) bad = true;
            items.push(...r.items);
          }
          if (bad) badShape.add(p); else badShape.delete(p);
          lastMtime.set(p, mtime);
          failures.delete(p);
        } catch {
          failures.set(p, (failures.get(p) || 0) + 1);
        }
      }
      if (badShape.size) healthy = false;
      for (const n of failures.values()) if (n >= failLimit) healthy = false;
    } catch {
      return { items: [], healthy: false };
    }
    return { items, healthy };
  }

  return { pass };
}
