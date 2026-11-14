/**
 * Screens and terminals for Webship Workspace.
 *
 * Runs any cmd-*.sh — builders and tools, of the base and of every plugin — in a named, detached
 * screen session with a log, lists every session (running, attached or detached, ended) from what
 * screen and the log folder say, shows the command to attach from a terminal of your own, and opens
 * a shell in a project folder or inside its container on whichever runtime the project uses.
 *
 * Everything shown is a switch in core/config/plugin.screens.settings.yml, read on every request.
 * Everything asked of the dashboard goes through `api`; this package requires nothing from the
 * dashboard's own files, so it can be installed from npm and removed without a trace.
 */

import fs from 'fs';
import path from 'path';
import type { ActionContext, FragmentContext, PluginApi, RowContext } from '@webship.co/workspace-plugin-api';

import { freeName, sessionName, validSession, verbOfScript } from './lib/names';
import { cliOnPath, familyRuntimes, guarded, noRuntimeMessage, runtimesOf } from './lib/runtime';
import type { FamilyRuntime, ProjectRuntime } from './lib/runtime';
import { Sessions } from './lib/sessions';
import { notEnabled, readSettings } from './lib/settings';
import type { Settings } from './lib/settings';
import { logPage } from './lib/store';
import type { SessionRow } from './lib/store';
import * as views from './lib/views';

export { readSettings } from './lib/settings';
export { Sessions } from './lib/sessions';

/** The plugin's name: its settings key and its route namespace. */
export const NAME = 'screens';

/** The command the installer places in every sites and code folder. */
export const COMMANDS = ['cmd-tools-screens.sh'];

/** The screenrc the sessions run under: the package's own, never ~/.screenrc. */
export const SCREENRC = path.join(__dirname, '..', '..', 'config', 'screenrc');

const SCRIPT_RE = /^cmd-[A-Za-z0-9._-]+\.sh$/;
const FLAG_RE = /^[A-Za-z0-9=_.,:@^~\/+-]+$/;

/** What the dashboard's runner hook hands over: one command of a project, to be run. */
export interface RunnerRequest { session?: string; workspace: string; project: string; projectDir: string; ownerDir?: string; verb: string; cmdLine: string; label: string }
export interface RunnerAnswer { ok: boolean; session: string; already?: boolean; why?: string; where?: string; html?: string }

/** The hooks a dashboard newer than 1.0.8 offers; absent on an older one, where the rest of the plugin works the same. */
interface NewerApi {
  addRunner?: (fn: (req: RunnerRequest) => Promise<RunnerAnswer | null> | RunnerAnswer | null) => void;
  addScreensPanel?: (fn: () => string) => void;
}

export function assistantContext(): string {
  return [
    'Screens and terminals (a plugin, @webship.co/workspace-screens): a long command is run in a named, detached screen session with a log,',
    'from the dashboard ("Run in a screen", a project\'s SHELL menu) or with `bash cmd-tools-screens.sh --run "<command>" --project <name>` in a workspace folder.',
    '`bash cmd-tools-screens.sh --list` lists the sessions (running and ended), `<session> --follow` follows a log, `<session> --stop` stops one, `--clean` removes what ended ones left.',
    'A session outlives the dashboard and the browser; attach from a terminal with `screen -r <session>`.',
    '`--shell --project <name>` opens a shell in a project folder as a session; with `--container` it opens inside the project\'s container (DDEV, or the runtime of a container plugin).',
    'Never stop or remove a session you did not start without asking.',
  ].join(' ');
}

