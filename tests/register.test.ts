import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { COMMANDS, NAME, SCREENRC, assistantContext, register } from '../src/index';

// A ddev of the test's own on the PATH: what the menu offers depends on the CLI being there, and a
// machine that runs these tests need not have it. One test takes it away again, on purpose.
const BIN = fs.mkdtempSync(path.join(os.tmpdir(), 'screens-bin-'));
fs.writeFileSync(path.join(BIN, 'ddev'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
const PATH_WITH_DDEV = `${BIN}${path.delimiter}${process.env.PATH || ''}`;
const PATH_WITHOUT_DDEV = (process.env.PATH || '').split(path.delimiter).filter((d) => d && !fs.existsSync(path.join(d, 'ddev'))).join(path.delimiter);
process.env.PATH = PATH_WITH_DDEV;

/**
 * A dashboard as the plugin sees it: the api with what register() calls, a workspace on disk with
 * one folder (dev), one command and one DDEV project, and a `run` that plays screen (no session is
 * started in these tests: they are about what is drawn and what is refused).
 */
function dashboard(settings: Record<string, unknown> = {}, opts: { newer?: boolean; screen?: boolean } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'screens-reg-'));
  fs.mkdirSync(path.join(root, 'dev', 'demo', '.ddev'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dev', 'demo', '.ddev', 'config.yaml'), 'name: demo\n');
  fs.writeFileSync(path.join(root, 'dev', 'cmd-wordpress-project.sh'), '#!/usr/bin/env bash\n# workspace-name: WordPress (latest)\n');
  fs.writeFileSync(path.join(root, 'dev', 'cmd-tools-backup-dev.sh'), '#!/usr/bin/env bash\n');
  const got: any = { actions: {}, pageActions: [], pages: [], rowMenus: {}, runners: [], panels: [], jobs: [], screenCalls: [] };
  const state = { settings };
  const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const api: any = {
    name: NAME, config: {}, capabilities: new Set(['row-menu-body']),
    settings: { file: 'plugin.screens.settings.yml', read: () => state.settings, set: () => undefined, setList: () => undefined },
    lib: {
      esc, ROOT: root, NAME_RE: /^[A-Za-z0-9][A-Za-z0-9_.-]*$/,
      loadSettings: () => ({ plugins: {} }),
      isValidWorkspace: (k: string) => k === 'dev',
      workspaceDir: (k: string) => path.join(root, k),
      listProjects: (dir: string) => fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name),
      cssVersionNow: () => 'v1',
      lingerTail: (label: string) => `echo "${label} finished."; timeout --foreground 900 bash -c 'while :; do read -r _ && exit 0; sleep 1; done' || true`,
      run: async (cmd: string, args: string[]) => {
        got.screenCalls.push([cmd, ...args]);
        if (opts.screen === false) return { ok: false, code: -1, stdout: '', stderr: 'spawn screen ENOENT' };
        if (args[0] === '--version') return { ok: true, code: 0, stdout: 'Screen version 4.09.00 (GNU) 30-Jan-22\n', stderr: '' };
        if (args.includes('-ls')) return { ok: false, code: 1, stdout: 'No Sockets found in /run/screen/S-you.\n', stderr: '' };
        return { ok: true, code: 0, stdout: '', stderr: '' };
      },
      startJob: (title: string, cmd: string, args: string[], cwd: string) => { got.jobs.push({ title, cmd, args, cwd }); return `job${got.jobs.length}`; },
      jobFragment: (id: string) => ({ html: `<div class="job-toast" id="${id}"></div>` }),
    },
    addAction: (name: string, fn: unknown) => { got.actions[name] = fn; },
    addFragment: (fn: unknown) => { got.fragment = fn; },
    addPageActions: (fn: unknown) => { got.pageActions.push(fn); },
    addPage: (re: RegExp, handler: unknown) => { got.pages.push({ re, handler }); },
    addRowMenu: (slot: string, spec: unknown, fn: unknown) => { got.rowMenus[slot] = { spec, fn }; },
    addAssistantContext: (fn: () => string) => { got.context = fn(); },
  };
  if (opts.newer !== false) {
    api.capabilities = new Set(['row-menu-body', 'runner', 'sessions-panel']);
    api.addRunner = (fn: unknown) => { got.runners.push(fn); };
    api.addScreensPanel = (fn: unknown) => { got.panels.push(fn); };
  }
  got.api = api;
  register(api);
  const fragment = async (rest: string, query = '') => {
    let out = { html: '', status: 200 };
    await got.fragment({ rest, searchParams: new URLSearchParams(query), send: (html: string, status = 200) => { out = { html, status }; } });
    return out;
  };
  const action = async (name: string, form: Record<string, string>, workspace = 'dev') => {
    let out = { html: '', status: 200 };
    const headers: Record<string, string> = {};
    await got.actions[name]({ form, workspace, pathname: `/actions/p/screens/${name}`, res: { setHeader: (k: string, v: string) => { headers[k] = v; } }, send: (html: string, status = 200) => { out = { html, status }; } });
    return { ...out, headers };
  };
  const rail = (view = 'workspace', key = 'dev') => got.pageActions.map((fn: any) => fn({ view, key, meta: {} })).filter(Boolean);
  const menu = () => got.rowMenus.shell.fn({ key: 'dev', project: 'demo', dir: path.join(root, 'dev'), meta: {}, allowed: new Set(), vals: () => '' });
  const page = () => { let out = { status: 0, body: '' }; got.pages[0].handler({ res: { writeHead: (s: number) => { out.status = s; }, end: (b: string) => { out.body = b; } } }); return out; };
  return { got, root, state, fragment, action, rail, menu, page };
}

const runnerReq = (root: string) => ({ session: 'dev--demo--build', workspace: 'dev', project: 'demo', projectDir: path.join(root, 'dev'), ownerDir: path.join(root, 'dev', 'demo'), verb: 'build', cmdLine: 'bash "cmd-wordpress-project.sh" "demo"', label: 'build (WordPress)' });

test('register() wires the page, the fragments, the actions, the SHELL menu, the runner and the panel', () => {
  const d = dashboard();
  assert.deepStrictEqual(Object.keys(d.got.actions).sort(), ['clean', 'container-run', 'container-shell', 'remove', 'run', 'shell', 'stop']);
  assert.ok(d.got.rowMenus.shell);
  assert.strictEqual(d.got.rowMenus.shell.spec.label, 'SHELL');
  assert.strictEqual(d.got.runners.length, 1);
  assert.strictEqual(d.got.panels.length, 1);
  assert.ok(d.got.pages[0].re.test('/screens/runs'));
  assert.match(d.got.context, /cmd-tools-screens\.sh/);
  assert.strictEqual(d.got.context, assistantContext());
  assert.deepStrictEqual(COMMANDS, ['cmd-tools-screens.sh']);
  assert.ok(fs.existsSync(SCREENRC), 'the screenrc ships with the package');
});

test('with every switch on: the Sessions button on every page, "Run in a screen" on a workspace page, the menu, the panel', async () => {
  const d = dashboard();
  const [home] = d.rail('home', '');
  assert.strictEqual(home.items.length, 1);
  assert.match(home.items[0], /class="action-label">Sessions</);
  assert.match(home.items[0], /href="\/screens"/, 'a dashboard with the panel hook shows the sessions on its Screens page');
  const [ws] = d.rail();
  assert.strictEqual(ws.items.length, 2);
  assert.match(ws.items[1], /Run in a screen/);
  assert.deepStrictEqual(Object.keys(d.menu()).sort(), ['body', 'html']);
  assert.match(d.got.panels[0](), /id="sessions-manager"/);
  const body = (await d.fragment('menu/dev/demo')).html;
  for (const entry of ['shell-folder', 'shell-ddev', 'run-ddev', 'run-in-screen']) assert.match(body, new RegExp(`data-entry="${entry}"`), entry);
  assert.match(body, /DDEV · \.ddev\/config\.yaml/);
  assert.strictEqual(d.page().status, 200);
});

test('switch screens.page off: no button, no panel, the page and its fragments answer "not enabled", sessions cannot be managed', async () => {
  const d = dashboard({ screens: { page: false } });
  assert.ok(!JSON.stringify(d.rail('home', '')).includes('Sessions<'), 'the button is not drawn');
  assert.strictEqual(d.got.panels[0](), '');
  const page = d.page();
  assert.strictEqual(page.status, 404);
  assert.match(page.body, /is not enabled in this workspace/);
  for (const rest of ['runs', 'runs/list', 'log/dev--demo--build', 'tail/dev--demo--build']) {
    const out = await d.fragment(rest);
    assert.strictEqual(out.status, 404, rest);
    assert.match(out.html, /screens\.page/);
  }
  for (const name of ['stop', 'remove', 'clean']) assert.strictEqual((await d.action(name, { session: 'dev--demo--build' })).status, 404, name);
  // The rest stays: a run can still be started in a screen.
  assert.match(d.rail()[0].items[0], /Run in a screen/);
});

test('switch screens.run_in_screen off: no form, no entry, the action is refused, and the runner steps aside', async () => {
  const d = dashboard({ screens: { run_in_screen: false } });
  assert.ok(!JSON.stringify(d.rail()).includes('Run in a screen'));
  assert.strictEqual((await d.fragment('run-form', 'workspace=dev')).status, 404);
  const out = await d.action('run', { script: 'cmd-wordpress-project.sh', projectName: 'demo' });
  assert.strictEqual(out.status, 404);
  assert.match(out.html, /screens\.run_in_screen/);
  assert.doesNotMatch((await d.fragment('menu/dev/demo')).html, /run-in-screen/);
  assert.strictEqual(await d.got.runners[0](runnerReq(d.root)), null, 'null leaves the run to the dashboard');
  assert.strictEqual(d.got.jobs.length, 0);
  assert.ok(!d.got.screenCalls.some((c: string[]) => c.includes('-dmS')), 'no session was started');
});

test('switch screens.attach_hints off: a started run says its session and no attach command', async () => {
  const on = dashboard();
  const withHint = await on.got.runners[0](runnerReq(on.root));
  assert.strictEqual(withHint.ok, true);
  assert.match(withHint.html, /screen -r dev--demo--build/);
  const off = dashboard({ screens: { attach_hints: false } });
  const without = await off.got.runners[0](runnerReq(off.root));
  assert.strictEqual(without.ok, true);
  assert.match(without.html, /dev--demo--build/);
  assert.doesNotMatch(without.html, /screen -r|Attach/);
});

test('switch shells.project off: no folder shell in the menu, and its action is refused', async () => {
  const d = dashboard({ shells: { project: false } });
  const body = (await d.fragment('menu/dev/demo')).html;
  assert.doesNotMatch(body, /shell-folder/);
  assert.match(body, /shell-ddev/, 'the container shell is its own switch');
  const out = await d.action('shell', { projectName: 'demo' });
  assert.strictEqual(out.status, 404);
  assert.match(out.html, /shells\.project/);
});

test('switch shells.container off: no container entries, and both actions and the form are refused', async () => {
  const d = dashboard({ shells: { container: false } });
  const body = (await d.fragment('menu/dev/demo')).html;
  assert.doesNotMatch(body, /shell-ddev|run-ddev|DDEV/);
  assert.match(body, /shell-folder/);
  assert.strictEqual((await d.action('container-shell', { projectName: 'demo', runtime: 'ddev' })).status, 404);
  assert.strictEqual((await d.action('container-run', { projectName: 'demo', runtime: 'ddev', command: 'ls' })).status, 404);
  assert.strictEqual((await d.fragment('container-form/dev/demo/ddev')).status, 404);
});

test('the master switches: shells off leaves only "Run in a screen" in the menu; both off draws no menu at all', async () => {
  const shellsOff = dashboard({ shells: { enabled: false } });
  const body = (await shellsOff.fragment('menu/dev/demo')).html;
  assert.doesNotMatch(body, /shell-folder|shell-ddev/);
  assert.match(body, /run-in-screen/);
  const allOff = dashboard({ screens: { enabled: false }, shells: { enabled: false } });
  assert.strictEqual(allOff.menu(), null, 'no dead button on the row');
  assert.deepStrictEqual(allOff.rail(), [], 'no empty group in the rail');
  assert.strictEqual(allOff.got.panels[0](), '');
  assert.strictEqual((await allOff.fragment('menu/dev/demo')).status, 404);
  assert.strictEqual(await allOff.got.runners[0](runnerReq(allOff.root)), null);
});

test('the settings are read on every request: a switch turned off takes effect without a restart', async () => {
  const d = dashboard();
  assert.strictEqual(d.rail()[0].items.length, 2);
  d.state.settings = { screens: { enabled: false }, shells: { enabled: false } };
  assert.deepStrictEqual(d.rail(), []);
  d.state.settings = {};
  assert.strictEqual(d.rail()[0].items.length, 2);
});

test('a run is never handed to the page: runs.default_mode page of an older settings file still starts a session', async () => {
  const d = dashboard({ runs: { default_mode: 'page' } });
  const out = await d.got.runners[0](runnerReq(d.root));
  assert.deepStrictEqual([out.ok, out.where], [true, 'screen']);
  assert.doesNotMatch(out.html, /job-toast|terminal-pre/);
  assert.match(out.html, /Open in Screens/);
  const form = await d.action('run', { script: 'cmd-tools-backup-dev.sh', projectName: 'demo', mode: 'page' });
  assert.doesNotMatch(form.html, /job-toast|terminal-pre/);
  assert.strictEqual(d.got.jobs.length, 0, 'no job of the dashboard was started');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'index.ts'), 'utf8');
  assert.doesNotMatch(src, /startJob|jobFragment/, 'the plugin does not use the runner of the page');
});

