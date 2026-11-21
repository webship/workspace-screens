# @webship.co/workspace-screens

Screens and terminals for [Webship Workspace](https://github.com/webship/workspace): the plugin
that manages how work runs. Any `cmd-*.sh` (builders and tools, of the base and of every plugin) runs
in a named, detached GNU `screen` session with a log, started from the dashboard or from your
terminal. A run outlives a dashboard restart and a closed browser tab: the dashboard finds it again
from `screen -ls` and its log, not from memory. Every session shows the exact command to attach
from a terminal of your own, and a project gets a shell in its folder or inside its container, on
whichever container runtime it uses.

It is one of the Webship Workspace plugins: the base is where work starts, and this is added when
you want it, from the terminal or from the dashboard.

## Use it

```bash
cd ~/workspace
bash core/scripts/plugins.sh --require @webship.co/workspace-screens   # npm install into the dashboard
bash core/scripts/plugins.sh --activate screens --with-needs                         # plugins.screens in settings.yml
bash core/scripts/plugins.sh --install screens                          # the command, its functions, the screenrc, the settings
bash core/scripts/plugins.sh --configure screens                        # core/config/plugin.screens.settings.yml
```

The same four steps are buttons on the dashboard's **Settings → Plugins** page. `--install` ends
with the host check (below) and installs nothing on the machine.

**What it needs.** GNU `screen` where the sessions run: the dashboard's container has it; on your
machine it is needed for `cmd-tools-screens.sh` and for `screen -r` in your own terminal
(`sudo apt install -y screen`, `brew install screen`). It needs at least one workspace folder with
commands (a folder plugin such as `dev`), and it works best with a container family plugin
(`@webship.co/workspace-docker`, `-lando`, `-docksal`, `-podman`, `-kubernetes`) for projects that
are not on DDEV. None of them is required: what is missing is said, not guessed.

## What you get

| Where | What |
| --- | --- |
| Every page | The **Sessions** button: every session, running (attached or detached) and ended (with its exit code), what started it, its project, the last lines of its log, the command to attach, Stop, Remove. On a dashboard that offers the Screens panel hook the list is a panel of the Screens page; on one that does not, it is a page of its own, `/screens/runs`. |
| A workspace page | **Run in a screen**: any `cmd-*.sh` of the folder (builders and tools), a project name and arguments. A run is always a screen session: nothing is drawn as a terminal in the page. |
| The Build form, the row menus | On a dashboard that offers the runner hook their runs are handed to the plugin and start in a screen session; the page shows a short notice with **Open in Screens**. With `screens.run_in_screen` off, or on a dashboard without the hook, they run as the base runs them (a dashboard newer than 1.0.12 starts them in a screen session of its own). |
| A project row | The **SHELL** menu: a shell in the project folder, a shell in the container, "Run a command in the container…", "Run in a screen…", and the project's live sessions with their attach command. The menu's body loads when it opens. |
| A session's log | Paged, 200 lines a page, opening on the last one; the last page of a running session follows it. Colour codes and progress-bar rewrites are taken out. |
| Your terminal | `cmd-tools-screens.sh` in every sites and code folder: start, list, attach, log, follow, stop, clean. The same sessions the dashboard lists. |
| Settings | `core/config/plugin.screens.settings.yml`, on the Settings page with a label for every key. |

Nothing blocks a page: the list, a log, a menu's body and a session's tail are fragments that load
after it (HTMX + UIkit, as the plugin contract asks).

## From the terminal

```bash
cd ~/workspace/dev
bash cmd-tools-screens.sh --run "bash cmd-wordpress-project.sh demo1 --install" --project demo1
#   Started 'dev--demo1--build': it keeps running after this terminal closes.
bash cmd-tools-screens.sh --list                          # running (attached, detached) and ended (exit code)
bash cmd-tools-screens.sh dev--demo1--build --follow      # the log, until the session ends
bash cmd-tools-screens.sh dev--demo1--build --attach      # this terminal joins it; Ctrl-A D leaves it running
bash cmd-tools-screens.sh dev--demo1--build --log --lines 40
bash cmd-tools-screens.sh dev--demo1--build --stop
bash cmd-tools-screens.sh --shell --project demo1                 # a shell in the project folder, as a session
bash cmd-tools-screens.sh --shell --container --project demo1     # a shell inside its container
bash cmd-tools-screens.sh --run "wp plugin list" --container --project demo1
bash cmd-tools-screens.sh --clean                         # remove what ended sessions older than the retention left
bash cmd-tools-screens.sh --clean --all                   # …every ended one
bash cmd-tools-screens.sh --check                         # screen here, its version, its sockets directory
```

A session is named `workspace--project--verb` (a builder's verb is `build`), or what you name it:
`bash cmd-tools-screens.sh my-name --run "…"`. The command after `--run` is read by the shell
twice, so keep it to words, flags and single quotes; anything with double quotes or `$` belongs in
a script.

## How a session is kept

Nothing about a session lives in the dashboard's memory. Each has up to four files in the log
folder (`<workspace>/.screens` unless the settings say otherwise), written the same way by the
dashboard and by the terminal command:

| File | What it holds |
| --- | --- |
| `<session>.log` | Its output. A run's output goes to the session's window and to the log (`tee`); a shell is piped nowhere, and screen itself logs its window. |
| `<session>.run` | What started it: the command, the folder, the project, the workspace, who (`dashboard`, `run form`, `row menu`, `terminal`), the kind (`run`, `shell`, `container-shell`, `container-run`), the runtime, the time. |
| `<session>.exit` | The command's exit code and when it ended, written by the session's own last step. A session that was stopped leaves none. |
| `<session>.cwd` | The folder the work belongs to: the note the dashboard's Screens page reads too. |

A session is **running** while `screen -ls` lists it (attached or detached) and **ended** once it
does not. The list is the union of the two, so a dashboard that restarts loses nothing. Ended
sessions older than `runs.retention_days` are removed when the list is drawn; "Remove ended
sessions" and `--clean --all` remove them all. Sessions run under the plugin's own `screenrc`
(ten thousand lines of scrollback, no flow control, UTF-8), never `~/.screenrc`.

## Attach from your own terminal

Beside every running session:

```
Attach from your terminal        docker exec -it ddev-workspace-web screen -r dev--demo1--build
Open in my terminal              gnome-terminal -- docker exec -it ddev-workspace-web screen -r dev--demo1--build
```

`screen -r` takes a detached session; one a terminal already has open is shared with `screen -x`,
and the hint changes with the state. Where the session runs decides the command:

- **A session the plugin started** runs where the dashboard runs. When that is its container, the
  container has a process space of its own (the base, from webship/workspace#564), so a terminal on
  your machine reaches the session only through it: `docker exec -it <container> screen -r <session>`.
  That also works on a machine that has no `screen`. When the dashboard runs on the machine, it is
  `screen -r <session>`.
- **A session on the machine** (the base's host runner's, or one `cmd-tools-screens.sh` started in a
  terminal there) is attached there as it is: `screen -r <session>`.

The second line appears when `terminal.command` is set. The dashboard runs in a container and cannot
open a window on your desktop, so these are commands to copy, not buttons that pretend to.

## The container runtimes

"Shell in the container" and "Run a command in the container" go into the project's own runtime:

| Runtime | Who recognises the project | Shell | One command |
| --- | --- | --- | --- |
| DDEV (the workspace's default) | built in: `.ddev/config.yaml` | `ddev ssh` | `ddev exec '<command>'` |
| Docker Compose | `@webship.co/workspace-docker` | its shell verb | the shell verb with `-c '<command>'` |
| Lando | `@webship.co/workspace-lando` | `lando ssh` | `lando ssh -c '<command>'` |
| Docksal | `@webship.co/workspace-docksal` | `fin bash` | `fin exec '<command>'` |
| Podman | `@webship.co/workspace-podman` | its shell verb | the shell verb with `-c '<command>'` |
| Kubernetes | `@webship.co/workspace-kubernetes` | `kubectl exec -it … -- sh` | the same with `-c '<command>'` |

For every runtime but DDEV the plugin asks the runtime that container plugin exports: its
`detect()` says whether the folder is its project, its shell verb is the command. Detection is
never repeated here, and a plugin is asked only when it is turned on in this workspace. A runtime
that brings an `exec` of its own is used as it is. When nothing recognises a folder the menu says
which container plugins are not turned on; when a runtime's CLI is not installed where the
dashboard runs, the menu says so with the link to install it, and a session started from the
terminal says it in its log.

## Settings

`core/config/plugin.screens.settings.yml`, read on every request: a change needs no restart. Every
part the plugin shows is a switch. A group has a master switch and one switch per element, and an
element shows only when both are on.

| Key | Default | What it does |
| --- | --- | --- |
| `screens.enabled` | `true` | Master switch of the three below. |
| `screens.page` | `true` | The sessions page, its panel on the Screens page and the Sessions button. |
| `screens.run_in_screen` | `true` | "Run in a screen" (the form, the row menu entry) and the runs the Build form and the row menus hand over. Off: the plugin steps aside and those runs stay with the dashboard's own runner. |
| `screens.attach_hints` | `true` | The attach commands beside every session. |
| `shells.enabled` | `true` | Master switch of the two below. |
| `shells.project` | `true` | A shell in the project folder. |
| `shells.container` | `true` | A shell, or one command, inside the project's container. |
| `runs.log_dir` | `.screens` | The log folder: in the workspace, or an absolute path. |
| `runs.retention_days` | `14` | Days an ended session is kept; `0` keeps it until you remove it. |
| `runs.sockets_dir` | `auto` | Where screen keeps the sessions' sockets (below). |
| `terminal.command` | empty | The command that opens a terminal on your machine, with `{attach}` where the attach command goes. |

With a switch off the element is not drawn at all (no dead link, no empty menu, no empty group in
the navigation), its address answers "not enabled" and names the key, and a run goes back to the
dashboard's own runner. Everything ships on, shells included: adding the plugin is asking for it.
A team that does not want shells opened from the dashboard sets `shells.enabled: false`; one that
wants only the terminal command sets `screens.enabled: false` too. The switches are about what the
dashboard shows: `cmd-tools-screens.sh` in your own terminal does what you type.

The dashboard's own Screens page and its button belong to the base. They are arranged, moved or
hidden in **Settings → Navigation**.

## The host side

```bash
bash core/scripts/plugins/screens/host-install.sh --check
```

It says whether `screen` is installed on this machine and in the dashboard's container and which
version each is, the sockets directory with its owner and mode and whether screen can use it, and
where the `screenrc` is. It reports and never installs: nothing in it runs `sudo`. What is missing
is said with the exact command to type.

**The sockets directory.** A session lives in a socket. `runs.sockets_dir: auto` uses screen's own
directory (`/run/screen`) where the sessions are started while screen can use it, and falls back to
`<log folder>/sockets`, a folder inside the workspace that needs no root, when screen refuses it (a
machine where the `screen` package was never installed leaves `/run/screen` closed to users). The
attach commands always carry the directory in use. In the fallback the base's own Screens grid,
which reads screen's own directory, does not list these sessions; the Sessions list does.

**Where a session runs.** A session the dashboard starts runs where the dashboard runs: in its
container, which has the workspace at the same path, `ddev` and `docker`. A session
`cmd-tools-screens.sh` starts runs where you typed it. The dashboard's container has a process
space and a screen socket directory of its own (the base, from webship/workspace#564), so screen in
it cannot see the sessions on your machine. The Sessions list takes those from the base's host
runner, which lists them, and **Stop** on one goes through the runner too; the plugin's own
sessions are stopped where they run. A dashboard older than that still shares the machine's
sessions with its container, and lists them through screen itself.

## The items it carries

The workspace is container-based (DDEV by default). Each item lands in the folder of its kind, when
that folder is an active workspace folder, is listed there like any other item, and is installed
into Claude Code from there:

| What | Lands in | What it is for |
| --- | --- | --- |
| The agent `screens-runner` | `ai-agents/` | Runs a command of a folder as a session with `cmd-tools-screens.sh --run`, follows its log, reports the exit code, and leaves other people's sessions alone |
| The skill `screens-sessions` | `ai-skills/` | Every option of `cmd-tools-screens.sh`, how a session is named and what it leaves, the entries of the dashboard, the switches of `plugin.screens.settings.yml` |
| The command `/screens-list` | `ai-commands/` | `/screens-list <folder> [<session>]`: what is running, what ended and how, the last lines of a log. Read-only |
| The prompt `screens-run-and-follow` | `ai-prompts/` | The launch command of a session that runs one command in a screen, follows it to the end and reports |

The plugin keeps its one command, `cmd-tools-screens.sh`; no other was added. The item bodies are plain Markdown any AI command-line assistant can follow; Claude Code is the default shape (frontmatter, the launch command of the prompt).

How the items are laid out and checked: [docs/plugin-items-pattern.md](docs/plugin-items-pattern.md).

## What it needs

It needs the AI folders its items are placed in (`needs`): `ai-agents`, `ai-skills`, `ai-commands` and `ai-prompts`. `--require` says so, `--activate` and `--install` stop until the workspace has them, and `--with-needs` adds what is missing first. A kind whose folder is not an active workspace folder is skipped, and the install says so.

## What the package holds

| Path | What it is |
| --- | --- |
| `src/index.ts` | `register(api)`: the Sessions button, the page, the fragments, the actions, the SHELL menu, the runner and the Screens panel |
| `src/lib/sessions.ts` | Start, list, stop, remove, clean: always asked of screen and of the log folder |
| `src/lib/store.ts` | The four files of a session, the list, the retention, the paged log |
| `src/lib/screen.ts` | `screen -ls`, the start arguments, the sockets directory, the attach commands |
| `src/lib/runtime.ts` | DDEV, and the container family's runtimes asked through their own packages |
| `src/lib/settings.ts` | The settings and the switches |
| `src/lib/views.ts` | The fragments |
| `src/cli.ts` | The helper the terminal command asks about a project that is not on DDEV |
| `commands/cmd-tools-screens.sh` | The per-workspace command, installed into every `sites` and `code` folder |
| `scripts/functions/fun-screens.sh`, `scripts/args/arg-screens.sh` | The bash functions behind it and its argparse |
| `scripts/host-install.sh` | The host check |
| `config/plugin.screens.settings.yml`, `config/settings.labels.yml` | The settings template and the labels of its keys |
| `config/screenrc` | The screen configuration of the sessions |
| `css/screens.css` | The plugin's styles, appended after the dashboard's |
| `features/screens.feature` | Scenarios the dashboard's own suite runs once the plugin is installed |
| `ai/agents/screens-runner.md` | The agent `screens-runner` |
| `ai/skills/screens-sessions/` | The skill `screens-sessions` |
| `ai/commands/screens-list.md` | The command `/screens-list` |
| `ai/prompts/screens-run-and-follow.md` | The prompt `screens-run-and-follow` |
| `tests/items.test.ts` | The shape of every item, and that it names nothing the plugin does not have |

The `workspacePlugin` block in `package.json` is the manifest the installer reads. `--uninstall`
removes exactly what `--install` placed; the logs of your sessions in `.screens/` are yours and
stay until you remove them.

## Develop

```bash
npm install     # builds src/ to dist/
npm run lint
npm test        # unit tests; the session tests start real sessions in a sockets directory of their own, and are skipped without screen
```

The plugin reaches the dashboard only through `api` and requires nothing from the dashboard's own
files. Two hooks are newer than Webship Workspace 1.0.9: `api.addRunner` (the Build form and the
row menus hand their runs over) and `api.addScreensPanel` (the list on the Screens page). The
plugin registers on a dashboard without them, where everything else works the same, and uses them
when `api.capabilities` names them (`runner`, `screens-panel`).
