import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, spawnSync } from 'child_process';

import { Sessions } from '../src/lib/sessions';
import type { RunAnswer } from '../src/lib/sessions';
import { readSettings } from '../src/lib/settings';
import { logPage } from '../src/lib/store';

// The dashboard's own `run`: stdin closed, output collected, -1 when the command is not there.
const run = (cmd: string, args: string[], cwd: string, opts: { env?: NodeJS.ProcessEnv } = {}): Promise<RunAnswer> => new Promise((resolve) => {
  const child = spawn(cmd, args, { cwd, env: opts.env || process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('close', (code) => resolve({ ok: code === 0, code: code ?? 1, stdout, stderr }));
  child.on('error', (err) => resolve({ ok: false, code: -1, stdout, stderr: String(err.message) }));
});

const hasScreen = spawnSync('screen', ['--version']).error === undefined;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fixture() {
  // A short path: a socket's path has a length limit.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-'));
  fs.mkdirSync(path.join(root, 'dev', 'demo'), { recursive: true });
  const sockets = path.join(root, 'sock');
  const env = { ...process.env, SCREENDIR: sockets };
  const sessions = new Sessions({ root, settings: () => readSettings({}), run, screenrc: path.join(__dirname, '..', '..', 'config', 'screenrc'), env });
  return { root, sessions, sockets };
}

test('without screen a start is refused with what to do, and nothing is written', { skip: hasScreen ? 'screen is installed here' : false }, async () => {
  const { sessions, root } = fixture();
  const out = await sessions.start({ session: 't--demo--run', command: 'echo x', dir: root, note: { dir: root, project: '', workspace: 't', by: 'test', kind: 'run', runtime: '' } });
  assert.strictEqual(out.ok, false);
  assert.match(String(out.why), /screen is not installed/);
});

test('a run in a real session: listed while it runs, found again by a second manager, logged, its exit code kept, removable once ended',
  { skip: hasScreen ? false : 'screen is not installed here', timeout: 60000 }, async () => {
    const { root, sessions } = fixture();
    const dir = path.join(root, 'dev');
    const req = { session: 't--demo--build', command: 'echo started; sleep 3; echo finished; exit 7', dir,
      note: { dir: path.join(dir, 'demo'), project: 'demo', workspace: 'dev', by: 'test', kind: 'run', runtime: '' } };
    const started = await sessions.start(req);
    assert.strictEqual(started.ok, true, started.why);
    assert.deepStrictEqual(await sessions.start(req), { ok: false, session: 't--demo--build', already: true }, 'a second start of a live name is refused');

    // A second manager is a dashboard that restarted: it knows nothing, and finds the session all the same.
    const again = new Sessions({ root, settings: () => readSettings({}), run, screenrc: '', env: { ...process.env, SCREENDIR: path.join(root, 'sock') } });
    const [row] = await again.list();
    assert.deepStrictEqual([row.session, row.state, row.attached], ['t--demo--build', 'running', false]);
    assert.strictEqual(row.note && row.note.project, 'demo');
    assert.strictEqual(row.note && row.note.command, req.command);
    assert.strictEqual((await again.hints(row)).attach, `SCREENDIR=${path.join(root, 'sock')} screen -r t--demo--build`);
    assert.deepStrictEqual(await again.remove('t--demo--build'), { ok: false, why: 'it is still running: stop it first', files: [] });

    for (let i = 0; i < 40 && (await again.live()).length; i += 1) await wait(250);
    const [ended] = await again.list();
    assert.deepStrictEqual([ended.state, ended.exit], ['ended', 7], 'the exit code of the command, not of tee');
    assert.deepStrictEqual(logPage(ended.log).lines, ['started', 'finished']);
    assert.strictEqual((await again.remove('t--demo--build')).ok, true);
    assert.deepStrictEqual(await again.list(), []);
  });

test('stop ends exactly the named session and leaves its neighbour; an ended one has no exit code and keeps its log',
  { skip: hasScreen ? false : 'screen is not installed here', timeout: 60000 }, async () => {
    const { root, sessions } = fixture();
    const note = { dir: root, project: 'demo', workspace: 'dev', by: 'test', kind: 'run', runtime: '' };
    assert.strictEqual((await sessions.start({ session: 't--demo', command: 'echo one; sleep 30', dir: root, note })).ok, true);
    assert.strictEqual((await sessions.start({ session: 't--demo-2', command: 'echo two; sleep 30', dir: root, note })).ok, true);
    await wait(500);
    assert.deepStrictEqual(await sessions.stop('t--dem'), { ok: false, why: 'no such session is running' }, 'a name that only starts alike stops nothing');
    assert.strictEqual((await sessions.stop('t--demo')).ok, true);
    await wait(500);
    const rows = await sessions.list();
    assert.deepStrictEqual(rows.map((r) => [r.session, r.state, r.exit]), [['t--demo-2', 'running', null], ['t--demo', 'ended', null]]);
    assert.deepStrictEqual(logPage(rows[1].log).lines, ['one']);
    assert.deepStrictEqual(await sessions.clean(true), ['t--demo']);
    assert.strictEqual((await sessions.stop('t--demo-2')).ok, true);
    await wait(300);
    assert.deepStrictEqual(await sessions.clean(true), ['t--demo-2']);
    assert.deepStrictEqual(fs.readdirSync(path.join(root, '.screens')), []);
  });

test('a shell is a session nothing is piped into: screen keeps its log, and typing into it works',
  { skip: hasScreen ? false : 'screen is not installed here', timeout: 60000 }, async () => {
    const { root, sessions, sockets } = fixture();
    const started = await sessions.start({ session: 't--demo--shell', command: 'bash --norc', dir: path.join(root, 'dev', 'demo'), interactive: true,
      note: { dir: path.join(root, 'dev', 'demo'), project: 'demo', workspace: 'dev', by: 'test', kind: 'shell', runtime: '' } });
    assert.strictEqual(started.ok, true, started.why);
    await wait(700);
    // What a person would type after attaching, sent the way screen takes keystrokes.
    spawnSync('screen', ['-S', 't--demo--shell', '-X', 'stuff', 'pwd; exit 3\n'], { env: { ...process.env, SCREENDIR: sockets } });
    for (let i = 0; i < 40 && (await sessions.live()).length; i += 1) await wait(250);
    const [row] = await sessions.list();
    assert.deepStrictEqual([row.state, row.exit, row.note && row.note.kind], ['ended', 3, 'shell']);
    assert.match(logPage(row.log).lines.join('\n'), new RegExp(`${path.join('dev', 'demo')}`), 'the shell opened in the project folder');
  });

test('a name that is not a session name, or a folder that is not there, starts nothing', async () => {
  const { root, sessions } = fixture();
  const note = { dir: root, project: '', workspace: 'dev', by: 'test', kind: 'run', runtime: '' };
  assert.match(String((await sessions.start({ session: '-S evil', command: 'echo x', dir: root, note })).why), /session name/);
  assert.match(String((await sessions.start({ session: 't--x', command: 'echo x', dir: path.join(root, 'nope'), note })).why), /no such folder/);
  assert.ok(!fs.existsSync(path.join(root, '.screens')));
});
