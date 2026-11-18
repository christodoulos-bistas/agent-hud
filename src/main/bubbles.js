import path from 'node:path';
import { patchPaths } from './steps.js';

const MAX = 60;
const squash = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const cut = (s) => { const c = squash(s); return c.length > MAX ? c.slice(0, MAX) + '…' : c; };
const base = (p) => path.win32.basename(String(p ?? ''));

function host(url) {
  try { return new URL(String(url)).hostname; } catch { return cut(url); }
}

function permissionLine(p) {
  const name = String(p.tool_name ?? '') || 'tool';
  const i = p.tool_input && typeof p.tool_input === 'object' ? p.tool_input : {};
  let detail = '';
  switch (name) {
    case 'Bash': case 'PowerShell': detail = cut(i.command); break;
    case 'Edit': case 'Write': case 'MultiEdit': case 'Read': case 'NotebookEdit': detail = base(i.file_path ?? i.notebook_path); break;
    case 'apply_patch': detail = base(patchPaths(i.command)[0] || ''); break;
    case 'WebFetch': detail = i.url ? host(i.url) : ''; break;
    default: detail = '';
  }
  return detail ? `${name}: ${detail}` : name;
}

function choiceLine(p) {
  const i = p.tool_input && typeof p.tool_input === 'object' ? p.tool_input : {};
  const qs = Array.isArray(i.questions) ? i.questions.filter((q) => q && typeof q === 'object') : [];
  if (!qs.length) return 'asks a question';
  const q = qs[0];
  const n = Array.isArray(q.options) ? q.options.length : 0;
  const header = squash(q.header);
  let line;
  if (header) line = n ? `${cut(header)} · ${n} option${n === 1 ? '' : 's'}` : cut(header);
  else line = cut(q.question) || 'asks a question';
  if (qs.length > 1) line += ` · +${qs.length - 1} more`;
  return line;
}

// Steps are the plan's markdown headings # to ###; a plan without any counts its non-empty lines.
const HEADING = /^ {0,3}#{1,3}(?:[ \t]|$)/;
function planLine(p) {
  const i = p.tool_input && typeof p.tool_input === 'object' ? p.tool_input : {};
  const lines = String(String(i.plan ?? '').trim() ? i.plan : (p.plan ?? '')).split(/\r?\n/).filter((l) => l.trim());
  const steps = lines.filter((l) => HEADING.test(l)).length;
  if (steps) return `Plan ready · ${steps} step${steps === 1 ? '' : 's'}`;
  return `Plan ready · ${lines.length} line${lines.length === 1 ? '' : 's'}`;
}

export function bubbleLine(item) {
  try {
    const p = (item && item.payload && typeof item.payload === 'object') ? item.payload : {};
    switch (item?.kind) {
      case 'permission': return permissionLine(p);
      case 'choice': return choiceLine(p);
      case 'plan': return planLine(p);
      case 'reply': return cut(p.last_assistant_message) || 'wants a reply';
      default: return '';
    }
  } catch { return ''; }
}
