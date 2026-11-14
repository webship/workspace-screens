#!/usr/bin/env node
/**
 * The helper cmd-tools-screens.sh asks about a project that is not on DDEV: which runtime of the
 * container plugins recognises the folder, and the command of a shell or of one command inside it.
 *
 *   node cli.js runtime-id    <settings.yml> <project dir> <project>
 *   node cli.js runtime-shell <settings.yml> <project dir> <project>
 *   node cli.js runtime-exec  <settings.yml> <project dir> <project> <command>
 *
 * The answer is one line on stdout; a folder nothing recognises is said on stderr, exit 3.
 */

import fs from 'fs';
import path from 'path';

import { familyRuntimes, guarded, noRuntimeMessage, runtimesOf } from './lib/runtime';

/** The plugins turned on in settings.yml: the names under `plugins:` whose block says enabled: true. */
export function enabledPlugins(text: string): Set<string> {
  const on = new Set<string>();
  let inside = false;
  let name = '';
  for (const line of String(text).split('\n')) {
    if (/^plugins:\s*$/.test(line)) { inside = true; continue; }
    if (!inside) continue;
    if (/^\S/.test(line)) break;
    const m = line.match(/^ {2}([a-z0-9-]+):\s*$/);
    if (m) { name = m[1]; continue; }
    if (name && /^ {4}enabled:\s*["']?true["']?\s*$/.test(line)) on.add(name);
  }
  return on;
}

export function main(argv: string[]): number {
  const [verb, settingsFile, projectDir, project, command] = argv;
  if (!/^runtime-(id|shell|exec)$/.test(String(verb)) || !settingsFile || !projectDir || !project) {
    process.stderr.write('usage: cli.js runtime-id|runtime-shell|runtime-exec <settings.yml> <project dir> <project> [command]\n');
    return 2;
  }
  let text = '';
  try { text = fs.readFileSync(settingsFile, 'utf8'); } catch (_) { text = ''; }
  const on = enabledPlugins(text);
  const app = path.resolve(path.dirname(settingsFile), '..', 'workspace-app');
  const family = familyRuntimes((id) => on.has(id), (name) => require(require.resolve(name, { paths: [app, process.cwd(), __dirname] })));
  const rt = runtimesOf(projectDir, project, family)[0];
  if (!rt) { process.stderr.write(`${noRuntimeMessage(family)}\n`); return 3; }
  if (verb === 'runtime-id') process.stdout.write(`${rt.id}\n`);
  else if (verb === 'runtime-shell') process.stdout.write(`${guarded(rt, rt.shell)}\n`);
  else process.stdout.write(`${guarded(rt, rt.exec(String(command || '')))}\n`);
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
