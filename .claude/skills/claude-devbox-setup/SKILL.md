---
name: claude-devbox-setup
description: >-
  Set up and drive the claude-devbox toolkit from the user's laptop — provision a
  remote, multi-profile, always-on Claude Code dev box (Ansible + mise + per-profile
  Linux users). Use this WHENEVER the user wants to set up, provision, configure,
  bootstrap, or deploy claude-devbox or "a remote Claude Code dev box / dev server";
  fill in or generate its Ansible inventory or group_vars; add a profile, account,
  project, or runtime to the box; run its playbook; or do the post-install steps
  (adding per-profile SSH keys to GitHub, `sudo claude-devbox-login`). Trigger even
  when they don't name the tool — e.g. "set up my remote dev box", "configure the
  claude server", "add a work profile to the box", or when they paste box IP / SSH /
  Tailscale details expecting provisioning.
---

# claude-devbox setup

Drive the local side of **claude-devbox**: gather inputs → generate the config →
run the playbook → guide the few manual steps. The repo already documents the
architecture; this skill is the interactive wizard that wires it up for the user.

Be a careful operator. Provisioning **hardens SSH and installs software on a real
remote box** — confirm before the run, never commit or echo secrets, and never
touch a GitHub account that isn't the user's.

## Step 0 — Locate the repo

`claude-devbox` is an Ansible repo. Find its checkout (call it `$REPO`):

- If the current directory (or an obvious sibling) contains `ansible/playbook.yml`
  and `ansible/roles/claude_remote/`, that's `$REPO`.
- Otherwise ask the user for the path, or offer to `git clone` it (ask for the URL).

Read `$REPO/README.md` and skim `$REPO/docs/` so your guidance matches the repo's
current behavior rather than your memory — the toolkit evolves.

## Step 1 — Prerequisites (on the laptop)

- `ansible --version` — if missing: `brew install ansible` or `pipx install ansible`.
- `cd $REPO/ansible && ansible-galaxy collection install -r requirements.yml`.
- An SSH keypair for logging into the box (the operator key). If absent, offer
  `ssh-keygen -t ed25519`.
- A **Tailscale auth key** — the user creates a *reusable, non-ephemeral* key at
  https://login.tailscale.com/admin/settings/keys . Ask them to paste it; treat it
  as a secret (see Secrets below).
- A VPS already created (Ubuntu 24.04 / Debian 12) with the operator key added, and
  its IP/hostname. If they haven't got one, point them at the README's cheap pick.

## Step 2 — Interview

Collect the values that drive `group_vars/all.yml`. Prefer a few grouped questions
over a long form. Gather:

- **Box**: `ansible_host` (IP/Tailscale name).
- **Operator** (admin user Ansible connects as): `operator_user` (default `admin`),
  `operator_ssh_pubkey` (read `~/.ssh/id_ed25519.pub` or ask), and
  `operator_private_key_path` (the matching private key, for the pre-hardening probe).
- **Networking**: `tailscale_authkey`.
- **Runtimes** (installed once via mise, shared): sensible defaults
  `node: lts, python: "3.12", bun: latest, uv: latest` — confirm or adjust.
