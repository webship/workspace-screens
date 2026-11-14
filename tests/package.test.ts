import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

import { COMMANDS, NAME } from '../src/index';

// Compiled, these tests run from dist/tests, so the package root is one folder further up.
const PKG = fs.existsSync(path.join(__dirname, '..', 'package.json')) ? path.join(__dirname, '..') : path.join(__dirname, '..', '..');
const read = (f: string) => fs.readFileSync(path.join(PKG, f), 'utf8');
const pkg = JSON.parse(read('package.json'));
const manifest = pkg.workspacePlugin;

test('the manifest names the plugin, and every file it names ships with the package', () => {
  assert.strictEqual(manifest.name, NAME);
  assert.strictEqual(manifest.settingsFile, 'plugin.screens.settings.yml');
  const named = [manifest.settingsTemplate, manifest.labels, ...manifest.commands.files, ...manifest.scripts.functions, ...manifest.scripts.args,
    ...manifest.scripts.machine, manifest.scripts.hostInstall, ...manifest.css, ...manifest.features];
  for (const f of named) {
    assert.ok(fs.existsSync(path.join(PKG, f)), `${f} is in the package`);
    assert.ok(pkg.files.includes(f.split('/')[0]), `${f} is published with the package`);
  }
  assert.deepStrictEqual(manifest.commands.files.map((f: string) => path.basename(f)), COMMANDS);
  assert.strictEqual(pkg.version, '1.0.8');
  assert.strictEqual(pkg.devDependencies['@webship.co/workspace-plugin-api'], '^1.0.7');
  assert.strictEqual(pkg.dependencies, undefined, 'the container family is asked when it is there, never required');
});

test('every setting of the template has a label, and every switch is in the template', () => {
  const template = read(manifest.settingsTemplate);
  const labels = read(manifest.labels);
  const keys = ['screens.enabled', 'screens.page', 'screens.run_in_screen', 'screens.attach_hints', 'shells.enabled', 'shells.project', 'shells.container',
    'runs.default_mode', 'runs.log_dir', 'runs.retention_days', 'runs.sockets_dir', 'terminal.command'];
  for (const key of keys) {
    const [group, name] = key.split('.');
    assert.match(labels, new RegExp(`^${group}\\.${name}:\\n  label: .+\\n  info: .+`, 'm'), `${key} has a label and an explanation`);
    assert.match(template, new RegExp(`^${group}:\\n(?:(?:  .*|\\s*#.*|)\\n)*?  ${name}: `, 'm'), `${key} is in the template`);
  }
  assert.doesNotMatch(template, /token|password|secret/i, 'the settings hold nothing secret');
});

test('the command finds the workspace by itself, names its folder, and reads its arguments from where the installer puts them', () => {
  const src = read('commands/cmd-tools-screens.sh');
  assert.match(src, /^#!\/usr\/bin\/env bash/);
  assert.match(src, /WORKSPACE_SCRIPTS="\$\{WORKSPACE_SCRIPTS:-\$\(cd "\$\(dirname "\$\{BASH_SOURCE\[0\]\}"\)\/\.\.\/core\/scripts" && pwd\)\}"/);
  assert.match(src, /workspace\.__WORKSPACE__\.settings\.yml/);
  assert.match(src, /source \$\{WORKSPACE_SCRIPTS\}\/plugins\/screens\/args\/arg-screens\.sh \|\| exit 1 ;/);
  assert.doesNotMatch(src, /^# workspace-name:/m, 'a tool is not a builder');
  assert.strictEqual(src.trim().split('\n').pop(), 'screens_command ;');
  assert.match(read('scripts/functions/fun-screens.sh'), /^function screens_command\(\) \{/m);
});

test('every shell script parses', () => {
  for (const f of [...manifest.commands.files, ...manifest.scripts.functions, ...manifest.scripts.args, manifest.scripts.hostInstall]) {
    const r = spawnSync('bash', ['-n', path.join(PKG, f)], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, `${f}: ${r.stderr}`);
  }
});

test('the argument names never shadow a variable the shell itself owns', () => {
  const args = read('scripts/args/arg-screens.sh');
  const dests = [...args.matchAll(/add_argument\('(?:-\w', )?'--([a-z-]+)',(?:\s*dest='([a-z_]+)',)?/g)].map((m) => (m[2] || m[1]).replace(/-/g, '_').toUpperCase());
  assert.ok(dests.length >= 12);
  for (const reserved of ['SHELL', 'LINES', 'COLUMNS', 'PATH', 'HOME', 'USER', 'PWD', 'RANDOM', 'SECONDS']) assert.ok(!dests.includes(reserved), reserved);
});

test('the host check reports and never installs: nothing in it runs sudo, it only prints the command', () => {
  const src = read('scripts/host-install.sh');
  for (const line of src.split('\n')) {
    if (!/\bsudo\b/.test(line)) continue;
    assert.match(line, /echo|^\s*#/, `sudo is only ever printed: ${line.trim()}`);
  }
  assert.doesNotMatch(src, /apt-get install|apt install -y screen\s*$/m);
  const r = spawnSync('bash', [path.join(PKG, 'scripts/host-install.sh'), '--check'], { encoding: 'utf8', env: { ...process.env, WORKSPACE_DASHBOARD_CONTAINER: 'no-such-container-zz' } });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /screen \(this (machine|container)\)/);
  assert.match(r.stdout, /screenrc/);
});

test('the sessions of the terminal and of the dashboard are the same files: the same four extensions, the same note keys', () => {
  const bash = read('scripts/functions/fun-screens.sh');
  for (const ext of ['log', 'run', 'exit', 'cwd']) assert.match(bash, new RegExp(`\\.${ext}\\b`), ext);
  assert.match(bash, /printf 'command=%s\\ndir=%s\\nproject=%s\\nworkspace=%s\\nby=terminal\\nkind=%s\\nruntime=%s\\nstarted=%s\\n'/);
  assert.match(bash, /tee -a/);
  assert.match(bash, /PIPESTATUS\[0\]/);
  assert.match(read('config/screenrc'), /^defscrollback 10000$/m);
});

test('the stylesheet only adds rules of the plugin\'s own', () => {
  const css = read('css/screens.css');
  for (const m of css.matchAll(/^([^@{}\n][^{}\n]*)\{/gm)) {
    for (const sel of m[1].split(',')) assert.match(sel.trim(), /^\.sessions-/, `"${sel.trim()}" starts at one of the plugin's classes`);
  }
});
