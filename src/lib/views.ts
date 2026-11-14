/**
 * What the plugin draws: server-rendered fragments, wired with HTMX and UIkit like the rest of the
 * dashboard. Nothing here asks screen or reads a log: a view is given what it shows.
 */

import type { AttachHints } from './screen';
import type { Switches } from './settings';
import type { LogPage, SessionRow } from './store';
import type { ProjectRuntime } from './runtime';

export type Esc = (s: unknown) => string;

const NS = 'screens';
export const frag = (rest: string): string => `/fragments/p/${NS}/${rest}`;
export const act = (name: string): string => `/actions/p/${NS}/${name}`;

const OUT = 'hx-target="#webship-workspace-output" hx-swap="innerHTML"';

export function ago(seconds: number, now = Date.now()): string {
  if (!seconds) return '';
  const d = Math.max(0, Math.floor(now / 1000) - seconds);
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  return `${Math.floor(d / 86400)} d ago`;
}

/** The state of a session in words: running and whether a terminal has it open, or ended and how. */
export function stateLabel(r: SessionRow): { text: string; cls: string } {
  if (r.state === 'running') return r.attached ? { text: 'running · attached', cls: 'is-attached' } : { text: 'running · detached', cls: 'is-detached' };
  if (r.exit === 0) return { text: 'ended · exit 0', cls: 'is-ended-ok' };
  if (r.exit === null) return { text: 'ended · stopped', cls: 'is-ended-stopped' };
  return { text: `ended · exit ${r.exit}`, cls: 'is-ended-failed' };
}

const KINDS: Record<string, string> = { run: 'command', shell: 'shell', 'container-shell': 'shell in the container', 'container-run': 'command in the container' };

/** One command to copy, in the dashboard's own copy-button shape. */
export function copyLine(esc: Esc, label: string, command: string): string {
  return `<div class="sessions-copy"><span class="uk-text-meta">${esc(label)}</span>
    <code>${esc(command)}</code>
    <button type="button" class="uk-button uk-button-default uk-button-small copy-cmd" data-copy="${esc(command)}" title="Copy the command"><span uk-icon="icon: copy; ratio: .7"></span> Copy</button></div>`;
}

export function attachHtml(esc: Esc, h: AttachHints): string {
  return `<div class="sessions-attach">
    ${copyLine(esc, 'Attach from your terminal', h.attach)}
    ${h.viaContainer ? copyLine(esc, 'Without screen on this machine', h.viaContainer) : ''}
    ${h.terminal ? copyLine(esc, 'Open in my terminal', h.terminal) : ''}
    <span class="uk-text-meta">Ctrl-A D detaches and leaves it running.</span></div>`;
}

export function sessionRowHtml(esc: Esc, r: SessionRow, hints: AttachHints | null): string {
  const st = stateLabel(r);
  const n = r.note;
  const vals = `hx-vals='{"session":"${esc(r.session)}"}'`;
  const what = n ? `${esc(KINDS[n.kind] || n.kind)}${n.runtime ? ` · ${esc(n.runtime)}` : ''}` : 'started outside the plugin';
  const where = n && (n.project || n.workspace) ? `<span class="sessions-project">${esc([n.workspace, n.project].filter(Boolean).join(' / '))}</span>` : '';
  const when = r.state === 'ended' ? (r.ended ? `ended ${esc(ago(r.ended))}` : '') : (n && n.started ? `started ${esc(ago(n.started))}` : '');
  return `<li class="sessions-row ${st.cls}" data-session="${esc(r.session)}">
    <div class="sessions-row-head">
      <span class="sessions-state ${st.cls}">${esc(st.text)}</span>
      <code class="sessions-name">${esc(r.session)}</code>
      ${where}
      <span class="uk-text-meta">${what}${n && n.by ? ` · from the ${esc(n.by)}` : ''}${when ? ` · ${when}` : ''}</span>
    </div>
    ${n && n.command ? `<div class="sessions-command"><code>${esc(n.command)}</code></div>` : ''}
    <div class="sessions-row-actions">
      ${r.log ? `<button type="button" class="uk-button uk-button-default uk-button-small" hx-get="${frag(`log/${encodeURIComponent(r.session)}`)}" hx-target="#editor-modal-body" hx-swap="innerHTML"><span uk-icon="icon: file-text; ratio: .7"></span> Log</button>` : '<span class="uk-text-meta">no log</span>'}
      ${r.state === 'running'
    ? `<button type="button" class="uk-button uk-button-default uk-button-small" hx-post="${act('stop')}" ${vals} ${OUT} hx-confirm="Stop ${esc(r.session)}? Whatever runs inside it is ended."><span uk-icon="icon: ban; ratio: .7"></span> Stop</button>`
    : `<button type="button" class="uk-button uk-button-default uk-button-small" hx-post="${act('remove')}" ${vals} ${OUT} hx-confirm="Remove the log and the notes of ${esc(r.session)}?"><span uk-icon="icon: trash; ratio: .7"></span> Remove</button>`}
    </div>
    ${r.state === 'running' && hints ? attachHtml(esc, hints) : ''}
    ${r.log && r.state === 'running' ? `<pre class="terminal-pre sessions-tail" hx-get="${frag(`tail/${encodeURIComponent(r.session)}`)}" hx-trigger="load, every 4s" hx-swap="innerHTML">…</pre>` : ''}
  </li>`;
}

