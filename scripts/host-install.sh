#!/usr/bin/env bash
## The host side of the Screens plugin: screen on this machine and where the dashboard runs, the
## sockets directory both must see, and the screenrc. Run by core/scripts/plugins.sh --install
## screens (with --check) and by core/scripts/install.sh for every installed plugin that ships one.
##
##   bash core/scripts/plugins/screens/host-install.sh --check
##
## It reports and never installs: nothing here runs sudo. What is missing is said with the exact
## command to type. Without --check it does the same, so a full install changes nothing unasked.
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTAINER="${WORKSPACE_DASHBOARD_CONTAINER:-ddev-workspace-web}"
ok()   { printf '  ✓ %-22s %s\n' "$1" "$2" ; }
miss() { printf '  ✗ %-22s %s\n' "$1" "$2" ; }
note() { printf '  ! %-22s %s\n' "$1" "$2" ; }

install_hint() {
  if command -v apt-get > /dev/null 2>&1 ; then echo 'sudo apt install -y screen' ;
  elif command -v dnf > /dev/null 2>&1 ; then echo 'sudo dnf install -y screen' ;
  elif command -v pacman > /dev/null 2>&1 ; then echo 'sudo pacman -S screen' ;
  elif command -v brew > /dev/null 2>&1 ; then echo 'brew install screen' ;
  else echo 'install GNU screen with the package manager of this machine' ; fi
}

# What screen says about a sockets directory it cannot use, or nothing.
default_problem() {
  ( unset SCREENDIR ; "$@" screen -ls 2>&1 ) | grep -E "^(Directory '.*' must have mode|Cannot (make|access) directory|You are not the owner of)" | head -n 1
}

# 1. screen on this machine: what `screen -r <session>` in a terminal of yours needs.
HOST_SCREEN=''
if command -v screen > /dev/null 2>&1 ; then
  HOST_SCREEN="$(screen --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n 1)"
  ok "screen ($([ -f /.dockerenv ] && echo 'this container' || echo 'this machine'))" "${HOST_SCREEN:-found} — $(command -v screen)"
else
  miss 'screen (this machine)' "missing — attach from your own terminal and cmd-tools-screens.sh need it:  $(install_hint)"
fi

# 2. screen where the dashboard runs: what starts the sessions the dashboard is asked for.
IN_CONTAINER=''
[ -f /.dockerenv ] && IN_CONTAINER='yes'
BOX_SCREEN=''
BOX=()
if [ -n "${IN_CONTAINER}" ] ; then
  note 'dashboard container' 'this check runs inside it: the lines above are about the container'
elif command -v docker > /dev/null 2>&1 && docker inspect "${CONTAINER}" > /dev/null 2>&1 ; then
  BOX=( docker exec "${CONTAINER}" )
  BOX_SCREEN="$("${BOX[@]}" screen --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n 1)"
  if [ -n "${BOX_SCREEN}" ] ; then
    ok 'screen (dashboard)' "${BOX_SCREEN} — in ${CONTAINER}"
    if [ -n "${HOST_SCREEN}" ] && [ "${HOST_SCREEN%.*}" != "${BOX_SCREEN%.*}" ] ; then
      note 'versions' "${HOST_SCREEN} here and ${BOX_SCREEN} in the dashboard: a session started by one may refuse the other; attach through the container when it does"
    fi
  else
    miss 'screen (dashboard)' "missing in ${CONTAINER} — the dashboard image installs it; rebuild it with:  ddev restart   (in core/workspace-app)"
  fi
else
  note 'dashboard container' "${CONTAINER} is not running: start the dashboard to check the container side"
fi

# 3. The sockets directory. A session lives in a socket; the machine and the dashboard see the same
#    sessions only when both use the same directory, as the same user.
DEFAULT_DIR="$(ls -d /run/screen /var/run/screen 2>/dev/null | head -n 1)"
if [ -n "${DEFAULT_DIR}" ] ; then
  ok 'sockets directory' "${DEFAULT_DIR} — $(stat -c '%U:%G mode %a' "${DEFAULT_DIR}" 2>/dev/null)"
else
  note 'sockets directory' 'no /run/screen here yet: screen makes it on its first run, the package on install'
fi
PROBLEM=''
if [ -n "${HOST_SCREEN}" ] ; then PROBLEM="$(default_problem)" ; fi
if [ -z "${PROBLEM}" ] && [ -n "${BOX_SCREEN}" ] ; then PROBLEM="$(default_problem "${BOX[@]}")" ; [ -n "${PROBLEM}" ] && PROBLEM="in the dashboard: ${PROBLEM}" ; fi
if [ -n "${PROBLEM}" ] ; then
  note 'sockets directory' "${PROBLEM}"
  echo "      The plugin then keeps its sockets in <workspace>/.screens/sockets (runs.sockets_dir: auto), which needs no root:"
  echo "      attach with the command the dashboard shows beside the session. To share screen's own directory instead:"
  if [ -z "${HOST_SCREEN}" ] ; then
    echo "        $(install_hint)        # its package makes /run/screen usable on every boot"
  else
    echo "        sudo chmod 1777 ${DEFAULT_DIR:-/run/screen}        # until the next boot; reinstalling the screen package makes it stay"
  fi
elif [ -n "${HOST_SCREEN}${BOX_SCREEN}" ] ; then
  ok 'sockets shared' 'screen can use its own directory: the machine and the dashboard list the same sessions'
fi
if [ -n "${BOX_SCREEN}" ] && [ "$("${BOX[@]}" sh -c 'ls -d /run/screen 2>/dev/null')" == '' ] ; then
  note 'sockets mount' "/run/screen is not mounted into ${CONTAINER}: sessions of the dashboard are reached through the container (docker exec -it ${CONTAINER} screen -r <session>)"
fi

# 4. The screenrc the sessions run under: the plugin's own, never ~/.screenrc.
if [ -f "${HERE}/screenrc" ] ; then
  ok 'screenrc' "${HERE}/screenrc"
elif [ -f "${HERE}/../config/screenrc" ] ; then
  ok 'screenrc' "$(cd "${HERE}/../config" && pwd)/screenrc (in the package; placed by --install)"
else
  miss 'screenrc' 'not placed — run: bash core/scripts/plugins.sh --install screens'
fi
exit 0
