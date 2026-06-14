#!/usr/bin/env bash
# Run on your LAPTOP. Convenience wrapper around ssh into the box.
#   export DEVBOX_HOST=admin@mybox        # your operator_user @ box (Tailscale name)
#
# Usage:
#   connect.sh                          # shell on the box
#   connect.sh status                   # remote-control services + states
#   connect.sh login [users...]         # one-time /login per profile
#   connect.sh attach <user> <project>  # attach that profile's claude-rc session
#   connect.sh devup <user> <project> [cmd]   # start a project's dev server
#   connect.sh serve <port>             # tailscale-serve a dev port for preview
set -euo pipefail

HOST="${DEVBOX_HOST:-}"
[ -n "${HOST}" ] || { echo "Set DEVBOX_HOST, e.g.: export DEVBOX_HOST=admin@mybox" >&2; exit 1; }

cmd="${1:-ssh}"
shift || true

case "${cmd}" in
  ssh)    exec ssh -t "${HOST}" ;;
  status) exec ssh -t "${HOST}" "systemctl status 'claude-rc-*' --no-pager || true" ;;
  login)  exec ssh -t "${HOST}" "sudo claude-devbox-login $*" ;;
  attach) u="${1:?usage: connect.sh attach <user> <project>}"; p="${2:?project required}"
          exec ssh -t "${HOST}" "sudo -u ${u} tmux -L claude-rc-${u}-${p} attach -t claude-rc-${u}-${p}" ;;
  devup)  u="${1:?usage: connect.sh devup <user> <project> [cmd]}"; p="${2:?project required}"; shift 2 || true
          exec ssh -t "${HOST}" "sudo claude-devbox-dev ${u} ${p} $*" ;;
  serve)  port="${1:?usage: connect.sh serve <port>}"
          exec ssh -t "${HOST}" "tailscale serve ${port}" ;;
  *) echo "unknown command: ${cmd}  (ssh|status|login|attach|devup|serve)" >&2; exit 1 ;;
esac
