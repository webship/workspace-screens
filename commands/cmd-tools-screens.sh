#!/usr/bin/env bash

# Installed by the Screens plugin (plugins.sh --install screens); __WORKSPACE__ is the workspace it was installed into.
#
# Run a command in a named, detached screen session with a log, and manage the sessions: the same
# sessions the dashboard lists, so one started here shows there and the other way round.
#
#   bash cmd-tools-screens.sh --list
#   bash cmd-tools-screens.sh --run "bash cmd-wordpress-project.sh demo1 --install" --project demo1
#   bash cmd-tools-screens.sh __WORKSPACE__--demo1--build --follow
#   bash cmd-tools-screens.sh __WORKSPACE__--demo1--build --attach
#   bash cmd-tools-screens.sh --shell --project demo1               a shell in the project folder
#   bash cmd-tools-screens.sh --shell --container --project demo1   a shell inside its container
#   bash cmd-tools-screens.sh --run "wp plugin list" --container --project demo1
#   bash cmd-tools-screens.sh __WORKSPACE__--demo1--build --stop
#   bash cmd-tools-screens.sh --clean

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.__WORKSPACE__.settings.yml);

ARGPARSE_DESCRIPTION="Run a command of __WORKSPACE__ in a detached screen session, and manage the sessions"
# The args file comes with the plugin: core/scripts/plugins/screens/ is where plugins.sh --install puts it.
source ${WORKSPACE_SCRIPTS}/plugins/screens/args/arg-screens.sh || exit 1 ;

shift $#;

# The folder this command is installed into: where a command runs, and the first part of a session's name.
SCREENS_WORKSPACE="__WORKSPACE__";
SCREENS_WORKSPACE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)";

screens_command ;
