/**
 * The sessions on the machine: listed and stopped through the host runner (webship/workspace-screens#35).
 *
 * The dashboard's container has a process space and a screen socket directory of its own (webship/workspace#564), so
 * screen in it sees only its own sessions. The ones on the machine (the host runner's, and the ones started in a
 * terminal there) come from the base's list, which marks them `via: 'runner'`, and are stopped through the runner,
 * as the base does it. Against a stand-in `run` (screen in the container) and a stand-in runner: nothing is signalled.
 */
import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { Sessions } from '../src/lib/sessions';
import type { MachineSessions, RunAnswer } from '../src/lib/sessions';
import { readSettings } from '../src/lib/settings';

function fixture(machineRows = [{ pid: '5151', session: 'dev--demo--build', started: 'today', state: 'Detached' }]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-m-'));
  fs.mkdirSync(path.join(root, 'dev', 'demo'), { recursive: true });
  const calls: string[][] = [];
  const stopped: string[] = [];
  // screen in the dashboard's container: its own session only.
  const run = async (cmd: string, args: string[]): Promise<RunAnswer> => {
    calls.push([cmd, ...args]);
    if (args[0] === '--version') return { ok: true, code: 0, stdout: 'Screen version 4.09.00', stderr: '' };
    if (args[0] === '-ls') return { ok: false, code: 1, stdout: 'There is a screen on:\n\t4242.dev--demo--mine\t(today)\t(Detached)\n1 Socket in /run/screen/S-u.\n', stderr: '' };
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };
  const machine: MachineSessions = {
    list: async () => machineRows,
    stop: async (session) => { stopped.push(session); return { ok: true }; },
  };
  const env = { ...process.env, SCREENDIR: path.join(root, 'sock') };
  const sessions = new Sessions({ root, settings: () => readSettings({}), run, screenrc: '', env, machine });
  return { root, sessions, calls, stopped };
}

test('the list holds the sessions on the machine as well, marked so', async () => {
  const { sessions } = fixture();
  const rows = await sessions.list();
  const by = Object.fromEntries(rows.map((r) => [r.session, r]));
  assert.strictEqual(by['dev--demo--mine'].state, 'running');
  assert.ok(!by['dev--demo--mine'].machine, 'its own session is the container\'s');
  assert.strictEqual(by['dev--demo--build'].state, 'running', 'a session on the machine is listed');
  assert.strictEqual(by['dev--demo--build'].machine, true);
});

test('a session on the machine is stopped through the runner, never with screen in the container', async () => {
  const { sessions, calls, stopped } = fixture();
  assert.deepStrictEqual(await sessions.stop('dev--demo--build'), { ok: true });
  assert.deepStrictEqual(stopped, ['dev--demo--build']);
  assert.ok(!calls.some((c) => c.includes('quit')), 'screen in the container was not asked to quit it');
  // Its own session is stopped here, as before, by its whole name.
  assert.deepStrictEqual(await sessions.stop('dev--demo--mine'), { ok: true });
  assert.ok(calls.some((c) => c.join(' ') === 'screen -S 4242.dev--demo--mine -X quit'));
  assert.deepStrictEqual(stopped, ['dev--demo--build'], 'and the runner was not asked about it');
});

test('a runner that does not answer is said, and a name taken on the machine is not started again here', async () => {
  const { sessions, root } = fixture();
  (sessions as unknown as { deps: { machine: MachineSessions } }).deps.machine.stop = async () => null;
  const out = await sessions.stop('dev--demo--build');
  assert.strictEqual(out.ok, false);
  assert.match(String(out.why), /the screen runner on your machine did not answer/);
  const started = await sessions.start({ session: 'dev--demo--build', command: 'echo x', dir: root, note: { dir: root, project: 'demo', workspace: 'dev', by: 'test', kind: 'run', runtime: '' } });
  assert.deepStrictEqual(started, { ok: false, session: 'dev--demo--build', already: true });
});

test('the hint for each says where it is: the machine\'s as it is, its own through the container', async () => {
  const { sessions } = fixture();
  const env = (sessions as unknown as { deps: { env: NodeJS.ProcessEnv } }).deps.env;
  env.DDEV_SITENAME = 'workspace';
  const rows = await sessions.list();
  const mine = rows.find((r) => r.session === 'dev--demo--mine')!;
  const far = rows.find((r) => r.session === 'dev--demo--build')!;
  assert.strictEqual((await sessions.hints(far)).attach, 'screen -r dev--demo--build');
  // In a container (DDEV says which), the plugin's own session is reached through it.
  if (fs.existsSync('/.dockerenv')) assert.match((await sessions.hints(mine)).attach, /^docker exec -it /);
  else assert.match((await sessions.hints(mine)).attach, /screen -r dev--demo--mine$/);
});

test('without a runner bridge (an older base) the list is screen\'s alone, as before', async () => {
  const { root } = fixture();
  const run = async (_c: string, args: string[]): Promise<RunAnswer> => (args[0] === '-ls'
    ? { ok: false, code: 1, stdout: '\t4242.dev--demo--mine\t(today)\t(Detached)\n', stderr: '' } : { ok: true, code: 0, stdout: '', stderr: '' });
  const plain = new Sessions({ root, settings: () => readSettings({}), run, screenrc: '', env: { ...process.env, SCREENDIR: path.join(root, 'sock') } });
  assert.deepStrictEqual((await plain.live()).map((r) => r.session), ['dev--demo--mine']);
});
