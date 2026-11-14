/**
 * Session names.
 *
 * A session is named workspace--project--verb, so `screen -ls`, the Screens page and a project's row
 * all read as "what is happening to this project". Lowercase letters, digits, dot, dash and
 * underscore only: the name is a file name (its log) and an argument of screen(1).
 */

import crypto from 'crypto';

export const SESSION_RE = /^[a-z0-9][a-z0-9_.-]{0,79}$/;
export const MAX_NAME = 60;

const clean = (s: unknown): string => String(s ?? '').toLowerCase()
  .replace(/[^a-z0-9._-]+/g, '-').replace(/-{3,}/g, '--').replace(/^[-._]+|[-._]+$/g, '');

export function validSession(name: unknown): boolean {
  return SESSION_RE.test(String(name ?? ''));
}

/** workspace--project--verb, shortened with a hash of the whole name when it would pass 60 characters. */
export function sessionName(workspace: unknown, project: unknown, verb: unknown): string {
  const parts = [clean(workspace), clean(project), clean(verb)].filter(Boolean);
  const name = parts.join('--') || 'session';
  if (name.length <= MAX_NAME) return name;
  const hash = crypto.createHash('sha1').update(name).digest('hex').slice(0, 6);
  return `${name.slice(0, MAX_NAME - 7).replace(/[-._]+$/, '')}-${hash}`;
}

/** The verb of a command file: cmd-tools-backup-dev.sh is "tools-backup-dev", a builder is "build". */
export function verbOfScript(script: string): string {
  const base = String(script).replace(/^.*\//, '').replace(/^cmd-/, '').replace(/\.sh$/, '');
  return /-project$/.test(base) ? 'build' : clean(base);
}

/** A second run of the same thing while the first is alive: the name with -2, -3… */
export function freeName(name: string, taken: (n: string) => boolean): string {
  if (!taken(name)) return name;
  for (let i = 2; i < 100; i += 1) {
    const next = `${name.slice(0, MAX_NAME - 4)}-${i}`;
    if (!taken(next)) return next;
  }
  return `${name.slice(0, MAX_NAME - 9)}-${Date.now().toString(36)}`;
}
