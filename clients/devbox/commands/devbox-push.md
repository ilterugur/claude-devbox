---
description: Push the current Claude Code session to your claude-devbox and resume it there
allowed-tools: Bash(__PREFIX__ push:*), Bash(~/.local/bin/__PREFIX__ push:*), Bash(command -v __PREFIX__:*), Bash(DEVBOX_DRYRUN=1 __PREFIX__ push:*), Bash(DEVBOX_DRYRUN=1 ~/.local/bin/__PREFIX__ push:*)
---

Push **this** Claude Code session to the remote dev box so it can be resumed there,
rewriting the laptop-local paths embedded in the transcript to the box's paths.

Do this:

1. Resolve the CLI binary: use `__PREFIX__` if `command -v __PREFIX__` finds it, else
   `~/.local/bin/__PREFIX__`. Call it `$BIN`.
2. **Preview** (writes nothing) — run:
   `DEVBOX_DRYRUN=1 $BIN push --session "$CLAUDE_CODE_SESSION_ID" $ARGUMENTS`
   - If it fails closed (origin not in config, or matches multiple profiles, or a
     worktree source), relay the exact error and ask the user for the missing flag
     (`--profile <p> <project>`, and `--remote-cwd <dir>` for a worktree). Then
     re-run the preview with their flags. Do not guess the profile.
3. Show the user the resolved **target** (host + remote path) and the **remap**
   lines from the preview, and the fork caveat: continuing on the box forks the
   conversation — this laptop session keeps growing separately.
4. **Wait for the user to confirm.** Only after they say yes, run the real push:
   `$BIN push --session "$CLAUDE_CODE_SESSION_ID" --yes $ARGUMENTS`
5. Relay the printed resume command verbatim (`devbox <project> --shell` then
   `claude --resume <id>`).

Notes:
- This pushes the **current** conversation (`$CLAUDE_CODE_SESSION_ID`) as a snapshot,
  including its subagent/workflow sidecar.
- It overwrites any existing copy on the box (a timestamped backup is made first);
  it refuses if a session is live on the box unless you pass `--force`.
- `--go` and `--pick` need an interactive terminal — don't use them here; tell the
  user to run `devbox push --go` / `devbox push --pick` directly in their terminal.
