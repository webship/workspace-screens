import test from 'node:test';
import assert from 'node:assert';

import { DEFAULTS, anySession, flag, notEnabled, readSettings } from '../src/lib/settings';

test('with no settings file every switch is on, runs start in a screen, logs live in .screens', () => {
  const s = readSettings(undefined);
  assert.deepStrictEqual(s, DEFAULTS);
  assert.deepStrictEqual(s.switches, { page: true, runInScreen: true, attachHints: true, shellProject: true, shellContainer: true });
  assert.strictEqual(s.logDir, '.screens');
  assert.strictEqual(s.retentionDays, 14);
  assert.strictEqual(s.socketsDir, 'auto');
});

test('each element has its own switch, and turning one off leaves the others on', () => {
  const cases: [Record<string, unknown>, string][] = [
    [{ screens: { page: false } }, 'page'],
    [{ screens: { run_in_screen: false } }, 'runInScreen'],
    [{ screens: { attach_hints: false } }, 'attachHints'],
    [{ shells: { project: false } }, 'shellProject'],
    [{ shells: { container: false } }, 'shellContainer'],
  ];
  for (const [raw, off] of cases) {
    const sw = readSettings(raw).switches as unknown as Record<string, boolean>;
    for (const [name, value] of Object.entries(sw)) assert.strictEqual(value, name !== off, `${JSON.stringify(raw)}: ${name}`);
  }
});

test('the master switch of a group turns its elements off whatever their own switches say', () => {
  const screensOff = readSettings({ screens: { enabled: false, page: true, run_in_screen: true, attach_hints: true } }).switches;
  assert.deepStrictEqual(screensOff, { page: false, runInScreen: false, attachHints: false, shellProject: true, shellContainer: true });
  const shellsOff = readSettings({ shells: { enabled: false, project: true, container: true } }).switches;
  assert.deepStrictEqual(shellsOff, { page: true, runInScreen: true, attachHints: true, shellProject: false, shellContainer: false });
  const allOff = readSettings({ screens: { enabled: 'no' }, shells: { enabled: 'off' } }).switches;
  assert.strictEqual(anySession(allOff), false);
  assert.strictEqual(anySession(shellsOff), true);
});

test('a switch reads YAML booleans and the words people type; anything else is the default', () => {
  for (const v of [true, 'true', 'yes', 'on', '1', 'TRUE']) assert.strictEqual(flag(v, false), true, String(v));
  for (const v of [false, 'false', 'no', 'off', '0', 'No']) assert.strictEqual(flag(v, true), false, String(v));
  for (const v of [undefined, null, '', 'maybe', {}]) { assert.strictEqual(flag(v, true), true); assert.strictEqual(flag(v, false), false); }
});

test('the run settings: log folder, retention, sockets, terminal command; a run has no mode but a screen', () => {
  const s = readSettings({ runs: { default_mode: 'page', log_dir: '/var/tmp/logs', retention_days: 0, sockets_dir: '~/.sessions' }, terminal: { command: 'gnome-terminal -- {attach}' } });
  assert.ok(!('defaultMode' in s), 'default_mode: page of an older settings file is not read: a run is a screen session');
  assert.strictEqual(s.logDir, '/var/tmp/logs');
  assert.strictEqual(s.retentionDays, 0, '0 keeps the logs');
  assert.strictEqual(s.socketsDir, '~/.sessions');
  assert.strictEqual(s.terminalCommand, 'gnome-terminal -- {attach}');
  assert.strictEqual(readSettings({ runs: { retention_days: -3 } }).retentionDays, 14);
});

test('a route whose switch is off says so, and names the key', () => {
  const html = notEnabled('The sessions page', 'screens.page');
  assert.match(html, /The sessions page is not enabled in this workspace/);
  assert.match(html, /<code>screens\.page<\/code>/);
  assert.match(html, /plugin\.screens\.settings\.yml/);
});
