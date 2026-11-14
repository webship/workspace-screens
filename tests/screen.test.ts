import test from 'node:test';
import assert from 'node:assert';

import { attachHints, ownContainer, parseScreenLs, runLine, sessionEnv, shellLine, shq, socketsDir, socketsProblem, startArgs } from '../src/lib/screen';

const LS = `There are screens on:
\t1234.dev--demo--build\t(11/15/26 02:14:54)\t(Detached)
\t1300.dev--demo--shell\t(11/15/26 02:15:10)\t(Attached)
\t1400.old\t(Detached)
2 Sockets in /run/screen/S-you.
`;

test('screen -ls is read row by row: pid, name, state', () => {
  assert.deepStrictEqual(parseScreenLs(LS), [
    { pid: '1234', session: 'dev--demo--build', started: '11/15/26 02:14:54', state: 'Detached' },
    { pid: '1300', session: 'dev--demo--shell', started: '11/15/26 02:15:10', state: 'Attached' },
    { pid: '1400', session: 'old', started: '', state: 'Detached' },
  ]);
  assert.deepStrictEqual(parseScreenLs('No Sockets found in /run/screen/S-you.\n'), []);
});

test('what screen says about a sockets directory it cannot use is recognised, and nothing else is', () => {
  assert.strictEqual(socketsProblem("Directory '/run/screen' must have mode 777.\n"), "Directory '/run/screen' must have mode 777.");
  assert.match(socketsProblem('Cannot make directory \'/run/screen\': Permission denied\n'), /^Cannot make directory/);
  assert.strictEqual(socketsProblem(LS), '');
  assert.strictEqual(socketsProblem('No Sockets found in /run/screen/S-you.\n'), '');
});

test('the sockets directory: the environment first, then the setting, then screen\'s own while it can be used', () => {
  assert.strictEqual(socketsDir('auto', '/w/.screens', true, {}), '', 'screen\'s own directory, shared with the machine');
  assert.strictEqual(socketsDir('auto', '/w/.screens', false, {}), '/w/.screens/sockets', 'inside the workspace when screen refuses its own');
  assert.strictEqual(socketsDir('/srv/sockets', '/w/.screens', true, {}), '/srv/sockets');
  assert.strictEqual(socketsDir('~/.sessions', '/w/.screens', true, { HOME: '/home/YOUR_USER' }), '/home/YOUR_USER/.sessions');
  assert.strictEqual(socketsDir('auto', '/w/.screens', false, { SCREENDIR: '/env/dir' }), '/env/dir');
});

test('a run pipes its output to the window and the log and notes its own exit code; a shell is piped nowhere', () => {
  const run = runLine('bash "cmd-x.sh" "demo"', '/w/.screens/s.log', '/w/.screens/s.exit');
  assert.strictEqual(run, `{ bash "cmd-x.sh" "demo" ; } 2>&1 | tee -a '/w/.screens/s.log' ; printf '%s %s\\n' "\${PIPESTATUS[0]}" "$(date +%s)" > '/w/.screens/s.exit'`);
  const shell = shellLine('ddev ssh', '/w/.screens/s.exit');
  assert.ok(!shell.includes('tee'));
  assert.match(shell, /^ddev ssh ; printf '%s %s\\n' "\$\?"/);
  assert.strictEqual(shq("it's"), `'it'\\''s'`);
});

test('the session is started detached, under the plugin\'s screenrc, with the line as one argument', () => {
  assert.deepStrictEqual(startArgs({ session: 'dev--demo--build', line: 'echo "a b"', screenrc: '/p/screenrc' }),
    ['-c', '/p/screenrc', '-T', 'xterm-256color', '-dmS', 'dev--demo--build', 'bash', '-lc', 'echo "a b"']);
  assert.deepStrictEqual(startArgs({ session: 's', line: 'bash -l', screenrc: '', windowLog: '/w/s.log' }),
    ['-T', 'xterm-256color', '-L', '-Logfile', '/w/s.log', '-dmS', 's', 'bash', '-lc', 'bash -l']);
});

test('a session\'s environment: a terminal type screen passes colours for, the sockets directory, no questions in a run', () => {
  const run = sessionEnv({ COLORTERM: 'truecolor', SCREENDIR: '/old', X: '1' }, '/sock', false);
  assert.deepStrictEqual(run, { X: '1', TERM: 'xterm-256color', SCREENDIR: '/sock', DDEV_NONINTERACTIVE: 'true' });
  const shell = sessionEnv({ SCREENDIR: '/old' }, '', true);
  assert.deepStrictEqual(shell, { TERM: 'xterm-256color' });
});

test('the attach command: -r for a detached session, -x for one a terminal has open, the sockets directory when it is not screen\'s own', () => {
  assert.deepStrictEqual(attachHints('dev--demo--build', {}), { attach: 'screen -r dev--demo--build', viaContainer: '', terminal: '' });
  assert.strictEqual(attachHints('s', { attached: true }).attach, 'screen -x s');
  const h = attachHints('s', { sockets: '/w/.screens/sockets', container: 'ddev-workspace-web', terminalCommand: 'gnome-terminal -- {attach}' });
  assert.strictEqual(h.attach, 'SCREENDIR=/w/.screens/sockets screen -r s');
  assert.strictEqual(h.viaContainer, 'docker exec -it -e SCREENDIR=/w/.screens/sockets ddev-workspace-web screen -r s');
  assert.strictEqual(h.terminal, 'gnome-terminal -- SCREENDIR=/w/.screens/sockets screen -r s');
  assert.strictEqual(attachHints('s', { sockets: '/a b/sock' }).attach, `SCREENDIR='/a b/sock' screen -r s`);
  assert.strictEqual(attachHints('s', { terminalCommand: 'konsole -e' }).terminal, 'konsole -e screen -r s');
});

test('the dashboard knows the container it runs in, and a plain machine has none', () => {
  assert.strictEqual(ownContainer({ DDEV_SITENAME: 'workspace' }, () => true), 'ddev-workspace-web');
  assert.strictEqual(ownContainer({ HOSTNAME: 'abc123' }, () => true), 'abc123');
  assert.strictEqual(ownContainer({ DDEV_SITENAME: 'workspace' }, () => false), '');
});
