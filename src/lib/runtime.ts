/**
 * Which container runtime a project runs on, and how a shell or one command goes into it.
 *
 * DDEV is the workspace's default and needs no plugin: a project with .ddev/config.yaml is entered
 * with `ddev ssh` and `ddev exec`. Every other runtime belongs to a container family plugin
 * (@webship.co/workspace-docker, -lando, -docksal, -podman, -kubernetes). This file never decides
 * what a Lando or a Compose project looks like: it asks the runtime that plugin exports — its
 * detect() for the project, its shell verb for the command — and only when that plugin is turned on
 * in this workspace. A runtime whose plugin is not here is named as missing, never guessed.
 */

import fs from 'fs';
import path from 'path';

import { shq } from './screen';

/** What a container family plugin exports as `<id>Runtime` (the family's ContainerRuntime). */
export interface FamilyRuntime {
  id: string;
  title: string;
  cli: string;
  cliHint: string;
  detect: (projectDir: string) => { file: string; name?: string; url?: string } | null;
  verbs: Record<string, { kind: string; cmd: (p: any, project: string) => string }>;
  /** One command inside the project's container, when the runtime says how itself. */
  exec?: (p: any, project: string, command: string) => string;
}

export interface ProjectRuntime {
  /** 'ddev', 'docker', 'lando', 'docksal', 'podman', 'kubernetes'. */
  id: string;
  title: string;
  cli: string;
  cliHint: string;
  /** What made it a project of this runtime: '.ddev/config.yaml', 'compose.yaml'. */
  file: string;
  /** The command line of a shell inside the container. */
  shell: string;
  /** The command line that runs one command inside the container. */
  exec: (command: string) => string;
}

export const FAMILY = ['docker', 'lando', 'docksal', 'podman', 'kubernetes'] as const;

// A project that carries the file of a tool built on Compose is asked about that tool first.
const ORDER = ['lando', 'docksal', 'kubernetes', 'docker', 'podman'];

export const packageOf = (id: string): string => `@webship.co/workspace-${id}`;

/** DDEV: the default runtime, part of every workspace. */
export function ddevRuntime(projectDir: string, exists: (f: string) => boolean = fs.existsSync): ProjectRuntime | null {
  if (!exists(path.join(projectDir, '.ddev', 'config.yaml'))) return null;
  return {
    id: 'ddev', title: 'DDEV', cli: 'ddev', cliHint: 'https://docs.ddev.com/en/stable/users/install/', file: '.ddev/config.yaml',
    shell: 'ddev ssh',
    exec: (command) => `ddev exec ${shq(command)}`,
  };
}

/** How one command goes into a family runtime's container: its own exec when it has one, else its shell verb with -c. */
export function familyExec(r: FamilyRuntime, p: unknown, project: string, command: string): string {
  if (typeof r.exec === 'function') return r.exec(p, project, command);
  // Docksal's shell verb takes no command; its exec does.
  if (r.cli === 'fin') return `fin exec ${shq(command)}`;
  return `${r.verbs.shell.cmd(p, project)} -c ${shq(command)}`;
}

/** The family runtimes turned on in this workspace, loaded from their packages. */
export function familyRuntimes(enabled: (id: string) => boolean, load: (name: string) => any): FamilyRuntime[] {
  const out: FamilyRuntime[] = [];
  for (const id of ORDER) {
    if (!enabled(id)) continue;
    try {
      const mod = load(packageOf(id));
      const r = mod && (mod[`${id}Runtime`] || Object.values(mod).find((v: any) => v && v.id === id && typeof v.detect === 'function'));
      if (r && typeof r.detect === 'function' && r.verbs && r.verbs.shell) out.push(r as FamilyRuntime);
    } catch (_) { /* turned on but not installed: named as missing by the caller */ }
  }
  return out;
}

/** Every runtime that recognises the project folder: DDEV first, then the family's. */
export function runtimesOf(projectDir: string, project: string, family: FamilyRuntime[]): ProjectRuntime[] {
  const found: ProjectRuntime[] = [];
  const ddev = ddevRuntime(projectDir);
  if (ddev) found.push(ddev);
  for (const r of family) {
    let p: { file: string } | null = null;
    try { p = r.detect(projectDir); } catch (_) { p = null; }
    if (!p) continue;
    found.push({
      id: r.id, title: r.title, cli: r.cli, cliHint: r.cliHint, file: p.file,
      shell: r.verbs.shell.cmd(p, project),
      exec: (command) => familyExec(r, p, project, command),
    });
  }
  return found;
}

/** The family runtimes this workspace has no plugin for: what a project on one of them is missing. */
export function missingFamily(family: FamilyRuntime[]): string[] {
  const here = new Set(family.map((r) => r.id));
  return FAMILY.filter((id) => !here.has(id));
}

/** Whether a CLI is on the PATH of this process. */
export function cliOnPath(cli: string, env: NodeJS.ProcessEnv = process.env): boolean {
  for (const dir of String(env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    try { fs.accessSync(path.join(dir, cli), fs.constants.X_OK); return true; } catch (_) { /* not here */ }
  }
  return false;
}

/** The command of a session with the "is the CLI here" check in front, so a missing one says so in the log. */
export function guarded(rt: ProjectRuntime, command: string): string {
  const say = `${rt.cli} is not installed here: ${rt.cliHint}`.replace(/"/g, '\\"');
  return `command -v ${rt.cli} >/dev/null 2>&1 || { echo "${say}"; exit 127; }; ${command}`;
}

/** What to say when nothing recognises the folder. */
export function noRuntimeMessage(family: FamilyRuntime[]): string {
  const missing = missingFamily(family);
  return 'No container runtime recognises this folder. DDEV is built in (a project with .ddev/config.yaml)'
    + (missing.length ? `; ${missing.map((id) => id === 'docker' ? 'Docker Compose' : id[0].toUpperCase() + id.slice(1)).join(', ')} come with their Webship Workspace plugins, which are not turned on here (${missing.map(packageOf).join(', ')}).` : '.');
}
