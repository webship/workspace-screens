/**
 * screen(1): what it lists, how a session is started, where its sockets are, how to attach.
 */

import fs from 'fs';
import path from 'path';

import type { LiveRow } from './store';

export const shq = (v: unknown): string => `'${String(v).replace(/'/g, `'\\''`)}'`;

/** The rows of `screen -ls`: "\t<pid>.<name>\t(<date>)\t(<state>)". */
export function parseScreenLs(out: string): LiveRow[] {
  const rows: LiveRow[] = [];
  for (const line of String(out || '').split('\n')) {
    const m = line.match(/^\s+(\d+)\.(\S+)\s+(?:\(([^)]*)\)\s+)?\(([^)]*)\)/);
    if (m) rows.push({ pid: m[1], session: m[2], started: m[3] || '', state: m[4] || '' });
  }
  return rows;
}

/** What screen says when it cannot use its sockets directory, or '' when it can. */
export function socketsProblem(out: string): string {
  const m = String(out || '').match(/^(Directory '.*' must have mode \d+\.|Cannot (?:make|access) directory .*|You are not the owner of .*|Directory .* must have mode .*)$/m);
  return m ? m[1] : '';
}

/**
 * The sockets directory of the sessions: SCREENDIR for every screen call, or '' for screen's own.
 *
 * 'auto' keeps screen's own directory (the one the host and the dashboard's container share) while
 * this user can use it, and falls back to <log directory>/sockets, inside the workspace, when screen
 * refuses it: a path both sides see under the same name, which needs no root. A directory named in
 * the settings is used as it is. A directory already in the environment (SCREENDIR) wins over both.
 */
export function socketsDir(setting: string, logDir: string, defaultUsable: boolean, env: NodeJS.ProcessEnv = process.env): string {
  if (env.SCREENDIR) return env.SCREENDIR;
  const s = String(setting || 'auto').trim();
  if (s && s !== 'auto') return s.replace(/^~(?=\/|$)/, env.HOME || '~');
  return defaultUsable ? '' : path.join(logDir, 'sockets');
}

/** screen wants its directory to be this user's and closed to everyone else. */
export function ensureSocketsDir(dir: string): void {
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch (_) { /* not ours to change: screen says so itself */ }
}

/** The line a run's session executes: the command, its output on the window and in the log, its exit code noted last. */
export function runLine(command: string, logFile: string, exitFile: string): string {
  return `{ ${command} ; } 2>&1 | tee -a ${shq(logFile)} ; printf '%s %s\\n' "\${PIPESTATUS[0]}" "$(date +%s)" > ${shq(exitFile)}`;
}

/** The line a shell's session executes: nothing sits between the shell and the terminal, and screen keeps the log. */
export function shellLine(command: string, exitFile: string): string {
  return `${command} ; printf '%s %s\\n' "$?" "$(date +%s)" > ${shq(exitFile)}`;
}

export interface StartSpec {
  session: string;
  /** The line bash runs inside the session. */
  line: string;
  /** The screenrc the session runs under, or '' for the user's own. */
  screenrc: string;
  /** Set for a shell: screen itself logs the window to this file. */
  windowLog?: string;
}

/** The arguments of the screen call that starts a detached session. No shell reads them: the line reaches bash as one argument. */
export function startArgs(spec: StartSpec): string[] {
  const args: string[] = [];
  if (spec.screenrc) args.push('-c', spec.screenrc);
  args.push('-T', 'xterm-256color');
  if (spec.windowLog) args.push('-L', '-Logfile', spec.windowLog);
  args.push('-dmS', spec.session, 'bash', '-lc', spec.line);
  return args;
}

/** The environment of a session: a terminal type screen passes colours for, and the sockets directory. */
export function sessionEnv(base: NodeJS.ProcessEnv, sockets: string, interactive: boolean): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, TERM: 'xterm-256color' };
  // screen 4 cannot pass 24-bit colour: a program that believes COLORTERM prints codes screen shows as text.
  delete env.COLORTERM;
  if (sockets) env.SCREENDIR = sockets; else delete env.SCREENDIR;
  // Nobody answers a question in a run; a shell is there to be typed into.
  if (!interactive) env.DDEV_NONINTERACTIVE = 'true';
  return env;
}

export interface AttachHints {
  /** From a terminal on this machine. */
  attach: string;
  /** The same from a machine without screen: through the dashboard's container. Empty when `attach` already goes through it. */
  viaContainer: string;
  /** The user's own terminal command with the attach command in it, or ''. */
  terminal: string;
}

/**
 * How to attach from a terminal of your own. `screen -r` takes a detached session; one that a
 * terminal already has open is shared with `screen -x`. Ctrl-A D detaches again and leaves it running.
 *
 * Where the session is decides the command. A session on the machine (`machine`: the host runner's, or one started in
 * a terminal there) is attached there as it is. A session the plugin started runs where the dashboard runs: in its
 * container, which has a process space of its own (webship/workspace#564), so a terminal on the machine reaches it
 * only through that container.
 */
export function attachHints(session: string, opts: { attached?: boolean; sockets?: string; container?: string; terminalCommand?: string; machine?: boolean }): AttachHints {
  const prefix = opts.sockets ? `SCREENDIR=${shq(opts.sockets).replace(/^'([A-Za-z0-9_./~-]+)'$/, '$1')} ` : '';
  const verb = opts.attached ? '-x' : '-r';
  const through = opts.container
    ? `docker exec -it ${opts.sockets ? `-e SCREENDIR=${opts.sockets} ` : ''}${opts.container} screen ${verb} ${session}` : '';
  const attach = opts.machine ? `screen ${verb} ${session}` : (through || `${prefix}screen ${verb} ${session}`);
  const viaContainer = '';
  const t = String(opts.terminalCommand || '');
  const terminal = t ? (t.includes('{attach}') ? t.replace(/\{attach\}/g, attach) : `${t} ${attach}`) : '';
  return { attach, viaContainer, terminal };
}

/** The container this process runs in, by the name docker knows it under, or '' on a plain machine. */
export function ownContainer(env: NodeJS.ProcessEnv = process.env, exists: (f: string) => boolean = fs.existsSync): string {
  if (!exists('/.dockerenv')) return '';
  if (env.DDEV_SITENAME) return `ddev-${env.DDEV_SITENAME}-web`;
  return env.HOSTNAME || '';
}
