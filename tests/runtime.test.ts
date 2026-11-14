import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { enabledPlugins, main } from '../src/cli';
import { cliOnPath, ddevRuntime, familyExec, familyRuntimes, guarded, missingFamily, noRuntimeMessage, packageOf, runtimesOf } from '../src/lib/runtime';
import type { FamilyRuntime } from '../src/lib/runtime';

const project = (files: string[]): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'screens-rt-'));
  for (const f of files) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), ''); }
  return dir;
};

// What a container family plugin exports: only its shape matters here.
const fake = (id: string, cli: string, file: string, shell: string, extra: Partial<FamilyRuntime> = {}): FamilyRuntime => ({
  id, title: id.toUpperCase(), cli, cliHint: `https://example.org/${id}`,
  detect: (dir) => (fs.existsSync(path.join(dir, file)) ? { file } : null),
  verbs: { shell: { kind: 'shell', cmd: () => shell } }, ...extra,
});
const docker = fake('docker', 'docker', 'compose.yaml', 'docker compose -f compose.yaml exec web sh');
const lando = fake('lando', 'lando', '.lando.yml', 'lando ssh');
const docksal = fake('docksal', 'fin', '.docksal/docksal.yml', 'fin bash');
const kube = fake('kubernetes', 'kubectl', 'k8s/deploy.yaml', 'kubectl exec -it deploy/app -- sh');

test('DDEV needs no plugin: a project with .ddev/config.yaml is entered with ddev ssh and ddev exec', () => {
  const rt = ddevRuntime(project(['.ddev/config.yaml']));
  assert.ok(rt);
  assert.strictEqual(rt!.shell, 'ddev ssh');
  assert.strictEqual(rt!.exec('wp plugin list --status=active'), `ddev exec 'wp plugin list --status=active'`);
  assert.strictEqual(rt!.exec("echo it's"), `ddev exec 'echo it'\\''s'`);
  assert.strictEqual(ddevRuntime(project(['compose.yaml'])), null);
});

test('a family runtime is asked through the package its plugin exports, and only when that plugin is turned on', () => {
  const mods: Record<string, unknown> = {
    [packageOf('docker')]: { dockerRuntime: docker, register: () => undefined },
    [packageOf('lando')]: { landoRuntime: lando },
    [packageOf('podman')]: { somethingElse: 1 },
  };
  const asked: string[] = [];
  const load = (name: string) => { asked.push(name); if (!(name in mods)) throw new Error('not installed'); return mods[name]; };
  const on = new Set(['docker', 'lando', 'podman', 'kubernetes']);
  const fam = familyRuntimes((id) => on.has(id), load);
  assert.deepStrictEqual(fam.map((r) => r.id), ['lando', 'docker'], 'lando before docker; podman exports no runtime, kubernetes is not installed');
  assert.ok(!asked.includes(packageOf('docksal')), 'a plugin that is not turned on is never loaded');
  assert.deepStrictEqual(missingFamily(fam), ['docksal', 'podman', 'kubernetes']);
  assert.deepStrictEqual(familyRuntimes(() => false, load), []);
});

test('the project is whatever its runtime says it is: detection is the provider\'s', () => {
  const fam = [lando, docksal, kube, docker];
  const compose = runtimesOf(project(['compose.yaml']), 'demo', fam);
  assert.deepStrictEqual(compose.map((r) => [r.id, r.file, r.shell]), [['docker', 'compose.yaml', 'docker compose -f compose.yaml exec web sh']]);
  const both = runtimesOf(project(['.ddev/config.yaml', '.lando.yml']), 'demo', fam);
  assert.deepStrictEqual(both.map((r) => r.id), ['ddev', 'lando'], 'DDEV first, then the family');
  assert.deepStrictEqual(runtimesOf(project(['README.md']), 'demo', fam), []);
  const throws = fake('docker', 'docker', 'x', 'sh', { detect: () => { throw new Error('boom'); } });
  assert.deepStrictEqual(runtimesOf(project(['compose.yaml']), 'demo', [throws]), [], 'a provider that throws recognises nothing');
});

test('one command goes in through the runtime\'s own exec, else its shell verb with -c, and Docksal\'s exec', () => {
  assert.strictEqual(familyExec(docker, { file: 'compose.yaml' }, 'demo', 'ls -la'), `docker compose -f compose.yaml exec web sh -c 'ls -la'`);
  assert.strictEqual(familyExec(lando, {}, 'demo', 'drush status'), `lando ssh -c 'drush status'`);
  assert.strictEqual(familyExec(kube, {}, 'demo', 'env'), `kubectl exec -it deploy/app -- sh -c 'env'`);
  assert.strictEqual(familyExec(docksal, {}, 'demo', 'ls'), `fin exec 'ls'`);
  const own = fake('podman', 'podman', 'Containerfile', 'podman exec -it app sh', { exec: (_p, project, c) => `podman exec ${project} ${c}` });
  assert.strictEqual(familyExec(own, {}, 'demo', 'ls'), 'podman exec demo ls');
});

test('a missing CLI is said in the session, and a folder nothing recognises names the plugins that are not here', () => {
  const [rt] = runtimesOf(project(['.lando.yml']), 'demo', [lando]);
  assert.strictEqual(guarded(rt, rt.shell), 'command -v lando >/dev/null 2>&1 || { echo "lando is not installed here: https://example.org/lando"; exit 127; }; lando ssh');
  const msg = noRuntimeMessage([docker]);
  assert.match(msg, /DDEV is built in/);
  assert.match(msg, /Lando, Docksal, Podman, Kubernetes come with their Webship Workspace plugins/);
  assert.match(msg, /@webship\.co\/workspace-lando/);
  assert.doesNotMatch(msg, /workspace-docker/);
  assert.strictEqual(cliOnPath('sh'), true);
  assert.strictEqual(cliOnPath('no-such-cli-zz'), false);
});

test('the terminal helper reads which plugins are on from settings.yml and answers for a project', () => {
  const text = 'account:\n  name: x\nplugins:\n  dev:\n    enabled: true\n  docker:\n    enabled: "true"\n    module: "@webship.co/workspace-docker"\n  lando:\n    enabled: false\nstyle:\n  enabled: true\n';
  assert.deepStrictEqual([...enabledPlugins(text)], ['dev', 'docker']);
  assert.deepStrictEqual([...enabledPlugins('workspaces: dev\n')], []);
  const dir = project(['.ddev/config.yaml']);
  const out: string[] = [];
  const write = process.stdout.write;
  (process.stdout as any).write = (s: string) => { out.push(String(s)); return true; };
  try {
    assert.strictEqual(main(['runtime-id', path.join(dir, 'settings.yml'), dir, 'demo']), 0);
    assert.strictEqual(main(['runtime-exec', path.join(dir, 'settings.yml'), dir, 'demo', 'ls']), 0);
  } finally { process.stdout.write = write; }
  assert.strictEqual(out[0], 'ddev\n');
  assert.match(out[1], /^command -v ddev .*; ddev exec 'ls'\n$/);
});
