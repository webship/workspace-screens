#!/usr/bin/env bash

# Arguments of cmd-tools-screens.sh: start a session, and manage the sessions.
argparse "$@" <<ARGEOF || exit 1
parser.add_argument('SESSION',
                    nargs='?',
                    default="_none_",
                    help='The session name (lowercase letters, digits, - _ .). With --run or --shell it is optional: the name is made from the workspace, the project and the command.')
parser.add_argument('-r', '--run',
                    default="_none_",
                    help='Start a session, detached, running this command in this workspace folder; its output goes to the log. Example: --run "bash cmd-tools-backup-dev.sh demo1"')
parser.add_argument('-S', '--shell',
                    dest='open_shell',
                    action='store_true',
                    default=False,
                    help='Start a session with a shell: in the project folder (--project), else in this workspace folder. Attach to use it.')
parser.add_argument('-c', '--container',
                    action='store_true',
                    default=False,
                    help='With --shell: the shell opens inside the project\'s container. With --run: the command runs inside it. DDEV is built in; other runtimes answer through their plugin.')
parser.add_argument('-p', '--project',
                    default="_none_",
                    help='The project the session belongs to: named in the session, shown by the dashboard on its row, and where --shell and --container go.')
parser.add_argument('-l', '--list',
                    action='store_true',
                    default=False,
                    help='List the sessions: running (attached or detached) and ended (with the exit code).')
parser.add_argument('-a', '--attach',
                    action='store_true',
                    default=False,
                    help='Attach this terminal to the session (Ctrl-A D detaches and leaves it running).')
parser.add_argument('-o', '--log',
                    action='store_true',
                    default=False,
                    help='Print the session log (after it ended too).')
parser.add_argument('-n', '--lines',
                    dest='tail_lines',
                    default="0",
                    help='With --log: only the last N lines.')
parser.add_argument('-f', '--follow',
                    action='store_true',
                    default=False,
                    help='Follow the session log until the session ends.')
parser.add_argument('-s', '--stop',
                    action='store_true',
                    default=False,
                    help='Stop the session: whatever runs inside it is ended.')
parser.add_argument('-x', '--clean',
                    action='store_true',
                    default=False,
                    help='Remove what ended sessions left (log and notes): those older than the retention, or one session when it is named.')
parser.add_argument('-A', '--all',
                    action='store_true',
                    default=False,
                    help='With --clean: every ended session, whatever its age.')
parser.add_argument('-k', '--check',
                    action='store_true',
                    default=False,
                    help='Say whether screen is installed here, which version, and whether its sockets directory can be used.')
ARGEOF
