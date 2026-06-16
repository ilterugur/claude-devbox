#!/usr/bin/env bash
# Run on your CLIENT. Curate the PORTABLE subset of your local ~/.claude into
# claude-config/shared/ for syncing to the box. Excludes credentials and
# machine/session state, and flags non-portable content (macOS paths, localhost
# endpoints, secrets) you must fix before deploying.
#
#   CLAUDE_SRC=~/.claude ./scripts/bundle-local-config.sh
set -euo pipefail

SRC="${CLAUDE_SRC:-$HOME/.claude}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${REPO}/claude-config/shared"

[ -d "${SRC}" ] || { echo "No ~/.claude at ${SRC}. Set CLAUDE_SRC." >&2; exit 1; }
mkdir -p "${DEST}"

# Portable customizations only (NOT credentials, NOT ~/.claude.json, NOT state).
# If your CLAUDE.md @-includes extra memory files (e.g. a personal MY-NOTES.md),
# add their filenames to this list too.
include=(CLAUDE.md mcp.json statusline-command.sh \
         skills agents commands output-styles rules workflows hooks \
         themes keybindings.json settings.json)

echo "Bundling portable config: ${SRC} -> ${DEST}"
for item in "${include[@]}"; do
  [ -e "${SRC}/${item}" ] || continue
  rsync -a --exclude='*.sha256' "${SRC}/${item}" "${DEST}/"
  echo "  + ${item}"
done

# Belt-and-suspenders: never let identity/secrets into the bundle. (Note: the
# real identity file ~/.claude.json lives OUTSIDE ~/.claude, so it's never in the
# include list to begin with — this is just extra insurance.)
rm -f "${DEST}/.credentials.json" "${DEST}/.claude.json" 2>/dev/null || true

echo
echo "== Portability check (fix these before deploying) =="
if grep -rIl -e '/Users/' -e '/opt/homebrew' -e '/home/[^/]*/\.claude' \
     -e 'ANTHROPIC_BASE_URL' -e '127\.0\.0\.1' -e 'localhost' "${DEST}" 2>/dev/null; then
  echo "  ^ these reference macOS/local paths, localhost endpoints, or absolute"
  echo "    home paths — they break on the Linux box. Rewrite them in ${DEST}."
else
  echo "  none found."
fi

cat <<'EOF'

NOTE: settings.json + hooks often reference local tools/absolute paths (custom
CLIs your hooks call, uv/uvx, /opt/homebrew/... etc.). They are NOT deployed by
default (claude_sync_settings: false) and those tools won't exist on the box. Read
docs/config-sync.md before opting in. MCP servers added via `claude mcp add -s
user` live in ~/.claude.json (NOT bundled) — re-add them into
claude-config/shared/mcp.json if you want them on the box.

Next: cd ansible && ansible-playbook playbook.yml
EOF
