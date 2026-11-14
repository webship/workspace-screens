#!/usr/bin/env bash

# The Screens plugin, from the terminal: detached screen sessions with a log and a note of what
# started them, in the same folder the dashboard reads, so a session started here shows there.
#
# Per session, in the log folder (<workspace>/.screens unless the settings say otherwise):
#   <session>.log   its output            <session>.run   what started it (key=value lines)
#   <session>.exit  "<code> <epoch>"      <session>.cwd   the folder the work belongs to

# Where the logs and the notes live.
function screens_log_dir() {
  local dir="${plugin_screens_runs_log_dir:-.screens}" ;
  case "${dir}" in
    /*) echo "${dir}" ;;
    *) echo "${WORKSPACE_ROOT}/${dir}" ;;
  esac
}

# What screen says about its own sockets directory when it cannot use it, or nothing.
function screens_default_problem() {
  ( unset SCREENDIR ; screen -ls 2>&1 ) | grep -E "^(Directory '.*' must have mode|Cannot (make|access) directory|You are not the owner of)" | head -n 1 ;
}

# The sockets directory: SCREENDIR when it is set, the settings' own, else screen's (empty) while it
# can be used and <log folder>/sockets when it cannot. The dashboard decides the same way.
function screens_sockets_dir() {
  if [ -n "${SCREENDIR:-}" ] ; then echo "${SCREENDIR}" ; return 0 ; fi
  local setting="${plugin_screens_runs_sockets_dir:-auto}" ;
  if [ -n "${setting}" ] && [ "${setting}" != 'auto' ] ; then echo "${setting/#\~/${HOME}}" ; return 0 ; fi
  if [ -n "$(screens_default_problem)" ] ; then echo "$(screens_log_dir)/sockets" ; fi
}

# screen, with the plugin's sockets directory and configuration.
function screens_screen() {
  local sockets ; sockets="$(screens_sockets_dir)" ;
  if [ -n "${sockets}" ] ; then
    mkdir -p "${sockets}" && chmod 700 "${sockets}" 2>/dev/null ;
    SCREENDIR="${sockets}" screen "$@" ;
  else
    screen "$@" ;
  fi
}

# The exact line of `screen -ls` for a session, or nothing: a name that only starts alike never matches.
function screens_live_line() {
  screens_screen -ls 2>/dev/null | grep -E "^[[:space:]]+[0-9]+[.]${1//./[.]}[[:space:]]" | head -n 1 ;
}

function screens_is_live() {
  [ -n "$(screens_live_line "$1")" ] ;
}

# How to attach from another terminal.
function screens_attach_command() {
  local sockets ; sockets="$(screens_sockets_dir)" ;
  echo "${sockets:+SCREENDIR=${sockets} }screen -r ${1}" ;
}

# A name made of the workspace, the project and what runs: lowercase, at most 60 characters.
function screens_session_name() {
  local name ;
  name="$(echo "${1}--${2}--${3}" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9._-]+/-/g; s/-{3,}/--/g; s/(^|--)--+/\1/g; s/^[-._]+//; s/[-._]+$//')" ;
  if [ "${#name}" -gt 60 ] ; then
    name="$(echo "${name:0:53}" | sed -E 's/[-._]+$//')-$(printf '%s' "${name}" | sha1sum | cut -c1-6)" ;
  fi
  echo "${name}" ;
}

# The verb of a command line: a builder is "build", a tool is its file's name, anything else its first word.
function screens_verb_of() {
  local first="${1%% *}" script ;
  script="$(echo "${1}" | grep -oE 'cmd-[A-Za-z0-9._-]+\.sh' | head -n 1)" ;
  if [ -n "${script}" ] ; then
    script="${script#cmd-}" ; script="${script%.sh}" ;
    case "${script}" in *-project) echo 'build' ;; *) echo "${script}" ;; esac
  else
    basename "${first}" ;
  fi
}

# The helper of the plugin that asks the container plugins about a folder (it needs node).
function screens_runtime_helper() {
  echo "${WORKSPACE_PATH}/workspace-app/node_modules/@webship.co/workspace-screens/dist/src/cli.js" ;
}

# Which runtime the project's container belongs to: ddev, or the id a container plugin answers with.
function screens_runtime_id() {
  local project_dir="$1" project="$2" helper ;
  if [ -f "${project_dir}/.ddev/config.yaml" ] ; then echo 'ddev' ; return 0 ; fi
  helper="$(screens_runtime_helper)" ;
  if ! command -v node > /dev/null 2>&1 || [ ! -f "${helper}" ] ; then
    echo "${project} is not a DDEV project, and the runtimes of the container plugins are asked through node, which is not available here." >&2 ;
    return 1 ;
  fi
  node "${helper}" runtime-id "${WORKSPACE_CONFIG}/settings.yml" "${project_dir}" "${project}" ;
}

# How a shell, or one command, goes into the project's container. DDEV is answered here; any other
# runtime is asked of its plugin, never guessed.
function screens_container_line() {
  local runtime="$1" project_dir="$2" project="$3" what="$4" command="$5" ;
  if [ "${runtime}" == 'ddev' ] ; then
    if ! command -v ddev > /dev/null 2>&1 ; then echo "ddev is not installed here: https://docs.ddev.com/en/stable/users/install/" >&2 ; return 1 ; fi
    if [ "${what}" == 'shell' ] ; then echo 'ddev ssh' ; else printf 'ddev exec %q\n' "${command}" ; fi
    return 0 ;
  fi
  node "$(screens_runtime_helper)" "runtime-${what}" "${WORKSPACE_CONFIG}/settings.yml" "${project_dir}" "${project}" "${command}" ;
}

function screens_check() {
  echo "screen, where this command runs ($(hostname)):" ;
  if ! command -v screen > /dev/null 2>&1 ; then
    echo "  ✗ screen is not installed. Install it with:  sudo apt install -y screen   (macOS: brew install screen)" ;
    echo "    Until then the sessions can run where the dashboard runs: start them from the dashboard, and attach with the command it shows." ;
    return 1 ;
  fi
  echo "  ✓ $(screen --version 2>/dev/null | head -n 1)" ;
  local problem sockets ;
  problem="$(screens_default_problem)" ; sockets="$(screens_sockets_dir)" ;
  if [ -n "${problem}" ] ; then echo "  ! its own sockets directory cannot be used: ${problem}" ; fi
  echo "  sockets: ${sockets:-the directory screen uses by default}" ;
  echo "  logs:    $(screens_log_dir)" ;
  return 0 ;
}

function screens_list() {
  local logdir live name state code line any='' ;
  logdir="$(screens_log_dir)" ;
  live="$(screens_screen -ls 2>/dev/null | sed -n -E 's/^[[:space:]]+[0-9]+[.]([^[:space:]]+)[[:space:]].*\((Attached|Detached|Dead[^)]*)\).*$/\1 \2/p')" ;
  while read -r name state ; do
    [ -n "${name}" ] || continue ; any='yes' ;
    printf '  %-10s %-48s %s\n' "running" "${name}" "$(echo "${state}" | tr '[:upper:]' '[:lower:]')$([ -f "${logdir}/${name}.log" ] && echo ' · log')" ;
  done <<< "${live}" ;
  for line in "${logdir}"/*.run ; do
    [ -f "${line}" ] || continue ;
    name="$(basename "${line}" .run)" ;
    echo "${live}" | grep -q -E "^${name//./[.]} " && continue ;
    any='yes' ;
    code="$(cut -d' ' -f1 "${logdir}/${name}.exit" 2>/dev/null)" ;
    printf '  %-10s %-48s %s\n' "ended" "${name}" "$([ -n "${code}" ] && echo "exit ${code}" || echo 'no exit code (stopped)')" ;
  done
  [ -n "${any}" ] || echo "No sessions." ;
  return 0 ;
}

function screens_clean() {
  local logdir name days now ended removed=0 ;
  logdir="$(screens_log_dir)" ; days="${plugin_screens_runs_retention_days:-14}" ; now="$(date +%s)" ;
  if [ -n "${SESSION}" ] && [ "${SESSION}" != '_none_' ] ; then
    if screens_is_live "${SESSION}" ; then echo "'${SESSION}' is still running: stop it first." ; return 1 ; fi
    rm -f "${logdir}/${SESSION}".{log,run,exit,cwd} && echo "Removed what '${SESSION}' left." ;
    return 0 ;
  fi
  for name in "${logdir}"/*.run ; do
    [ -f "${name}" ] || continue ;
    name="$(basename "${name}" .run)" ;
    screens_is_live "${name}" && continue ;
    if [ "${ALL}" != 'yes' ] ; then
      [ "${days}" -gt 0 ] 2>/dev/null || continue ;
      ended="$(cut -d' ' -f2 "${logdir}/${name}.exit" 2>/dev/null)" ;
      [ -n "${ended}" ] || ended="$(stat -c %Y "${logdir}/${name}.log" 2>/dev/null || echo "${now}")" ;
      [ $(( now - ended )) -gt $(( days * 86400 )) ] || continue ;
    fi
    rm -f "${logdir}/${name}".{log,run,exit,cwd} ; removed=$(( removed + 1 )) ;
    echo "  removed ${name}" ;
  done
  if [ "${ALL}" == 'yes' ] ; then echo "Removed ${removed} ended session(s)." ; else echo "Removed ${removed} ended session(s) older than ${days} day(s). --all removes every ended one." ; fi
  return 0 ;
}

function screens_command() {
  local logdir ; logdir="$(screens_log_dir)" ;
  local workspace="${SCREENS_WORKSPACE:-workspace}" workspace_dir="${SCREENS_WORKSPACE_DIR:-${WORKSPACE_ROOT}}" ;
  local project='' ;
  if [ -n "${PROJECT}" ] && [ "${PROJECT}" != '_none_' ] ; then project="${PROJECT%/}" ; fi

  if [ "${CHECK}" == 'yes' ] ; then screens_check ; return $? ; fi

  if ! command -v screen > /dev/null 2>&1 ; then
    echo "screen is not installed here. Install it with:  sudo apt install -y screen   (macOS: brew install screen)" ;
    echo "Until then, start the run from the dashboard: its sessions run where the dashboard runs, and it shows the command to attach." ;
    return 1 ;
  fi
  mkdir -p "${logdir}" ;

  if [ "${LIST}" == 'yes' ] ; then screens_list ; return 0 ; fi
  if [ "${CLEAN}" == 'yes' ] ; then screens_clean ; return $? ; fi

  local starting='' command='' kind='run' ;
  if [ -n "${RUN}" ] && [ "${RUN}" != '_none_' ] ; then starting='yes' ; command="${RUN}" ; fi
  if [ "${OPEN_SHELL}" == 'yes' ] && [ -z "${starting}" ] ; then starting='yes' ; kind='shell' ; fi

  if [ -n "${starting}" ] ; then
    local dir="${workspace_dir}" owner="${workspace_dir}" line verb ;
    SCREENS_RUNTIME='' ;
    if [ -n "${project}" ] ; then
      owner="${workspace_dir}/${project}" ;
      if [ "${kind}" == 'shell' ] || [ "${CONTAINER}" == 'yes' ] ; then
        [ -d "${owner}" ] || { echo "No project folder ${owner}." ; return 1 ; } ;
        dir="${owner}" ;
      fi
    fi
    if [ "${CONTAINER}" == 'yes' ] ; then
      [ -n "${project}" ] || { echo "--container needs --project: the container is a project's." ; return 1 ; } ;
      SCREENS_RUNTIME="$(screens_runtime_id "${dir}" "${project}")" || return 1 ;
      if [ "${kind}" == 'shell' ] ; then
        line="$(screens_container_line "${SCREENS_RUNTIME}" "${dir}" "${project}" shell '')" || return 1 ;
        kind='container-shell' ; verb="shell-${SCREENS_RUNTIME}" ;
      else
        line="$(screens_container_line "${SCREENS_RUNTIME}" "${dir}" "${project}" exec "${command}")" || return 1 ;
        kind='container-run' ; verb="${SCREENS_RUNTIME}-run" ;
      fi
    elif [ "${kind}" == 'shell' ] ; then
      line='exec bash -l' ; verb='shell' ;
    else
      line="${command}" ; verb="$(screens_verb_of "${command}")" ;
    fi
    local session="${SESSION}" ;
    if [ -z "${session}" ] || [ "${session}" == '_none_' ] ; then session="$(screens_session_name "${workspace}" "${project}" "${verb}")" ; fi
    if ! echo "${session}" | grep -qE '^[a-z0-9][a-z0-9_.-]{0,79}$' ; then
      echo "A session name is lowercase letters, digits, - _ . only." ; return 1 ;
    fi
    if screens_is_live "${session}" ; then
      echo "'${session}' is already running: attach to it, stop it, or give this run another name." ; return 1 ;
    fi
    local logfile="${logdir}/${session}.log" exitfile="${logdir}/${session}.exit" rc="${WORKSPACE_SCRIPTS}/plugins/screens/screenrc" ;
    : > "${logfile}" ; rm -f "${exitfile}" ;
    local noted="${command:-${line}}" ;
    [ "${kind}" == 'shell' ] && noted='bash -l' ;
    noted="$(echo "${noted}" | tr '\n' ' ' | sed -E 's/[[:space:]]+$//')" ;
    printf 'command=%s\ndir=%s\nproject=%s\nworkspace=%s\nby=terminal\nkind=%s\nruntime=%s\nstarted=%s\n' \
      "${noted}" "${owner}" "${project}" "${workspace}" "${kind}" "${SCREENS_RUNTIME}" "$(date +%s)" > "${logdir}/${session}.run" ;
    echo "${owner}" > "${logdir}/${session}.cwd" ;
    local -a opts=( -T xterm-256color ) ;
    [ -f "${rc}" ] && opts=( -c "${rc}" "${opts[@]}" ) ;
    local inner ;
    if [ "${kind}" == 'shell' ] || [ "${kind}" == 'container-shell' ] ; then
      # A shell: nothing between it and the terminal; screen keeps the log of the window.
      opts+=( -L -Logfile "${logfile}" ) ;
      inner="${line} ; printf '%s %s\n' \"\$?\" \"\$(date +%s)\" > $(printf '%q' "${exitfile}")" ;
    else
      # A run: its output on the window and in the log, its exit code noted last.
      inner="{ ${line} ; } 2>&1 | tee -a $(printf '%q' "${logfile}") ; printf '%s %s\n' \"\${PIPESTATUS[0]}\" \"\$(date +%s)\" > $(printf '%q' "${exitfile}")" ;
    fi
    ( cd "${dir}" && TERM=xterm-256color screens_screen "${opts[@]}" -dmS "${session}" bash -lc "${inner}" ) ;
    sleep 1 ;
    if ! screens_is_live "${session}" ; then
      if [ -s "${logfile}" ] || [ -f "${exitfile}" ] ; then
        local ended_code ; ended_code="$(cut -d' ' -f1 "${exitfile}" 2>/dev/null)" ;
        echo "'${session}' already ended (exit ${ended_code:-unknown}). Its output:" ;
        cat "${logfile}" ;
        return 0 ;
      fi
      echo "'${session}' did not start and wrote nothing. bash $(basename "${BASH_SOURCE[1]:-cmd-tools-screens.sh}") --check says what screen needs." ;
      return 1 ;
    fi
    echo "Started '${session}': it keeps running after this terminal closes." ;
    echo "  attach:  $(screens_attach_command "${session}")   (Ctrl-A D detaches and leaves it running)" ;
    echo "  follow:  bash cmd-tools-screens.sh ${session} --follow" ;
    echo "  stop:    bash cmd-tools-screens.sh ${session} --stop" ;
    echo "  log:     ${logfile}" ;
    return 0 ;
  fi

  if [ -z "${SESSION}" ] || [ "${SESSION}" == '_none_' ] ; then
    echo "Name a session, or use --list, --run, --shell, --clean or --check." ; return 1 ;
  fi
  if ! echo "${SESSION}" | grep -qE '^[a-z0-9][a-z0-9_.-]{0,79}$' ; then
    echo "A session name is lowercase letters, digits, - _ . only." ; return 1 ;
  fi
  local logfile="${logdir}/${SESSION}.log" ;

  if [ "${STOP}" == 'yes' ] ; then
    local live ; live="$(screens_live_line "${SESSION}" | awk '{print $1}')" ;
    if [ -z "${live}" ] ; then echo "No session called '${SESSION}' is running." ; return 1 ; fi
    screens_screen -S "${live}" -X quit && echo "Stopped '${SESSION}'. Its log stays: ${logfile}" ;
    return $? ;
  fi

  if [ "${ATTACH}" == 'yes' ] ; then
    if ! screens_is_live "${SESSION}" ; then echo "No session called '${SESSION}' is running. --log prints what it left." ; return 1 ; fi
    if [ ! -t 0 ] ; then echo "Not a terminal. Attach from one with:  $(screens_attach_command "${SESSION}")" ; return 1 ; fi
    screens_screen -x "${SESSION}" ;
    return $? ;
  fi

  if [ "${FOLLOW}" == 'yes' ] ; then
    [ -f "${logfile}" ] || { echo "No log for '${SESSION}'." ; return 1 ; } ;
    tail -n +1 -F "${logfile}" 2>/dev/null &
    local tp=$! ;
    while screens_is_live "${SESSION}" ; do sleep 2 ; done ;
    sleep 1 ; kill "${tp}" 2>/dev/null ; wait "${tp}" 2>/dev/null ;
    local ended_code ; ended_code="$(cut -d' ' -f1 "${logdir}/${SESSION}.exit" 2>/dev/null)" ;
    echo "" ; echo "--- '${SESSION}' ended (exit ${ended_code:-unknown}) ---" ;
    return 0 ;
  fi

  if [ "${LOG}" == 'yes' ] ; then
    [ -f "${logfile}" ] || { echo "No log for '${SESSION}'." ; return 1 ; } ;
    if [ "${TAIL_LINES:-0}" -gt 0 ] 2>/dev/null ; then tail -n "${TAIL_LINES}" "${logfile}" ; else cat "${logfile}" ; fi
    return 0 ;
  fi

  echo "Nothing to do: give --run, --shell, --attach, --log, --follow, --stop, --clean, --list or --check." ;
  return 1 ;
}