- **Profiles** — each is its own Linux user = one Claude account = one git identity.
  For each: `user`, `git_name`, `git_email`, `projects` (each `name` / `repo` /
  `branch` / optional `ports`), and `servers` (each `project` / `name` / `spawn` /
  `capacity`). For the profile `user`, don't default to a generic name like `work` —
  **propose a username derived from the project's git identity** (e.g. the current
  repo's `git config user.name`, lowercased/sanitized to `[a-z0-9-]`) so it's
  meaningful; let the user confirm or override. Pull `git_name`/`git_email` and the
  project's `repo` (convert an `https://github.com/...` remote to its `git@github.com:...`
  SSH form for private clones) / `branch` straight from the target repo's `git config`
  and `git remote` when it's available, rather than asking the user to type them.
  Note the **operator** user is separate infrastructure (sudo/Ansible only, root SSH
  is disabled after hardening so it can't be skipped) and **cannot** be the same Linux
  user as a profile — if the user balks at "admin", explain that, don't merge them.

If they want **more than one profile**, surface the multi-account rule up front:
it's only for separately-owned, legitimately-paid subscriptions, never to dodge one
account's rate limits. Point to `docs/multi-account.md` and let them confirm.

Don't invent repos or emails — ask. Mirror the exact field names/shape in
`group_vars/all.example.yml` (read it first; it's the source of truth for the schema).

## Step 3 — Generate the config

- **`ansible/inventory.ini`** from `inventory.example.ini`: set `ansible_host`, and
  `ansible_user=root` for the **first** run (root is disabled after hardening — leave
  a clear comment to switch it to `operator_user` for later runs).
- **`ansible/group_vars/all.yml`** from the interview, matching the example's
  structure. If `all.yml` already exists, show a diff / back it up and confirm before
  overwriting — it may hold the user's real secrets.
- Sanity-check it parses: `cd $REPO/ansible && ansible-playbook --syntax-check -i inventory.ini playbook.yml`.

## Step 4 — Optional: stage the user's Claude config

Offer to mirror their portable `~/.claude` (skills, subagents, commands, CLAUDE.md,
MCP defs) into every profile via `scripts/bundle-local-config.sh`. **First** read
`docs/config-sync.md` to them in brief — settings.json/hooks and local-tool-dependent
MCPs need box-side work and are off by default. Don't force it.

## Step 5 — Run the playbook (CONFIRM FIRST)

This step has real, hard-to-reverse side effects: it creates users, **disables root
SSH**, installs Docker/mise/Claude Code, and starts services on the named box. Before
running, summarize *exactly* what it will do and to *which* host, and get an explicit
go-ahead.

```bash
cd $REPO/ansible && ansible-playbook playbook.yml
```

Stream the output. **Capture the per-profile SSH public keys it prints** (the "Public
keys to add to each profile's GitHub account" task) — you'll hand these to the user
next. Note any clone that failed (that's expected if a key isn't on GitHub yet).

## Step 6 — Guide the manual steps

These can't be fully automated; walk the user through them:

1. **Add each profile's SSH public key to *that profile's* GitHub account** (the keys
   from Step 5). If `gh` is installed and the user confirms, you may offer to add a
   key via `gh` — but adding an SSH key changes GitHub account settings, so confirm
   each one, make sure the correct account is active, and **never** do this for an
   account that isn't the user's. Otherwise give the exact manual steps
   (Settings → SSH and GPG keys → New SSH key). Then **re-run the playbook** to clone
   any repos that failed the first pass.
2. **Switch `inventory.ini`** `ansible_user` to the `operator_user` for all future
   runs (root login is now disabled).
3. **One `/login` per profile** — Remote Control needs interactive OAuth:
   ```bash
   ssh <operator_user>@<box>
   sudo claude-devbox-login
   ```
   Follow the prompts (`/login` → Claude account → paste code → `/exit`). Servers come
   online within ~15s; no restart needed.

## Step 7 — Verify & hand off

- Check services: `ssh <operator>@<box> "systemctl status 'claude-rc-*' --no-pager"`
  (or `scripts/connect.sh status` with `DEVBOX_HOST` set).
- **Register the box in the user's editors:** run
  `python3 scripts/gen-editor-config.py` — it writes a `~/.ssh/config` block per
  profile (VS Code / Cursor Remote-SSH, plain ssh, Zed) and Zed `ssh_connections`
  pre-listing each profile's projects. (It backs up and only edits its own managed
  block; if Zed's settings has comments it prints the snippet to paste instead.)
- Point the user to daily use: connect the **desktop app / VS Code Remote-SSH /
  Zed as a profile** (e.g. `devbox-work`), drive from the **mobile app** per
  profile, and preview dev servers (`docs/realtime-sync.md`, `docs/mobile.md`).

## Adding a profile / project / runtime later

Edit `group_vars/all.yml`, re-run the playbook (idempotent). A new profile prints a
new SSH key (add it to GitHub) and needs its own `/login`; a new `servers` entry
brings up its `claude-rc-*` service.

## Secrets & safety (non-negotiable)

- `inventory.ini` and `group_vars/all.yml` hold the Tailscale key and other secrets
  and are **gitignored** — keep them so. Never commit them, never paste their
  contents into a chat/PR/external service, never `echo` the Tailscale key.
- Confirm with the user before the playbook run (side effects) and before any change
  to a GitHub account.
- **Pruning is destructive and opt-in.** If the user removed a profile/server and
  wants cleanup, run `--tags prune` and show them the exact list it reports; only
  pass `-e prune_assume_yes=true` (and the user/home flags) AFTER they confirm in
  chat. Never wipe a home directory without explicit, specific approval.
- If anything in the repo contradicts this skill, trust the repo (`README.md`,
  `docs/`, `group_vars/all.example.yml`) — it's the live source of truth.
