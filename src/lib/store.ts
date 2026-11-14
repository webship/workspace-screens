/**
 * What a session leaves on disk, and how a session is found again.
 *
 * Nothing about a session is kept in the dashboard's memory. Each one has up to four files in the
 * log directory (<workspace>/.screens by default), written by the dashboard and by
 * cmd-tools-screens.sh alike:
 *
 *   <session>.log    its output
 *   <session>.run    a note of what started it: key=value lines (command, dir, project, workspace, by, kind, runtime, started)
 *   <session>.exit   "<exit code> <epoch seconds>", written by the session's last step
 *   <session>.cwd    the folder the work belongs to (the dashboard's own Screens page reads the same note)
 *
 * A session is "running" while screen lists it and "ended" once it does not; the list is the
 * union of what screen says and what the notes say, so a restart of the dashboard loses nothing.
 */

import fs from 'fs';
import path from 'path';

import { validSession } from './names';

export interface RunNote {
  command: string;
  dir: string;
  project: string;
  workspace: string;
  /** Who started it: 'build form', 'row menu', 'run form', 'terminal'… */
  by: string;
  /** 'run' (a command with a log), 'shell' (a shell in a folder), 'container-shell', 'container-run'. */
  kind: string;
  /** The container runtime the command went into, or ''. */
  runtime: string;
  /** Epoch seconds. */
  started: number;
}

export interface LiveRow { pid: string; session: string; started: string; state: string }

export interface SessionRow {
  session: string;
  /** 'running' while screen lists it, 'ended' after. */
  state: 'running' | 'ended';
  /** Whether a terminal is attached to it right now. */
  attached: boolean;
  /** The exit code of an ended session, or null when it left none (stopped, or killed). */
  exit: number | null;
  /** Epoch seconds it ended at, or 0. */
  ended: number;
  note: RunNote | null;
  log: string;
  pid: string;
}

const EXTENSIONS = ['log', 'run', 'exit', 'cwd'];

export function storeDir(root: string, logDir: string): string {
  return path.isAbsolute(logDir) ? logDir : path.join(root, logDir || '.screens');
}

export const fileOf = (dir: string, session: string, ext: string): string => path.join(dir, `${session}.${ext}`);

const oneLine = (v: unknown): string => String(v ?? '').replace(/[\r\n]+/g, ' ').trim();

export function writeNote(dir: string, session: string, note: RunNote): void {
  fs.mkdirSync(dir, { recursive: true });
  const lines = Object.entries(note).map(([k, v]) => `${k}=${oneLine(v)}`);
  fs.writeFileSync(fileOf(dir, session, 'run'), `${lines.join('\n')}\n`);
  // The note the dashboard's own Screens page and row menus read: whose work this is.
  if (note.dir) fs.writeFileSync(fileOf(dir, session, 'cwd'), `${note.dir}\n`);
}

export function parseNote(text: string): RunNote {
  const got: Record<string, string> = {};
  for (const line of String(text).split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) got[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return {
    command: got.command || '', dir: got.dir || '', project: got.project || '', workspace: got.workspace || '',
    by: got.by || '', kind: got.kind || 'run', runtime: got.runtime || '', started: Number(got.started) || 0,
  };
}

export function readNote(dir: string, session: string): RunNote | null {
  try { return parseNote(fs.readFileSync(fileOf(dir, session, 'run'), 'utf8')); } catch (_) { return null; }
}

export function readExit(dir: string, session: string): { code: number | null; at: number } {
  try {
    const [code, at] = fs.readFileSync(fileOf(dir, session, 'exit'), 'utf8').trim().split(/\s+/);
    return { code: /^\d+$/.test(code) ? Number(code) : null, at: Number(at) || 0 };
  } catch (_) { return { code: null, at: 0 }; }
}

/** Every session that left a note in the directory. */
export function notedSessions(dir: string): string[] {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.run')).map((f) => f.slice(0, -4)).filter(validSession).sort();
  } catch (_) { return []; }
}

/** The list: what screen says is alive, and what the notes say ran. Running first, then the newest. */
export function sessionRows(dir: string, live: LiveRow[]): SessionRow[] {
  const rows = new Map<string, SessionRow>();
  const logOf = (s: string) => (fs.existsSync(fileOf(dir, s, 'log')) ? fileOf(dir, s, 'log') : '');
  for (const l of live) {
    if (!validSession(l.session)) continue;
    rows.set(l.session, { session: l.session, state: 'running', attached: /attached/i.test(l.state), exit: null, ended: 0,
      note: readNote(dir, l.session), log: logOf(l.session), pid: l.pid });
  }
  for (const s of notedSessions(dir)) {
    if (rows.has(s)) continue;
    const exit = readExit(dir, s);
    let ended = exit.at;
    if (!ended) { try { ended = Math.floor(fs.statSync(fileOf(dir, s, 'log')).mtimeMs / 1000); } catch (_) { ended = 0; } }
    rows.set(s, { session: s, state: 'ended', attached: false, exit: exit.code, ended, note: readNote(dir, s), log: logOf(s), pid: '' });
  }
  const when = (r: SessionRow) => (r.state === 'ended' ? r.ended : 0) || (r.note ? r.note.started : 0);
  return [...rows.values()].sort((a, b) => (a.state === b.state ? when(b) - when(a) : a.state === 'running' ? -1 : 1));
}

/** Remove what an ended session left. The caller has checked that screen no longer lists it. */
export function removeSession(dir: string, session: string): string[] {
  if (!validSession(session)) return [];
  const gone: string[] = [];
  for (const ext of EXTENSIONS) {
    const f = fileOf(dir, session, ext);
    try { fs.unlinkSync(f); gone.push(path.basename(f)); } catch (_) { /* was not there */ }
  }
  return gone;
}

/** The ended sessions older than the retention: what a clean removes without being asked twice. */
export function expiredSessions(rows: SessionRow[], retentionDays: number, now = Date.now()): string[] {
  if (!retentionDays) return [];
  const limit = Math.floor(now / 1000) - retentionDays * 86400;
  return rows.filter((r) => r.state === 'ended' && r.ended > 0 && r.ended < limit).map((r) => r.session);
}

// Colour and cursor codes, and what a progress bar leaves: the part of a line after its last carriage return.
const plain = (s: string): string => s.replace(/\x1b\][^\x07]*\x07/g, '').replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b[()][A-Za-z0-9]/g, '')
  .split('\n').map((l) => { const t = l.replace(/\r+$/, ''); const i = t.lastIndexOf('\r'); return i >= 0 ? t.slice(i + 1) : t; }).join('\n');

export interface LogPage { lines: string[]; page: number; pages: number; total: number; truncated: boolean }

/** One page of a log, counted from the start; page 0 (or none) is the last one. Only the last 16 MB of a larger log is read. */
export function logPage(file: string, page = 0, perPage = 200): LogPage {
  const CAP = 16 * 1024 * 1024;
  let text = '';
  let truncated = false;
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const start = Math.max(0, size - CAP);
      truncated = start > 0;
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      text = buf.toString('utf8');
    } finally { fs.closeSync(fd); }
  } catch (_) { return { lines: [], page: 1, pages: 1, total: 0, truncated: false }; }
  const all = plain(text).split('\n');
  if (all.length && all[all.length - 1] === '') all.pop();
  const pages = Math.max(1, Math.ceil(all.length / perPage));
  const p = page >= 1 && page <= pages ? Math.floor(page) : pages;
  return { lines: all.slice((p - 1) * perPage, p * perPage), page: p, pages, total: all.length, truncated };
}
