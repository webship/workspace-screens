---
description: List the screen sessions of a Webship Workspace folder — what is running, what ended and with which exit code — and show the last lines of one session's log. Read-only; nothing is started, stopped or removed.
argument-hint: '<folder> [<session>]'
---

# /screens-list

List the screen sessions: `$ARGUMENTS`

The first word is a workspace folder that carries the command (a sites or a code folder, such as
`dev`). The second word, when there is one, is the name of a session whose log to show. With no
folder, stop and ask for one.

The workspace is container-based (DDEV by default); the command of the Screens plugin
(`@webship.co/workspace-screens`) runs on the machine, in the folder. This command only reads:
never run `cmd-tools-screens.sh` with `--run`, `--shell`, `--stop`, `--clean` or `--attach` here.

## 1. Is the command there

```bash
cd ~/workspace/<folder>
ls cmd-tools-screens.sh
```

If it is not there, stop: the plugin is not installed, or the folder is not a sites or a code folder.

## 2. List

```bash
bash cmd-tools-screens.sh --list
```

Each line is `running` or `ended`, the name of the session, and its state: attached or detached
for a running one, `exit <code>` or "no exit code (stopped)" for an ended one. "No sessions."
is a result.

## 3. The log of one session, when one was named

```bash
bash cmd-tools-screens.sh <session> --log --lines 40
```

## 4. Report

The running sessions first, then the ended ones with their exit codes; say which ended with a
code other than `0`. For a named session: its last lines, and what they say about how it went.
If `--list` says screen is not installed here, say so, and that the Sessions button of the
dashboard lists the same sessions.

For starting or stopping a run, hand over to the agent `screens-runner`.
