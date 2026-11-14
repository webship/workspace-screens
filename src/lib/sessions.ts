/**
 * The sessions: start one, list them, stop one, remove what an ended one left.
 *
 * The truth is always asked: `screen -ls` for what is alive, the log directory for what ran. A
 * dashboard that restarts, or a browser tab that closes, changes nothing here.
 */

import fs from 'fs';

import { validSession } from './names';
import { attachHints, ensureSocketsDir, ownContainer, parseScreenLs, runLine, sessionEnv, shellLine, socketsDir, socketsProblem, startArgs } from './screen';
import type { AttachHints } from './screen';
import type { Settings } from './settings';
import { expiredSessions, fileOf, removeSession, sessionRows, storeDir, writeNote } from './store';
import type { RunNote, SessionRow } from './store';

export interface RunAnswer { ok: boolean; code: number; stdout: string; stderr: string }

export interface Deps {
  /** The workspace root. */
  root: string;
  settings: () => Settings;
  /** Run a command with its stdin closed and collect its output (the dashboard's own `run`). */
  run: (cmd: string, args: string[], cwd: string, opts?: { timeoutMs?: number; env?: NodeJS.ProcessEnv }) => Promise<RunAnswer>;
  /** The screenrc the sessions run under. */
  screenrc: string;
  env?: NodeJS.ProcessEnv;
}

export interface StartRequest {
  session: string;
  /** The command line, run by bash in `dir`. */
  command: string;
  dir: string;
  note: Omit<RunNote, 'started' | 'command'> & { command?: string };
  /** A shell: nothing is piped, screen keeps the log, and questions can be answered. */
  interactive?: boolean;
}

export interface StartAnswer { ok: boolean; session: string; already?: boolean; why?: string; log?: string }

export class Sessions {
  private usable: { at: number; ok: boolean; why: string } | null = null;

  constructor(private deps: Deps) {}

  private env(): NodeJS.ProcessEnv { return this.deps.env || process.env; }

  dir(): string { return storeDir(this.deps.root, this.deps.settings().logDir); }

  /** Whether screen can use its own sockets directory here, asked at most twice a minute. */
  private async defaultUsable(): Promise<{ ok: boolean; why: string }> {
    if (this.usable && Date.now() - this.usable.at < 30 * 1000) return this.usable;
    const env = { ...this.env() };
    delete env.SCREENDIR;
    const r = await this.deps.run('screen', ['-ls'], this.deps.root, { timeoutMs: 10 * 1000, env });
    const why = r.code === -1 ? 'screen is not installed here' : socketsProblem(`${r.stdout}\n${r.stderr}`);
    this.usable = { at: Date.now(), ok: !why, why };
    return this.usable;
  }

  /** The sockets directory every screen call of the plugin uses: '' is screen's own. */
  async sockets(): Promise<string> {
    const s = this.deps.settings();
    if (this.env().SCREENDIR || (s.socketsDir && s.socketsDir !== 'auto')) return socketsDir(s.socketsDir, this.dir(), true, this.env());
    return socketsDir('auto', this.dir(), (await this.defaultUsable()).ok, this.env());
  }

  /** Whether screen is installed where the dashboard runs, and what it says about its own directory. */
  async health(): Promise<{ installed: boolean; version: string; sockets: string; defaultProblem: string }> {
    const v = await this.deps.run('screen', ['--version'], this.deps.root, { timeoutMs: 10 * 1000 });
    const installed = v.code !== -1;
    const usable = installed ? await this.defaultUsable() : { ok: false, why: 'screen is not installed here' };
    return { installed, version: (String(v.stdout).match(/\d+\.\d+\.\d+/) || [''])[0], sockets: installed ? await this.sockets() : '', defaultProblem: usable.why };
  }

  private async screen(args: string[], cwd?: string, interactive = false): Promise<RunAnswer> {
    const sockets = await this.sockets();
    if (sockets) ensureSocketsDir(sockets);
    return this.deps.run('screen', args, cwd || this.deps.root, { timeoutMs: 30 * 1000, env: sessionEnv(this.env(), sockets, interactive) });
  }

  async live() { return parseScreenLs((await this.screen(['-ls'])).stdout); }

  async list(): Promise<SessionRow[]> { return sessionRows(this.dir(), await this.live()); }

  async start(req: StartRequest): Promise<StartAnswer> {
    const { session } = req;
    if (!validSession(session)) return { ok: false, session, why: 'a session name is lowercase letters, digits, dot, dash and underscore' };
    if (!fs.existsSync(req.dir)) return { ok: false, session, why: `no such folder: ${req.dir}` };
    const health = await this.deps.run('screen', ['--version'], this.deps.root, { timeoutMs: 10 * 1000 });
    if (health.code === -1) return { ok: false, session, why: 'screen is not installed where the dashboard runs (bash core/scripts/plugins/screens/host-install.sh --check says what to do)' };
    if ((await this.live()).some((r) => r.session === session)) return { ok: false, session, already: true };
    const dir = this.dir();
    const log = fileOf(dir, session, 'log');
    const exit = fileOf(dir, session, 'exit');
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(log, '');
      fs.rmSync(exit, { force: true });
      writeNote(dir, session, { ...req.note, command: req.note.command || req.command, started: Math.floor(Date.now() / 1000) });
    } catch (err) { return { ok: false, session, why: `the log directory cannot be written: ${(err as Error).message}` }; }
    const line = req.interactive ? shellLine(req.command, exit) : runLine(req.command, log, exit);
    const out = await this.screen(startArgs({ session, line, screenrc: this.deps.screenrc, windowLog: req.interactive ? log : undefined }), req.dir, !!req.interactive);
    if (!out.ok) return { ok: false, session, why: (socketsProblem(`${out.stdout}\n${out.stderr}`) || String(out.stderr || out.stdout).trim().slice(-300) || 'screen refused to start it') };
    return { ok: true, session, log };
  }

  /** Stop a session: whatever runs inside it is ended. Only an exact name, never one that merely starts alike. */
  async stop(session: string): Promise<{ ok: boolean; why?: string }> {
    if (!validSession(session)) return { ok: false, why: 'not a session name' };
    const row = (await this.live()).find((r) => r.session === session);
    if (!row) return { ok: false, why: 'no such session is running' };
    const out = await this.screen(['-S', `${row.pid}.${session}`, '-X', 'quit']);
    return out.ok ? { ok: true } : { ok: false, why: String(out.stderr || out.stdout).trim().slice(-200) };
  }

  /** Remove what one ended session left: refused while it is alive. */
  async remove(session: string): Promise<{ ok: boolean; why?: string; files: string[] }> {
    if ((await this.live()).some((r) => r.session === session)) return { ok: false, why: 'it is still running: stop it first', files: [] };
    const files = removeSession(this.dir(), session);
    return { ok: files.length > 0, why: files.length ? undefined : 'nothing of that name is kept', files };
  }

  /** Remove the ended sessions: every one of them, or only those older than the retention. */
  async clean(all: boolean): Promise<string[]> {
    const rows = await this.list();
    const names = all ? rows.filter((r) => r.state === 'ended').map((r) => r.session) : expiredSessions(rows, this.deps.settings().retentionDays);
    const dir = this.dir();
    return names.filter((s) => removeSession(dir, s).length > 0);
  }

  async hints(row: Pick<SessionRow, 'session' | 'attached'>): Promise<AttachHints> {
    return attachHints(row.session, { attached: row.attached, sockets: await this.sockets(), container: ownContainer(this.env()), terminalCommand: this.deps.settings().terminalCommand });
  }
}
