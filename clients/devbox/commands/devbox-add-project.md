---
description: Add the current git repo to your claude-devbox as a new project for a profile, and apply it
allowed-tools: Bash(__PREFIX__ add:*), Bash(~/.local/bin/__PREFIX__ add:*), Bash(DEVBOX_DRYRUN=1 __PREFIX__ add:*), Bash(DEVBOX_DRYRUN=1 ~/.local/bin/__PREFIX__ add:*), Bash(command -v __PREFIX__:*), Bash(gh repo view:*), Bash(gh api user:*), Bash(cd:*), Bash(ansible-playbook:*)
---

Register **this** git repository as a project under a claude-devbox profile, then
apply it on the box. The `__PREFIX__ add` CLI does the safe mechanical part (detect
the repo, edit `group_vars/all.yml`); you drive the confirmation, the GitHub-access
check, and the playbook run.

Do this:

1. Resolve the CLI binary: use `__PREFIX__` if `command -v __PREFIX__` finds it, else
   `~/.local/bin/__PREFIX__`. Call it `$BIN`.
2. **Preview** (writes nothing) — run:
   `DEVBOX_DRYRUN=1 $BIN add $ARGUMENTS`
   - If it fails closed (not a git repo, no `origin` remote, unknown profile), relay
     the exact error and ask the user for the missing piece (`--profile <p>`,
     `--branch <b>`, or a `<name>` positional). Do not guess the profile. Re-run the
     preview with their input.
3. Show the user the resolved **project entry** (name / repo / branch), the **target
   profile**, the `all.yml` path, and the playbook command from the preview. **Wait
   for the user to confirm.**
4. On yes, apply the edit (still does not touch the box):
   `$BIN add --write $ARGUMENTS`
   - If it errors that `repoPath` is unset, tell the user to re-run
     `gen-editor-config.py --cli` from their claude-devbox checkout so the CLI knows
     where `all.yml` lives, then retry. If it errors that the project name already
     exists, stop and report — nothing to do.
5. **Check GitHub access before running the playbook.** Derive `owner/repo` from the
   repo url and run `gh repo view <owner/repo> --json viewerPermission`.
   - If it returns access, proceed.
   - If it 404s / denies, explain: the profile's box-side SSH key must be on the
     GitHub account that owns this repo. An **existing** profile reuses its key (it's
     almost certainly already added — the clone will just work). A brand-new profile
     would need its key added once. Surface this; **do not** add SSH keys yourself.
6. **Run the playbook** (this touches the box — confirm first). Use the exact command
   the preview printed:
   `cd <repoPath>/ansible && ansible-playbook -i inventory.ini playbook.yml --tags projects`
   - Relay the clone result. A first-clone failure is non-fatal (key not yet on
     GitHub) and the run is repeatable once access is in place.
7. Tell the user the project is ready: `__PREFIX__ <name>`.

Notes:
- `$ARGUMENTS` are passed through to `__PREFIX__ add` verbatim, so flags like
  `--profile work` or `--branch develop` or a `<name>` override all work.
- This command only ever adds a **project** to an existing profile (reusing that
  profile's SSH key). Adding a `servers:` entry (an always-on Remote Control server)
  or a brand-new profile is still done by hand in `group_vars/all.yml`.