test('the run form lists the builders and the tools of the folder, and refuses what is not a command of it', async () => {
  const d = dashboard();
  const form = (await d.fragment('run-form', 'workspace=dev&project=demo')).html;
  assert.match(form, /<optgroup label="Builders"><option value="cmd-wordpress-project\.sh">WordPress \(latest\) \(cmd-wordpress-project\.sh\)<\/option>/);
  assert.match(form, /<optgroup label="Tools"><option value="cmd-tools-backup-dev\.sh">/);
  assert.match(form, /name="projectName" value="demo"/);
  assert.strictEqual((await d.fragment('run-form', 'workspace=nope')).status, 400);
  for (const script of ['../core/scripts/install.sh', 'cmd-missing.sh', 'cmd-x.sh; rm -rf /']) {
    assert.match((await d.action('run', { script })).html, /Unknown command/, script);
  }
  assert.match((await d.action('run', { script: 'cmd-wordpress-project.sh', projectName: 'demo', flags: '--install $(id)' })).html, /An argument may hold/);
  assert.match((await d.action('run', { script: 'cmd-wordpress-project.sh', projectName: '../x' })).html, /Invalid project name/);
});

test('a run started from the form is one screen call: detached, named after the folder and the project, the command as one argument', async () => {
  const d = dashboard();
  const out = await d.action('run', { script: 'cmd-wordpress-project.sh', projectName: 'demo', flags: '--install --add-users', mode: 'screen' });
  assert.strictEqual(out.status, 200);
  assert.strictEqual(out.headers['HX-Trigger'], 'screens-changed');
  assert.match(out.html, /dev--demo--build/);
  const call = d.got.screenCalls.find((c: string[]) => c.includes('-dmS'));
  assert.deepStrictEqual(call.slice(0, 8), ['screen', '-c', SCREENRC, '-T', 'xterm-256color', '-dmS', 'dev--demo--build', 'bash']);
  assert.match(call[9], /^\{ bash "cmd-wordpress-project\.sh" "demo" "--install" "--add-users" ; \} 2>&1 \| tee -a /);
  const note = fs.readFileSync(path.join(d.root, '.screens', 'dev--demo--build.run'), 'utf8');
  assert.match(note, /^by=run form$/m);
  assert.match(note, /^project=demo$/m);
});