export function sessionListHtml(esc: Esc, rows: SessionRow[], hints: Map<string, AttachHints>, note = ''): string {
  const running = rows.filter((r) => r.state === 'running').length;
  const ended = rows.length - running;
  const head = `<div class="sessions-count uk-text-meta">${running} running · ${ended} ended${note ? ` · ${note}` : ''}</div>`;
  if (!rows.length) return `${head}<p class="uk-text-meta">No sessions yet. Start one with "Run in a screen" on a workspace page, from a project's SHELL menu, or with <code>bash cmd-tools-screens.sh --run "…"</code>.</p>`;
  return `${head}<ul class="uk-list sessions-list">${rows.map((r) => sessionRowHtml(esc, r, hints.get(r.session) || null)).join('')}</ul>`;
}

/** The manager: a toolbar and a list that loads itself and keeps itself current. Nothing here waits on screen. */
export function managerHtml(esc: Esc, opts: { title?: boolean } = {}): string {
  return `<div class="sessions-manager" id="sessions-manager">
    ${opts.title === false ? '' : '<h3 class="uk-margin-small-bottom">Sessions</h3>'}
    <p class="uk-text-meta">Every run started in a screen session, from the dashboard or with <code>cmd-tools-screens.sh</code>: running, attached or detached, and ended, each with its log. A session outlives the dashboard and the browser.</p>
    <div class="sessions-toolbar">
      <button type="button" class="uk-button uk-button-default uk-button-small" hx-get="${frag('runs/list')}" hx-target="#sessions-list-body" hx-swap="innerHTML"><span uk-icon="icon: refresh; ratio: .7"></span> Refresh</button>
      <button type="button" class="uk-button uk-button-default uk-button-small" hx-post="${act('clean')}" ${OUT} hx-confirm="Remove the logs and notes of every ended session?"><span uk-icon="icon: trash; ratio: .7"></span> Remove ended sessions</button>
    </div>
    <div id="sessions-list-body" hx-get="${frag('runs/list')}" hx-trigger="load, every 10s, screens-changed from:body" hx-swap="innerHTML"><span uk-spinner="ratio: .6"></span></div>
  </div>`;
}

export function logHtml(esc: Esc, r: SessionRow | null, session: string, page: LogPage): string {
  const url = (p: number) => `${frag(`log/${encodeURIComponent(session)}`)}?page=${p}`;
  const nav = (p: number, label: string, on: boolean) => (on
    ? `<button type="button" class="uk-button uk-button-default uk-button-small" hx-get="${url(p)}" hx-target="#editor-modal-body" hx-swap="innerHTML">${label}</button>`
    : `<button type="button" class="uk-button uk-button-default uk-button-small" disabled>${label}</button>`);
  const st = r ? stateLabel(r) : { text: 'ended', cls: '' };
  const live = r && r.state === 'running' && page.page === page.pages;
  return `<div class="editor-card sessions-log">
    <h3 class="uk-margin-small-bottom">Log of <code>${esc(session)}</code></h3>
    <p class="uk-text-meta"><span class="sessions-state ${st.cls}">${esc(st.text)}</span> · ${page.total} line${page.total === 1 ? '' : 's'} · page ${page.page} of ${page.pages}${page.truncated ? ' · a long log: only its last 16 MB is paged' : ''}</p>
    <div class="sessions-pager">
      ${nav(1, 'First', page.page > 1)} ${nav(page.page - 1, 'Older', page.page > 1)}
      ${nav(page.page + 1, 'Newer', page.page < page.pages)} ${nav(page.pages, 'Last', page.page < page.pages)}
    </div>
    <pre class="terminal-pre sessions-log-pre"${live ? ` hx-get="${frag(`log-lines/${encodeURIComponent(session)}`)}" hx-trigger="every 3s" hx-swap="innerHTML"` : ''}>${esc(page.lines.join('\n')) || '(nothing yet)'}</pre>
  </div>`;
}

