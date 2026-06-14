#!/usr/bin/env bash
# Managed by claude-devbox. Runs INSIDE tmux as the profile user. Keeps
# `claude remote-control` alive and self-heals once the profile is logged in.

# Remote Control needs claude.ai OAuth — these make it refuse, so unset them.
unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN CLAUDE_CODE_OAUTH_TOKEN \
  CLAUDE_CODE_USE_BEDROCK CLAUDE_CODE_USE_VERTEX CLAUDE_CODE_USE_FOUNDRY \
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC DISABLE_TELEMETRY 2>/dev/null || true

# claude is in ~/.local/bin; the toolchain (node/python/bun/uv) comes from mise.
# We let mise compute the env (shims mode works in non-interactive shells).
export PATH="${HOME}/.local/bin:${PATH}"
command -v mise >/dev/null 2>&1 && eval "$(mise activate bash --shims)" || true
command -v node >/dev/null 2>&1 || \
  echo "[claude-rc] WARNING: toolchain (node) not on PATH — check 'mise ls' for $(whoami)" >&2

CFG="${CLAUDE_CONFIG_DIR:?CLAUDE_CONFIG_DIR not set}"
DIR="${CLAUDE_RC_PROJECT_DIR:?CLAUDE_RC_PROJECT_DIR not set}"
NAME="${CLAUDE_RC_NAME:-claude}"
SPAWN="${CLAUDE_RC_SPAWN:-worktree}"
CAPACITY="${CLAUDE_RC_CAPACITY:-4}"

while true; do
  if [ -f "${CFG}/.credentials.json" ] || [ -f "${CFG}/credentials.json" ]; then
    if cd "${DIR}" 2>/dev/null; then
      claude remote-control --name "${NAME}" --spawn "${SPAWN}" --capacity "${CAPACITY}" || true
      echo "[claude-rc] remote-control exited; restarting in 5s..." >&2
      sleep 5
    else
      echo "[claude-rc] project dir ${DIR} missing (clone failed? add the profile's SSH key to GitHub and re-run the playbook); retrying in 15s..." >&2
      sleep 15
    fi
  else
    echo "[claude-rc] ${CFG} not logged in — run: sudo claude-devbox-login; polling in 15s..." >&2
    sleep 15
  fi
done
