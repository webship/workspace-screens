/**
 * The plugin's settings, read from core/config/plugin.screens.settings.yml.
 *
 * Everything the plugin shows is a switch. A group has one master switch ("screens", "shells") and
 * one switch per element; an element is on only when its own switch and its group's are. With a
 * switch off the element is not drawn, its route answers "not enabled", and a run goes back to the
 * runner of the page.
 */

export interface Switches {
  /** The sessions page, its panel on the Screens page and the button that opens it. */
  page: boolean;
  /** "Run in a screen": the form, the row menu entry, and the runs the Build form and the row menus hand over. */
  runInScreen: boolean;
  /** The command to attach from a terminal of your own, beside every session. */
  attachHints: boolean;
  /** A shell in the project folder, as a session. */
  shellProject: boolean;
  /** A shell, or one command, inside the project's container. */
  shellContainer: boolean;
}

export interface Settings {
  switches: Switches;
  /** 'screen' or 'page': how a run starts when nobody chose. */
  defaultMode: 'screen' | 'page';
  /** Where the logs and the notes of the sessions live: absolute, or relative to the workspace root. */
  logDir: string;
  /** Days an ended session's log is kept; 0 keeps it until it is removed by hand. */
  retentionDays: number;
  /** 'auto', or a directory for the sockets of the sessions. */
  socketsDir: string;
  /** The command that opens a terminal on this machine, with {attach} where the attach command goes; '' for none. */
  terminalCommand: string;
}

export const DEFAULTS: Settings = {
  switches: { page: true, runInScreen: true, attachHints: true, shellProject: true, shellContainer: true },
  defaultMode: 'screen',
  logDir: '.screens',
  retentionDays: 14,
  socketsDir: 'auto',
  terminalCommand: '',
};

/** A YAML boolean, or the words people type for one. Anything else is the default. */
export function flag(value: unknown, fallback: boolean): boolean {
  if (value === true || value === false) return value;
  const s = String(value ?? '').trim().toLowerCase();
  if (['true', 'yes', 'on', '1'].includes(s)) return true;
  if (['false', 'no', 'off', '0'].includes(s)) return false;
  return fallback;
}

const block = (raw: unknown, key: string): Record<string, unknown> => {
  const v = raw && typeof raw === 'object' ? (raw as Record<string, unknown>)[key] : null;
  return v && typeof v === 'object' ? v as Record<string, unknown> : {};
};

/** The settings as the plugin uses them: defaults filled in, the master switches applied. */
export function readSettings(raw: unknown): Settings {
  const screens = block(raw, 'screens');
  const shells = block(raw, 'shells');
  const runs = block(raw, 'runs');
  const terminal = block(raw, 'terminal');
  const d = DEFAULTS;
  const screensOn = flag(screens.enabled, true);
  const shellsOn = flag(shells.enabled, true);
  const days = Number(runs.retention_days);
  const mode = String(runs.default_mode ?? '').trim().toLowerCase();
  return {
    switches: {
      page: screensOn && flag(screens.page, d.switches.page),
      runInScreen: screensOn && flag(screens.run_in_screen, d.switches.runInScreen),
      attachHints: screensOn && flag(screens.attach_hints, d.switches.attachHints),
      shellProject: shellsOn && flag(shells.project, d.switches.shellProject),
      shellContainer: shellsOn && flag(shells.container, d.switches.shellContainer),
    },
    defaultMode: mode === 'page' ? 'page' : 'screen',
    logDir: String(runs.log_dir ?? '').trim() || d.logDir,
    retentionDays: Number.isFinite(days) && days >= 0 ? Math.floor(days) : d.retentionDays,
    socketsDir: String(runs.sockets_dir ?? '').trim() || d.socketsDir,
    terminalCommand: String(terminal.command ?? '').trim(),
  };
}

/** Whether anything of a session can be shown at all: the page, a run, or a shell. */
export function anySession(s: Switches): boolean {
  return s.page || s.runInScreen || s.shellProject || s.shellContainer;
}

/** The plain answer of a route whose switch is off. */
export function notEnabled(what: string, key: string): string {
  return `<div class="msg error flash-now">${what} is not enabled in this workspace (<code>${key}</code> in <code>core/config/plugin.screens.settings.yml</code>).</div>`;
}
