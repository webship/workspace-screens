/**
 * The sessions list on the Screens page, as a keyboard and the eye reach it (round 7 of the testing rounds,
 * axe 4.14): a running session's log tail is a named region a keyboard can scroll, and its state word is in
 * the link ink, not the brand blue (4.15:1 on the row).
 */

import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';

import { sessionRowHtml, stateLabel } from '../src/lib/views';
import type { SessionRow } from '../src/lib/store';

const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const row = (over: Partial<SessionRow> = {}): SessionRow => ({ session: 'dev--site1--build', state: 'running', attached: false, exit: null, ended: 0, note: null, log: '/tmp/x.log', pid: '42', ...over });

test('a running session\'s log tail is a named region a keyboard can reach', () => {
  const html = sessionRowHtml(esc, row(), null);
  const pre = html.match(/<pre class="terminal-pre sessions-tail"[^>]*>/);
  assert.ok(pre, 'the tail is drawn for a running session with a log');
  assert.match(pre[0], / role="region"/);
  assert.match(pre[0], / tabindex="0"/);
  assert.match(pre[0], / aria-label="The end of the log of dev--site1--build"/);
  // An ended one has no tail to scroll.
  assert.doesNotMatch(sessionRowHtml(esc, row({ state: 'ended', ended: 1 }), null), /sessions-tail/);
});

test('the region\'s name is escaped like the rest of the row', () => {
  const html = sessionRowHtml(esc, row({ session: 'a"b' }), null);
  assert.match(html, /aria-label="The end of the log of a&quot;b"/);
});

test('a running session\'s state word is in the link ink, its border in the brand', () => {
  assert.strictEqual(stateLabel(row({ attached: true })).cls, 'is-attached');
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'css', 'screens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = css.match(/\.sessions-state\.is-attached, \.sessions-state\.is-detached \{([^}]*)\}/);
  assert.ok(rule, 'the rule is there');
  assert.match(rule[1], /color: var\(--link\);/);
  assert.match(rule[1], /border-color: var\(--brand-primary\);/);
  assert.doesNotMatch(rule[1], /(^|;)\s*color: var\(--brand-primary\)/);
});
