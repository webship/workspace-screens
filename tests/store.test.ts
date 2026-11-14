import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { expiredSessions, fileOf, logPage, notedSessions, parseNote, readExit, readNote, removeSession, sessionRows, storeDir, writeNote } from '../src/lib/store';
import type { RunNote } from '../src/lib/store';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'screens-store-'));
const note = (over: Partial<RunNote> = {}): RunNote => ({ command: 'bash cmd-x.sh demo', dir: '/w/dev/demo', project: 'demo', workspace: 'dev', by: 'terminal', kind: 'run', runtime: '', started: 1000, ...over });

test('the log folder is inside the workspace unless it is absolute', () => {
  assert.strictEqual(storeDir('/w', '.screens'), '/w/.screens');
  assert.strictEqual(storeDir('/w', ''), '/w/.screens');
  assert.strictEqual(storeDir('/w', '/var/logs'), '/var/logs');
});

test('a note is key=value lines, one per line, and reads back; it also leaves the owner note the dashboard reads', () => {
  const dir = tmp();
  writeNote(dir, 'dev--demo--build', note({ command: 'echo one\necho two' }));
  const back = readNote(dir, 'dev--demo--build');
  assert.deepStrictEqual(back, note({ command: 'echo one echo two' }));
  assert.strictEqual(fs.readFileSync(fileOf(dir, 'dev--demo--build', 'cwd'), 'utf8'), '/w/dev/demo\n');
  assert.strictEqual(parseNote('command=a=b\nby=terminal\n').command, 'a=b', 'a value may hold an equals sign');
  assert.strictEqual(readNote(dir, 'nope'), null);
});

test('the list is what screen says is alive plus what the notes say ran: nothing is remembered in between', () => {
  const dir = tmp();
  writeNote(dir, 'dev--a--build', note({ project: 'a', started: 100 }));
  writeNote(dir, 'dev--b--build', note({ project: 'b', started: 200 }));
  writeNote(dir, 'dev--c--build', note({ project: 'c', started: 300 }));
  fs.writeFileSync(fileOf(dir, 'dev--a--build', 'log'), 'a\n');
  fs.writeFileSync(fileOf(dir, 'dev--b--build', 'exit'), '0 250\n');
  fs.writeFileSync(fileOf(dir, 'dev--c--build', 'exit'), '2 350\n');
  const rows = sessionRows(dir, [
    { pid: '11', session: 'dev--a--build', started: '', state: 'Detached' },
    { pid: '12', session: 'by-hand', started: '', state: 'Attached' },
    { pid: '13', session: 'Bad Name', started: '', state: 'Detached' },
  ]);
  assert.deepStrictEqual(rows.map((r) => [r.session, r.state, r.attached, r.exit]), [
    ['dev--a--build', 'running', false, null],
    ['by-hand', 'running', true, null],
    ['dev--c--build', 'ended', false, 2],
    ['dev--b--build', 'ended', false, 0],
  ]);
  assert.strictEqual(rows[1].note, null, 'a session started by hand has no note, and is listed all the same');
  assert.ok(rows[0].log.endsWith('dev--a--build.log'));
  assert.deepStrictEqual(readExit(dir, 'dev--a--build'), { code: null, at: 0 });
});

test('an ended session without an exit code was stopped: its end is its log\'s last write', () => {
  const dir = tmp();
  writeNote(dir, 'dev--x--tools', note());
  fs.writeFileSync(fileOf(dir, 'dev--x--tools', 'log'), 'x\n');
  const [row] = sessionRows(dir, []);
  assert.strictEqual(row.exit, null);
  assert.ok(row.ended > 0);
});

test('removing an ended session removes its four files and nothing else', () => {
  const dir = tmp();
  writeNote(dir, 'dev--a--build', note());
  fs.writeFileSync(fileOf(dir, 'dev--a--build', 'log'), 'a\n');
  fs.writeFileSync(fileOf(dir, 'dev--a--build', 'exit'), '0 1\n');
  fs.writeFileSync(path.join(dir, 'dev--a--build-2.log'), 'other\n');
  assert.deepStrictEqual(removeSession(dir, 'dev--a--build').sort(), ['dev--a--build.cwd', 'dev--a--build.exit', 'dev--a--build.log', 'dev--a--build.run']);
  assert.deepStrictEqual(fs.readdirSync(dir), ['dev--a--build-2.log']);
  assert.deepStrictEqual(removeSession(dir, '../etc/passwd'), [], 'a name that is not a session name removes nothing');
  assert.deepStrictEqual(notedSessions(dir), []);
});

test('only ended sessions older than the retention expire; 0 days keeps everything', () => {
  const now = 100 * 86400 * 1000;
  const rows = [
    { session: 'old', state: 'ended', ended: 80 * 86400 },
    { session: 'new', state: 'ended', ended: 99 * 86400 },
    { session: 'live', state: 'running', ended: 0 },
  ] as any;
  assert.deepStrictEqual(expiredSessions(rows, 14, now), ['old']);
  assert.deepStrictEqual(expiredSessions(rows, 0, now), []);
});

test('a long log is paged: the last page by default, any page by number, colour codes and progress bars taken out', () => {
  const dir = tmp();
  const file = path.join(dir, 'x.log');
  const lines = Array.from({ length: 450 }, (_, i) => `line ${i + 1}`);
  lines[449] = '\x1b[32mgreen\x1b[0m done';
  lines[448] = '10%\r50%\r100% downloaded';
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  const last = logPage(file);
  assert.deepStrictEqual([last.page, last.pages, last.total, last.lines.length], [3, 3, 450, 50]);
  assert.strictEqual(last.lines[49], 'green done');
  assert.strictEqual(last.lines[48], '100% downloaded');
  const first = logPage(file, 1);
  assert.deepStrictEqual([first.page, first.lines[0], first.lines.length], [1, 'line 1', 200]);
  assert.strictEqual(logPage(file, 99).page, 3, 'a page past the end is the last one');
  assert.deepStrictEqual(logPage(path.join(dir, 'missing.log')), { lines: [], page: 1, pages: 1, total: 0, truncated: false });
});