export interface FormScript { file: string; label: string; builder: boolean }

export function runFormHtml(esc: Esc, opts: { workspace: string; scripts: FormScript[]; project: string; mode: 'screen' | 'page'; canScreen: boolean }): string {
  const option = (s: FormScript) => `<option value="${esc(s.file)}">${esc(s.label)}</option>`;
  const builders = opts.scripts.filter((s) => s.builder);
  const tools = opts.scripts.filter((s) => !s.builder);
  return `<div class="editor-card sessions-run-form">
    <h3 class="uk-margin-small-bottom">Run in a screen · ${esc(opts.workspace)}</h3>
    <p class="uk-text-meta">Any command of this folder, builders and tools alike, as a named session with a log. It keeps running when this tab closes and when the dashboard restarts.</p>
    <form hx-post="${act('run')}" ${OUT}>
      <input type="hidden" name="workspace" value="${esc(opts.workspace)}">
      <div class="uk-margin-small"><label class="uk-form-label" for="sessions-script">Command</label>
        <select class="uk-select" id="sessions-script" name="script" required>
          ${builders.length ? `<optgroup label="Builders">${builders.map(option).join('')}</optgroup>` : ''}
          ${tools.length ? `<optgroup label="Tools">${tools.map(option).join('')}</optgroup>` : ''}
        </select></div>
      <div class="uk-margin-small"><label class="uk-form-label" for="sessions-project">Project</label>
        <input class="uk-input" id="sessions-project" name="projectName" value="${esc(opts.project)}" placeholder="the project name the command takes (empty for a tool that takes none)" pattern="[A-Za-z0-9][A-Za-z0-9_.-]*"></div>
      <div class="uk-margin-small"><label class="uk-form-label" for="sessions-flags">Arguments</label>
        <input class="uk-input" id="sessions-flags" name="flags" placeholder="--install --add-users"></div>
      <div class="uk-margin-small">
        <label class="uk-margin-small-right"><input class="uk-radio" type="radio" name="mode" value="screen"${opts.mode === 'screen' && opts.canScreen ? ' checked' : ''}${opts.canScreen ? '' : ' disabled'}> In a screen session</label>
        <label><input class="uk-radio" type="radio" name="mode" value="page"${opts.mode === 'page' || !opts.canScreen ? ' checked' : ''}> In the page</label>
      </div>
      <button class="uk-button uk-button-primary" type="submit"><span uk-icon="icon: play; ratio: .8"></span> Run</button>
    </form></div>`;
}

export interface MenuData {
  workspace: string;
  project: string;
  switches: Switches;
  runtimes: ProjectRuntime[];
  /** CLIs of the runtimes that are not on the PATH of the dashboard. */
  missingCli: Set<string>;
  noRuntime: string;
  sessions: { row: SessionRow; hints: AttachHints | null }[];
}