test('a shell in the container is the runtime\'s own command, guarded by "is the CLI here"; an unknown project is refused', async () => {
  const d = dashboard();
  const bad = await d.action('container-shell', { projectName: 'nope', runtime: 'ddev' });
  assert.strictEqual(bad.status, 400);
  const noRuntime = await d.action('container-shell', { projectName: 'demo', runtime: 'lando' });
  assert.strictEqual(noRuntime.status, 409);
  assert.match(noRuntime.html, /No container runtime recognises this folder|come with their Webship Workspace plugins/);
});

test('a runtime whose CLI is not installed where the dashboard runs is named with how to install it, and nothing is started', async () => {
  const d = dashboard();
  process.env.PATH = PATH_WITHOUT_DDEV;
  try {
    const body = (await d.fragment('menu/dev/demo')).html;
    assert.match(body, /DDEV · \.ddev\/config\.yaml/);
    assert.match(body, /ddev is not installed where the dashboard runs: https:\/\/docs\.ddev\.com/);
    assert.doesNotMatch(body, /shell-ddev|run-ddev/, 'no entry that could only fail');
    assert.match(body, /shell-folder/, 'the folder shell needs no runtime');
    const out = await d.action('container-shell', { projectName: 'demo', runtime: 'ddev' });
    assert.strictEqual(out.status, 409);
    assert.match(out.html, /ddev is not installed where the dashboard runs/);
    assert.ok(!d.got.screenCalls.some((c: string[]) => c.includes('-dmS')));
  } finally { process.env.PATH = PATH_WITH_DDEV; }
});

test('on a dashboard without the newer hooks the plugin still registers: its own page, no runner, no panel', () => {
  const d = dashboard({}, { newer: false });
  assert.strictEqual(d.got.runners.length, 0);
  assert.strictEqual(d.got.panels.length, 0);
  assert.match(d.rail('home', '')[0].items[0], /href="\/screens\/runs"/);
  assert.match(d.page().body, /id="sessions-manager"/);
});

test('without screen where the dashboard runs, the list and the form say so, and nothing is offered in the page', async () => {
  const d = dashboard({}, { screen: false });
  assert.match((await d.fragment('runs/list')).html, /screen is not installed where the dashboard runs/);
  const form = (await d.fragment('run-form', 'workspace=dev')).html;
  assert.match(form, /screen is not installed where the dashboard runs, so nothing can be started from here/);
  assert.match(form, /<button class="uk-button uk-button-primary" type="submit" disabled>/);
  assert.doesNotMatch(form, /name="mode"|In the page/);
});