export function register(api: PluginApi): void {
  const lib = api.lib;
  const { esc } = lib;
  const newer = api as PluginApi & NewerApi;
  const settings = (): Settings => readSettings(api.settings.read());
  const sessions = new Sessions({ root: lib.ROOT, settings, run: lib.run, screenrc: fs.existsSync(SCREENRC) ? SCREENRC : '' });
  const hasPanel = typeof newer.addScreensPanel === 'function';
  const pageUrl = hasPanel ? '/screens' : '/screens/runs';

  // The container family's runtimes turned on in this workspace, asked of their own packages.
  const family = (): FamilyRuntime[] => {
    const plugins = (lib.loadSettings() || {}).plugins || {};
    const enabled = (id: string) => !!plugins[id] && String(plugins[id].enabled) === 'true';
    return familyRuntimes(enabled, (name) => require(require.resolve(name, { paths: [process.cwd(), __dirname] })));
  };

  const projectOf = (workspace: string, project: string): { dir: string; projectDir: string } | null => {
    if (!lib.isValidWorkspace(workspace)) return null;
    const dir = lib.workspaceDir(workspace);
    if (!lib.NAME_RE.test(project) || !lib.listProjects(dir).includes(project)) return null;
    return { dir, projectDir: path.join(dir, project) };
  };

  const changed = (ctx: ActionContext) => { try { ctx.res.setHeader('HX-Trigger', 'screens-changed'); } catch (_) { /* headers sent */ } };

  const hintsOf = async (row: Pick<SessionRow, 'session' | 'attached'>) => (settings().switches.attachHints ? sessions.hints(row) : null);

  /** Start a session and answer the request: the session, where to watch it, how to attach. */
  async function startAndAnswer(ctx: ActionContext, req: Parameters<Sessions['start']>[0], label: string, project: string) {
    const started = await sessions.start(req);
    if (started.already) return ctx.send(views.errorHtml(esc, `${label} is already running as the session ${started.session}. Attach to it, or stop it first.`), 409);
    if (!started.ok) return ctx.send(views.errorHtml(esc, `Could not start ${label}: ${started.why || 'unknown error'}`), 500);
    changed(ctx);
    return ctx.send(views.startedHtml(esc, { session: started.session, label, project, hints: await hintsOf({ session: started.session, attached: false }), page: settings().switches.page }).replace('/screens/runs', pageUrl));
  }

  // A short command of the dashboard ends by waiting for Enter, so its session can be read before it
  // closes. A run in the page has no terminal to press Enter in: the wait is taken off the line.
  const lingerWait = (() => {
    try { const tail = String(lib.lingerTail('')); const at = tail.indexOf('timeout --foreground'); return at >= 0 ? tail.slice(at) : ''; } catch (_) { return ''; }
  })();
  const forPage = (cmdLine: string): string => (lingerWait ? cmdLine.split(lingerWait).join('true') : cmdLine);

  /** A run in the page: the dashboard's own runner, a live toast that ends with the dashboard. */
  const runInPage = (title: string, cmdLine: string, cwd: string): string => {
    const id = lib.startJob(title, 'bash', ['-lc', forPage(cmdLine)], cwd, { timeoutMs: 3 * 60 * 60 * 1000, echoLine: cmdLine });
    return lib.jobFragment(id).html;
  };

  // ------------------------------------------------------------ the runner --
  // The Build form and the row menus hand their runs to this when the dashboard has the hook. With
  // "run in a screen" off the plugin steps aside (null) and the run stays with the dashboard.
  if (typeof newer.addRunner === 'function') {
    newer.addRunner(async (req) => {
      const s = settings();
      if (!s.switches.runInScreen) return null;
      const session = validSession(req.session) ? String(req.session) : sessionName(req.workspace, req.project, req.verb);
      if (s.defaultMode === 'page') {
        return { ok: true, session, where: 'page', html: runInPage(`${esc(req.label)} on <strong>${esc(req.project)}</strong>`, req.cmdLine, req.projectDir) };
      }
      const started = await sessions.start({ session, command: req.cmdLine, dir: req.projectDir,
        note: { dir: req.ownerDir || req.projectDir, project: req.project, workspace: req.workspace, by: 'dashboard', kind: 'run', runtime: '' } });
      if (!started.ok) return { ok: false, session, already: started.already, why: started.why, where: 'screen' };
      return { ok: true, session, where: 'screen',
        html: views.startedHtml(esc, { session, label: req.label, project: req.project, hints: await hintsOf({ session, attached: false }), page: s.switches.page }).replace('/screens/runs', pageUrl) };
    });
  }

  // ---------------------------------------------------- the Screens page --
  if (hasPanel) {
    newer.addScreensPanel!(() => (settings().switches.page ? `<div class="sessions-panel">${views.managerHtml(esc)}</div>` : ''));
  }

  // The button that opens the sessions, on every page; "Run in a screen" on a workspace's page.
  api.addPageActions(({ view, key }) => {
    const sw = settings().switches;
    const items: string[] = [];
    if (sw.page) {
      items.push(`<a class="uk-button uk-button-default action-btn" href="${pageUrl}" title="Sessions — every run in a screen session: running, attached or detached, ended; its log, how to attach">
        <span uk-icon="icon: tv; ratio: .8"></span><span class="action-label">Sessions</span></a>`);
    }
    if (sw.runInScreen && view === 'workspace' && key && lib.isValidWorkspace(key)) {
      items.push(`<button class="uk-button uk-button-default action-btn" type="button" hx-get="${views.frag('run-form')}?workspace=${encodeURIComponent(key)}" hx-target="#editor-modal-body" hx-swap="innerHTML"
        title="Run in a screen — any command of this folder as a named session with a log, which outlives the dashboard">
        <span uk-icon="icon: play-circle; ratio: .8"></span><span class="action-label">Run in a screen</span></button>`);
    }
    return items.length ? { label: 'Sessions', items } : null;
  });

  // The page of its own: the same manager, for a dashboard whose Screens page takes no panel yet.
  api.addPage(/^\/screens\/runs\/?$/, ({ res }) => {
    const on = settings().switches.page;
    res.writeHead(on ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Sessions · Webship Workspace</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/vendor/uikit.min.css"><link rel="stylesheet" href="/style.css?v=${esc(lib.cssVersionNow())}">
<script src="/vendor/uikit.min.js"></script><script src="/vendor/uikit-icons.min.js"></script><script src="/htmx.min.js"></script><script src="/ui.js" defer></script>
</head><body><main class="uk-container uk-container-small page-body webship-workspace-page sessions-page">
  <p><a href="/">← Webship Workspace</a></p>
  <div class="uk-card uk-card-default uk-card-body">
    ${on ? views.managerHtml(esc) : notEnabled('The sessions page', 'screens.page')}
    <div id="webship-workspace-output"></div>
  </div>
  <div id="editor-modal" uk-modal><div class="uk-modal-dialog uk-modal-body uk-width-xlarge"><button class="uk-modal-close-default" type="button" uk-close></button><div id="editor-modal-body"></div></div></div>
</main></body></html>`);
  });

  // --------------------------------------------------- the row's SHELL menu --
  const menuWanted = () => { const sw = settings().switches; return sw.shellProject || sw.shellContainer || sw.runInScreen; };
  const button = '<button class="uk-button uk-button-default uk-button-small" type="button" title="Shells and runs: a shell in the folder or in the container, run in a screen, this project\'s sessions"><span uk-icon="icon: laptop; ratio: .7"></span> SHELL <span uk-icon="icon: chevron-down; ratio: .6"></span></button>';

  async function menuBody(workspace: string, project: string, withSessions: boolean): Promise<string> {
    const p = projectOf(workspace, project);
    if (!p) return '';
    const sw = settings().switches;
    const fam = sw.shellContainer ? family() : [];
    const runtimes = sw.shellContainer ? runtimesOf(p.projectDir, project, fam) : [];
    const missingCli = new Set(runtimes.filter((rt) => !cliOnPath(rt.cli)).map((rt) => rt.cli));
    const mine: { row: SessionRow; hints: Awaited<ReturnType<typeof hintsOf>> }[] = [];
    if (withSessions) {
      for (const row of await sessions.list()) {
        if (row.state !== 'running' || !row.note || row.note.project !== project || row.note.workspace !== workspace) continue;
        mine.push({ row, hints: await hintsOf(row) });
      }
    }
    return views.menuHtml(esc, { workspace, project, switches: sw, runtimes, missingCli, noRuntime: noRuntimeMessage(fam), sessions: mine });
  }

  api.addRowMenu('shell', { label: 'SHELL', row: 0 }, ({ key, project }: RowContext) => {
    if (!menuWanted()) return null;
    if (api.capabilities && api.capabilities.has('row-menu-body')) {
      return { html: button, body: views.frag(`menu/${encodeURIComponent(key)}/${encodeURIComponent(project)}`) };
    }
    // An older dashboard draws the whole menu with the row: the entries, without the sessions.
    const p = projectOf(key, project);
    if (!p) return null;
    const sw = settings().switches;
    const fam = sw.shellContainer ? family() : [];
    const runtimes = sw.shellContainer ? runtimesOf(p.projectDir, project, fam) : [];
    const body = views.menuHtml(esc, { workspace: key, project, switches: sw, runtimes, missingCli: new Set(runtimes.filter((rt) => !cliOnPath(rt.cli)).map((rt) => rt.cli)), noRuntime: noRuntimeMessage(fam), sessions: [] });
    return body ? `<div class="uk-inline act-menu act-menu-shell">${button}<div uk-dropdown="mode: click; pos: bottom-right">${body}</div></div>` : null;
  });

  // -------------------------------------------------------------- fragments --
  api.addFragment(async ({ send, rest, searchParams }: FragmentContext) => {
    const s = settings();
    const sw = s.switches;
    let m: RegExpMatchArray | null;

    if (rest === 'runs' || rest === 'runs/list' || rest === 'panel') {
      if (!sw.page) return send(notEnabled('The sessions page', 'screens.page'), 404);
      if (rest !== 'runs/list') return send(views.managerHtml(esc));
      const health = await sessions.health();
      if (!health.installed) return send(views.errorHtml(esc, 'screen is not installed where the dashboard runs. bash core/scripts/plugins/screens/host-install.sh --check says what to do.'));
      await sessions.clean(false);
      const rows = await sessions.list();
      const hints = new Map();
      if (sw.attachHints) for (const r of rows) if (r.state === 'running') hints.set(r.session, await sessions.hints(r));
      // Said only when the sockets are not where screen keeps them by itself: the attach commands carry the directory.
      const note = health.sockets ? `sockets in ${health.sockets}` : '';
      return send(views.sessionListHtml(esc, rows, hints, note));
    }

    if ((m = rest.match(/^(log|log-lines|tail)\/([a-z0-9][a-z0-9_.-]*)$/))) {
      if (!sw.page) return send(notEnabled('The sessions page', 'screens.page'), 404);
      const session = m[2];
      const file = path.join(sessions.dir(), `${session}.log`);
      if (m[1] === 'tail') return send(esc(logPage(file, 0, 12).lines.join('\n')) || '(nothing yet)');
      const page = logPage(file, Number(searchParams.get('page')) || 0);
      if (m[1] === 'log-lines') return send(esc(page.lines.join('\n')) || '(nothing yet)');
      const row = (await sessions.list()).find((r) => r.session === session) || null;
      return send(views.logHtml(esc, row, session, page));
    }

    if (rest === 'run-form') {
      if (!sw.runInScreen) return send(notEnabled('"Run in a screen"', 'screens.run_in_screen'), 404);
      const workspace = String(searchParams.get('workspace') || '');
      if (!lib.isValidWorkspace(workspace)) return send(views.errorHtml(esc, 'Unknown workspace.'), 400);
      const dir = lib.workspaceDir(workspace);
      let files: string[] = [];
      try { files = fs.readdirSync(dir).filter((f) => SCRIPT_RE.test(f)).sort(); } catch (_) { files = []; }
      if (!files.length) return send(views.errorHtml(esc, `No cmd-*.sh in ${workspace}: add a folder plugin or a platform plugin, and its commands are listed here.`), 404);
      const scripts = files.map((file) => {
        let name = '';
        try { name = (fs.readFileSync(path.join(dir, file), 'utf8').match(/^# workspace-name:\s*(.+)$/m) || [])[1] || ''; } catch (_) { name = ''; }
        return { file, label: name ? `${name.trim()} (${file})` : file, builder: !!name || /-project\.sh$/.test(file) };
      });
      const project = String(searchParams.get('project') || '');
      const health = await sessions.health();
      return send(views.runFormHtml(esc, { workspace, scripts, project: lib.NAME_RE.test(project) ? project : '', mode: s.defaultMode, canScreen: health.installed }));
    }

    if ((m = rest.match(/^menu\/([a-z0-9_-]+)\/([A-Za-z0-9._-]+)$/))) {
      if (!menuWanted()) return send(notEnabled('The SHELL menu', 'screens / shells'), 404);
      const body = await menuBody(decodeURIComponent(m[1]), decodeURIComponent(m[2]), true);
      return send(body || '<ul class="uk-nav uk-dropdown-nav"><li><span class="uk-text-meta">Nothing for this folder.</span></li></ul>');
    }

    if ((m = rest.match(/^container-form\/([a-z0-9_-]+)\/([A-Za-z0-9._-]+)\/([a-z]+)$/))) {
      if (!sw.shellContainer) return send(notEnabled('A shell or a command in the container', 'shells.container'), 404);
      const p = projectOf(m[1], m[2]);
      const rt = p ? runtimesOf(p.projectDir, m[2], family()).find((r) => r.id === m![3]) : null;
      if (!p || !rt) return send(views.errorHtml(esc, 'This folder is not a project of that runtime.'), 404);
      return send(views.containerFormHtml(esc, m[1], m[2], rt));
    }

    return send(views.errorHtml(esc, 'No such fragment.'), 404);
  });

  // ---------------------------------------------------------------- actions --
  api.addAction('run', async (ctx: ActionContext) => {
    const s = settings();
    if (!s.switches.runInScreen) return ctx.send(notEnabled('"Run in a screen"', 'screens.run_in_screen'), 404);
    const { form, workspace } = ctx;
    if (!lib.isValidWorkspace(workspace)) return ctx.send(views.errorHtml(esc, 'Unknown workspace.'), 400);
    const dir = lib.workspaceDir(workspace);
    const script = String(form.script || '');
    if (!SCRIPT_RE.test(script) || !fs.existsSync(path.join(dir, script))) return ctx.send(views.errorHtml(esc, 'Unknown command.'), 400);
    const project = String(form.projectName || '').trim();
    if (project && !lib.NAME_RE.test(project)) return ctx.send(views.errorHtml(esc, 'Invalid project name.'), 400);
    const flags = String(form.flags || '').trim().split(/\s+/).filter(Boolean);
    const bad = flags.find((f) => !FLAG_RE.test(f));
    if (bad) return ctx.send(views.errorHtml(esc, `An argument may hold letters, digits and = _ . , : @ ^ ~ / + - only: ${bad}`), 400);
    const cmdLine = `bash ${[script, ...(project ? [project] : []), ...flags].map((a) => JSON.stringify(a)).join(' ')}`;
    const label = `${script.replace(/^cmd-|\.sh$/g, '')}${project ? ` ${project}` : ''}`;
    if (String(form.mode || s.defaultMode) === 'page') {
      return ctx.send(runInPage(`${esc(label)} in <strong>${esc(workspace)}</strong>`, cmdLine, dir));
    }
    const live = new Set((await sessions.live()).map((r) => r.session));
    const session = freeName(sessionName(workspace, project, verbOfScript(script)), (n) => live.has(n));
    return startAndAnswer(ctx, { session, command: cmdLine, dir,
      note: { dir: project ? path.join(dir, project) : dir, project, workspace, by: 'run form', kind: 'run', runtime: '' } }, label, project);
  });

  api.addAction('shell', async (ctx: ActionContext) => {
    if (!settings().switches.shellProject) return ctx.send(notEnabled('A shell in the project folder', 'shells.project'), 404);
    const project = String(ctx.form.projectName || '');
    const p = projectOf(ctx.workspace, project);
    if (!p) return ctx.send(views.errorHtml(esc, 'Unknown project.'), 400);
    return startAndAnswer(ctx, { session: sessionName(ctx.workspace, project, 'shell'), command: 'bash -l', dir: p.projectDir, interactive: true,
      note: { dir: p.projectDir, project, workspace: ctx.workspace, by: 'row menu', kind: 'shell', runtime: '' } }, 'a shell in the folder', project);
  });

  const runtimeFor = (ctx: ActionContext): { p: NonNullable<ReturnType<typeof projectOf>>; project: string; rt: ProjectRuntime } | null => {
    const project = String(ctx.form.projectName || '');
    const p = projectOf(ctx.workspace, project);
    if (!p) { ctx.send(views.errorHtml(esc, 'Unknown project.'), 400); return null; }
    const fam = family();
    const all = runtimesOf(p.projectDir, project, fam);
    const rt = all.find((r) => r.id === String(ctx.form.runtime || '')) || (ctx.form.runtime ? null : all[0]);
    if (!rt) { ctx.send(views.errorHtml(esc, noRuntimeMessage(fam)), 409); return null; }
    if (!cliOnPath(rt.cli)) { ctx.send(views.errorHtml(esc, `${rt.cli} is not installed where the dashboard runs: ${rt.cliHint}`), 409); return null; }
    return { p, project, rt };
  };

  api.addAction('container-shell', async (ctx: ActionContext) => {
    if (!settings().switches.shellContainer) return ctx.send(notEnabled('A shell in the container', 'shells.container'), 404);
    const g = runtimeFor(ctx); if (!g) return undefined;
    return startAndAnswer(ctx, { session: sessionName(ctx.workspace, g.project, `shell-${g.rt.id}`), command: guarded(g.rt, g.rt.shell), dir: g.p.projectDir, interactive: true,
      note: { command: g.rt.shell, dir: g.p.projectDir, project: g.project, workspace: ctx.workspace, by: 'row menu', kind: 'container-shell', runtime: g.rt.id } },
    `a shell in the ${g.rt.title} container`, g.project);
  });

  api.addAction('container-run', async (ctx: ActionContext) => {
    if (!settings().switches.shellContainer) return ctx.send(notEnabled('A command in the container', 'shells.container'), 404);
    const command = String(ctx.form.command || '').replace(/[\r\n]+/g, ' ').trim();
    if (!command) return ctx.send(views.errorHtml(esc, 'Give the command to run.'), 400);
    const g = runtimeFor(ctx); if (!g) return undefined;
    const live = new Set((await sessions.live()).map((r) => r.session));
    const session = freeName(sessionName(ctx.workspace, g.project, `${g.rt.id}-run`), (n) => live.has(n));
    const line = g.rt.exec(command);
    return startAndAnswer(ctx, { session, command: guarded(g.rt, line), dir: g.p.projectDir,
      note: { command: line, dir: g.p.projectDir, project: g.project, workspace: ctx.workspace, by: 'row menu', kind: 'container-run', runtime: g.rt.id } },
    `${command} in the ${g.rt.title} container`, g.project);
  });

  const managing = (ctx: ActionContext): boolean => {
    if (settings().switches.page) return true;
    ctx.send(notEnabled('The sessions page', 'screens.page'), 404);
    return false;
  };

  api.addAction('stop', async (ctx: ActionContext) => {
    if (!managing(ctx)) return undefined;
    const session = String(ctx.form.session || '');
    const out = await sessions.stop(session);
    changed(ctx);
    return ctx.send(out.ok ? `<div class="msg assistant flash-now">Stopped <code>${esc(session)}</code>. Its log stays until it is removed.</div>` : views.errorHtml(esc, `Could not stop ${session}: ${out.why}`), out.ok ? 200 : 409);
  });

  api.addAction('remove', async (ctx: ActionContext) => {
    if (!managing(ctx)) return undefined;
    const session = String(ctx.form.session || '');
    const out = await sessions.remove(session);
    changed(ctx);
    return ctx.send(out.ok ? `<div class="msg assistant flash-now">Removed what <code>${esc(session)}</code> left (${out.files.length} file${out.files.length === 1 ? '' : 's'}).</div>` : views.errorHtml(esc, `Could not remove ${session}: ${out.why}`), out.ok ? 200 : 409);
  });

  api.addAction('clean', async (ctx: ActionContext) => {
    if (!managing(ctx)) return undefined;
    const gone = await sessions.clean(true);
    changed(ctx);
    return ctx.send(`<div class="msg assistant flash-now">${gone.length ? `Removed ${gone.length} ended session${gone.length === 1 ? '' : 's'}: ${gone.map((g) => `<code>${esc(g)}</code>`).join(', ')}.` : 'No ended session to remove.'}</div>`);
  });

  api.addAssistantContext(assistantContext);
}