/** The body of a project's SHELL menu, drawn when the menu opens. Empty when every switch is off. */
export function menuHtml(esc: Esc, d: MenuData): string {
  const vals = (extra = '') => `hx-vals='{"workspace":"${esc(d.workspace)}","projectName":"${esc(d.project)}"${extra}}' ${OUT}`;
  const items: string[] = [];
  if (d.switches.shellProject) {
    items.push(`<li data-entry="shell-folder"><a href hx-post="${act('shell')}" ${vals()}><span uk-icon="icon: laptop; ratio: .7"></span> Shell in the project folder</a></li>`);
  }
  if (d.switches.shellContainer) {
    if (d.runtimes.length) items.push('<li class="uk-nav-divider"></li>');
    for (const rt of d.runtimes) {
      const missing = d.missingCli.has(rt.cli);
      items.push(`<li class="uk-nav-header">${esc(rt.title)} · ${esc(rt.file)}</li>`);
      if (missing) {
        items.push(`<li class="sessions-menu-note"><span class="uk-text-meta">${esc(rt.cli)} is not installed where the dashboard runs: ${esc(rt.cliHint)}</span></li>`);
        continue;
      }
      items.push(`<li data-entry="shell-${esc(rt.id)}"><a href hx-post="${act('container-shell')}" ${vals(`,"runtime":"${esc(rt.id)}"`)}><span uk-icon="icon: server; ratio: .7"></span> Shell in the container</a></li>`);
      items.push(`<li data-entry="run-${esc(rt.id)}"><a href hx-get="${frag(`container-form/${encodeURIComponent(d.workspace)}/${encodeURIComponent(d.project)}/${encodeURIComponent(rt.id)}`)}" hx-target="#editor-modal-body" hx-swap="innerHTML"><span uk-icon="icon: play; ratio: .7"></span> Run a command in the container…</a></li>`);
    }
    if (!d.runtimes.length) items.push(`<li class="sessions-menu-note"><span class="uk-text-meta">${esc(d.noRuntime)}</span></li>`);
  }
  if (d.switches.runInScreen) {
    items.push('<li class="uk-nav-divider"></li>');
    items.push(`<li data-entry="run-in-screen"><a href hx-get="${frag('run-form')}?workspace=${encodeURIComponent(d.workspace)}&amp;project=${encodeURIComponent(d.project)}" hx-target="#editor-modal-body" hx-swap="innerHTML"><span uk-icon="icon: play-circle; ratio: .7"></span> Run in a screen…</a></li>`);
  }
  if (d.sessions.length && (d.switches.page || d.switches.attachHints)) {
    items.push('<li class="uk-nav-divider"></li><li class="uk-nav-header">Sessions of this project</li>');
    for (const { row, hints } of d.sessions) {
      const st = stateLabel(row);
      items.push(`<li class="sessions-menu-session"><span class="sessions-state ${st.cls}">${esc(st.text)}</span> <code>${esc(row.session)}</code>
        ${hints && d.switches.attachHints ? `<button type="button" class="uk-button uk-button-default uk-button-small copy-cmd" data-copy="${esc(hints.attach)}" title="${esc(hints.attach)}"><span uk-icon="icon: copy; ratio: .7"></span> Copy attach</button>` : ''}</li>`);
    }
  }
  while (items.length && items[0].includes('uk-nav-divider')) items.shift();
  return items.length ? `<ul class="uk-nav uk-dropdown-nav sessions-menu">${items.join('')}</ul>` : '';
}

export function containerFormHtml(esc: Esc, workspace: string, project: string, rt: ProjectRuntime): string {
  return `<div class="editor-card sessions-run-form">
    <h3 class="uk-margin-small-bottom">Run a command in the container · ${esc(project)}</h3>
    <p class="uk-text-meta">${esc(rt.title)} (${esc(rt.file)}). The command runs inside the project's container as a session with a log: <code>${esc(rt.exec('…'))}</code></p>
    <form hx-post="${act('container-run')}" ${OUT}>
      <input type="hidden" name="workspace" value="${esc(workspace)}">
      <input type="hidden" name="projectName" value="${esc(project)}">
      <input type="hidden" name="runtime" value="${esc(rt.id)}">
      <div class="uk-margin-small"><label class="uk-form-label" for="sessions-container-command">Command</label>
        <input class="uk-input" id="sessions-container-command" name="command" required placeholder="ls -la" autocomplete="off"></div>
      <button class="uk-button uk-button-primary" type="submit"><span uk-icon="icon: play; ratio: .8"></span> Run</button>
    </form></div>`;
}

/** What a start answers with: the session, where to watch it, how to attach. A result, not a page: it flashes and goes. */
export function startedHtml(esc: Esc, opts: { session: string; label: string; project: string; hints: AttachHints | null; page: boolean }): string {
  return `<div class="msg assistant flash-now" data-reload-on-close="1"><code>${esc(opts.label)}</code>${opts.project ? ` on <strong>${esc(opts.project)}</strong>` : ''} runs in the session <code>${esc(opts.session)}</code>${opts.page ? ' — <a href="/screens/runs">watch it on Sessions</a>' : ''}.
    ${opts.hints ? `<br><span class="uk-text-meta">Attach from your terminal:</span> <code>${esc(opts.hints.attach)}</code>` : ''}</div>`;
}

export const errorHtml = (esc: Esc, text: string): string => `<div class="msg error flash-now">${esc(text)}</div>`;
