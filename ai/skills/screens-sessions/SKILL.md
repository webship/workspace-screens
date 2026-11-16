---
name: screens-sessions
description: Run and manage screen sessions in a Webship Workspace with the Screens plugin (`@webship.co/workspace-screens`) — the command `cmd-tools-screens.sh` and every one of its options, how a session is named and which files it leaves, the Sessions button, Run in a screen and the SHELL menu of the dashboard, shells and commands inside a project's container, attaching from a terminal, and the switches of `plugin.screens.settings.yml`. Use when asked "run this in a screen", "what is running", "follow the build", "how did it end", "attach to the session", "open a shell in the container", "where are the logs", "screen is not installed", or "turn the shells off".
argument-hint: '<folder> [<session>]'
---

# screens-sessions

Screen sessions for a Webship Workspace (`~/workspace`, container-based, DDEV by default). It
comes with the Screens plugin (`@webship.co/workspace-screens`), like the agent `screens-runner`,
the command `/screens-list` and the prompt `screens-run-and-follow`.

A long command runs in a named, detached GNU `screen` session with a log. It outlives the
terminal, the browser tab and a restart of the dashboard, which finds it again from `screen` and
from its log.

## What the plugin puts on the dashboard

| Where | Entry | What it does |
| --- | --- | --- |
| Every page | **Sessions** | The list: running (attached or detached) and ended (with the exit code), the last lines of each log, the command to attach, Stop, Remove |
| A workspace page | **Run in a screen** | Any `cmd-*.sh` of the folder, a project and arguments; always a screen session |
| A project row, the SHELL menu | **Shell in the project folder** | A shell in the folder, as a session |
| | **Shell in the container** | A shell inside the project's container |
| | **Run a command in the container…** | One command inside it, as a session with a log |
| | **Run in a screen…** | The form above, for this project |
| | **Sessions of this project** | Its live sessions, each with **Copy attach** |

## The command

`cmd-tools-screens.sh` is placed in every sites and code folder. It lists the same sessions.

```bash
cd ~/workspace/<folder>
bash cmd-tools-screens.sh --check                                   # screen here, its version, the sockets directory, the log folder
bash cmd-tools-screens.sh --list                                    # running and ended
bash cmd-tools-screens.sh --run "bash <cmd-…>.sh <project> <flags>" --project <project>
bash cmd-tools-screens.sh <session> --follow                        # the log, until the session ends
bash cmd-tools-screens.sh <session> --log --lines 40                # the last lines
bash cmd-tools-screens.sh <session> --attach                        # from a terminal; Ctrl-A D leaves it running
bash cmd-tools-screens.sh <session> --stop                          # ends whatever runs in it; the log stays
bash cmd-tools-screens.sh --shell --project <project>               # a shell in the project folder, as a session
bash cmd-tools-screens.sh --shell --container --project <project>   # a shell inside its container
bash cmd-tools-screens.sh --run "<command>" --container --project <project>
bash cmd-tools-screens.sh --clean                                   # remove what ended sessions older than the retention left
bash cmd-tools-screens.sh --clean --all                             # every ended one
bash cmd-tools-screens.sh <session> --clean                         # one ended session
```

A session is named `<folder>--<project>--<verb>` (a builder's verb is `build`), or the name given
first: `bash cmd-tools-screens.sh <name> --run "…"`. A name is lowercase letters, digits, `-`,
`_` and `.`. The command after `--run` is read by the shell twice: words, flags and single quotes
only.

## What a session leaves

In the log folder, `<workspace>/.screens` unless `log_dir:` says otherwise:

| File | What it holds |
| --- | --- |
| `<session>.log` | Its output |
| `<session>.run` | What started it: the command, the folder, the project, who, the kind, the runtime, the time |
| `<session>.exit` | The exit code and when it ended. A session that was stopped leaves none |
| `<session>.cwd` | The folder the work belongs to |

Running means `screen` lists it; ended means it does not.

## Attach from a terminal

```bash
screen -r <session>                                    # the line --run prints; the sockets directory is in front when it is not the default
```

With no `screen` on the machine, and the dashboard in its container, the list of the dashboard
shows a second line that attaches through that container. Attaching needs a terminal: it is for
a person.

## Inside a container

For a DDEV project the shell is `ddev ssh` and one command is `ddev exec '<command>'`. A project on
another runtime (Docker Compose, Lando, Docksal, Podman, Kubernetes) is recognised by that
runtime's own plugin, when it is turned on in the workspace; the SHELL menu says which are not.

## The settings: `core/config/plugin.screens.settings.yml`

Read on every request: a change needs no restart. A group has a master switch and one switch per
element; an element shows only when both are on.

| Group | Key | Default | What it does |
| --- | --- | --- | --- |
| `screens:` | `enabled:` | `true` | The master switch of the three below |
| | `page:` | `true` | The sessions page and the Sessions button |
| | `run_in_screen:` | `true` | "Run in a screen", and the runs the Build form and the row menus hand over |
| | `attach_hints:` | `true` | The attach command beside every session |
| `shells:` | `enabled:` | `true` | The master switch of the two below |
| | `project:` | `true` | A shell in the project folder |
| | `container:` | `true` | A shell, or one command, inside the project's container |
| `runs:` | `log_dir:` | `.screens` | The log folder: in the workspace, or an absolute path |
| | `retention_days:` | `14` | Days an ended session is kept; `0` keeps it until it is removed |
| | `sockets_dir:` | `auto` | Where screen keeps the sockets of the sessions |
| `terminal:` | `command:` | empty | The command that opens a terminal on the machine, with `{attach}` where the attach command goes |

The switches are about what the dashboard shows: the command in a terminal does what is typed.

## Turn it on, and check it

```bash
cd ~/workspace
bash core/scripts/plugins.sh --require @webship.co/workspace-screens
bash core/scripts/plugins.sh --activate screens --with-needs     # adds the AI folders its items land in
bash core/scripts/plugins.sh --install screens
bash core/scripts/plugins.sh --configure screens
bash core/scripts/plugins.sh --check screens                     # screen in the dashboard's container; on the machine it is suggested
```

## Traps

- **"screen is not installed here"**: the command needs `screen` on the machine it is typed on.
  The dashboard has it in its container, so a run can be started there, and attached to with the
  line the dashboard shows.
- **`--attach` says "Not a terminal"**: it was run from something that is not one. Use the attach
  line in a terminal.
- **A session of that name is already running**: attach to it, stop it, or name the new run.
- **`--container` without `--project`** is refused: the container is a project's.
- **A stopped session has no exit code**: the list says "no exit code (stopped)".
- **`--clean` removes logs.** Without `--all`, only of sessions that ended longer ago than
  `retention_days:`.

## The book

For any automated functional testing in this work (a Gherkin feature, a step definition, choosing a
step, a test run and its failures), read the book *Automated Functional Testing Recipes* first.

- **Where.** Use the first that exists: `.claude/automated-functional-testing-recipes/` in the project,
  `~/.claude/automated-functional-testing-recipes/` (installed by webship/webship-js-ai-agent,
  webship/webship-js-skills or webship/ai-agents), or
  https://github.com/webship/webship-js-ai-agent/tree/2.0.x/automated-functional-testing-recipes
- **How.** Its `README.md` first, then the chapter that matches the task (one file per chapter,
  named by its subject), not the single complete file.
- **Which wins.** The installed webship-js package and the step pack are the source of truth for
  step phrasing. When they differ from the book, follow them and say so.
