import test from 'node:test';
import assert from 'node:assert';

import { freeName, sessionName, validSession, verbOfScript } from '../src/lib/names';

test('a session is named workspace--project--verb, in lowercase', () => {
  assert.strictEqual(sessionName('dev', 'Demo1', 'build'), 'dev--demo1--build');
  assert.strictEqual(sessionName('dev', '', 'tools-checks'), 'dev--tools-checks');
  assert.strictEqual(sessionName('dev', 'my site!', 'shell'), 'dev--my-site--shell');
  assert.strictEqual(sessionName('', '', ''), 'session');
});

test('a long name is shortened with a hash of the whole, so two long names stay two sessions', () => {
  const a = sessionName('sandboxes', 'a-project-with-a-very-long-name-that-goes-on-and-on', 'composer-update');
  const b = sessionName('sandboxes', 'a-project-with-a-very-long-name-that-goes-on-and-on', 'composer-update-dry-run');
  assert.ok(a.length <= 60 && b.length <= 60);
  assert.notStrictEqual(a, b);
  assert.ok(validSession(a) && validSession(b));
});

test('only names screen and the file system both take are valid', () => {
  for (const ok of ['dev--demo--build', 'a', 'x1.y_z-2']) assert.ok(validSession(ok), ok);
  for (const bad of ['', '-S', 'Dev', 'a b', 'x;rm', '../x', '.hidden', 'x'.repeat(81), undefined]) assert.ok(!validSession(bad), String(bad));
});

test('a builder is "build", a tool is its file name', () => {
  assert.strictEqual(verbOfScript('cmd-wordpress-project.sh'), 'build');
  assert.strictEqual(verbOfScript('cmd-tools-backup-dev.sh'), 'tools-backup-dev');
  assert.strictEqual(verbOfScript('/x/dev/cmd-tools-checks.sh'), 'tools-checks');
});

test('a second run of the same thing gets the next free name', () => {
  const taken = new Set(['dev--demo--build', 'dev--demo--build-2']);
  assert.strictEqual(freeName('dev--demo--tools', (n) => taken.has(n)), 'dev--demo--tools');
  assert.strictEqual(freeName('dev--demo--build', (n) => taken.has(n)), 'dev--demo--build-3');
});
