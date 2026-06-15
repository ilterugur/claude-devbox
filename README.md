# claude-devbox

Provision a cheap remote server into an **always-on, multi-profile Claude Code dev
box** with one Ansible run from your laptop. Built for Bun / Turborepo / Vite /
Docker monorepos.

Each **profile** is its own **Linux user** — isolated `$HOME`, its own SSH key and
git identity, its own Claude login, its own always-on Remote Control servers. You
drive it from the **Claude desktop app** (or VS Code Remote-SSH) at your laptop and
from the **Claude mobile app** when you're out — laptop closed.

You edit one vars file, run `ansible-playbook`, add each profile's printed SSH key
to its GitHub account, and do a single `/login` per profile. After that the box
runs itself.

---

## What you get

- A hardened Ubuntu/Debian box: key-only SSH, UFW, Fail2Ban, Tailscale, swap.
- **mise** managing a shared toolchain — Node, Python, bun, uv — available even to
  Claude's non-interactive Bash tool (no hand-maintained PATH).
- **Per-profile Linux users**: real filesystem/process isolation, a **separate git
  account per profile** (own SSH key + identity), separate Claude logins.
- Docker for your dev services; your repos cloned + `bun install`ed per profile.
- One **always-on Remote Control server per (profile, project)** — reachable from
  your phone, no inbound ports.
- Your portable Claude config (skills, subagents, commands, `CLAUDE.md`, MCP defs)
  synced into **every profile**, identity kept separate.

## Architecture

```
  Laptop (desktop app / VS Code Remote-SSH, as a profile user) ─┐
                                                                ├─► Box ─► Anthropic API
  Phone (Claude mobile app, Remote Control, per profile)       ─┘   profiles = isolated
                                                                     Linux users; Docker
                                                                     services; mise toolchain
```

The **box is the host**; laptop and phone are clients (phone works with the laptop
off). Billing is tied to each Claude **account**, not the machine.

## Cost

| Item | Monthly |
| --- | --- |
| A small VPS (e.g. Hetzner **CX33** — 4 vCPU / 8 GB / 80 GB NVMe) | ~€6.49 |
| Tailscale (personal) | €0 |
| Claude subscription (Pro or Max — whatever you have) | $20–$200 |

➡️ The only **new** cost is the ~€6.49 box; running Claude Code on it adds nothing
(billing is tied to your account, not the machine). Resize to **CX43** (16 GB) in
~1 min if profiles/builds need more RAM.

> Multiple profiles = multiple Claude accounts: read
> **[docs/multi-account.md](docs/multi-account.md)** first — it's for separately
> owned, legitimately paid subscriptions only, not for dodging rate limits.

---

## Let Claude set it up (skill)

This repo bundles a Claude Code **skill** that drives the whole local side for you —
it interviews you, generates `inventory.ini` + `group_vars/all.yml`, runs the
preflight + playbook (with your confirmation), and walks you through the manual steps
(GitHub SSH keys, `sudo claude-devbox-login`).

- **In this repo:** open it with Claude Code — the skill at
  `.claude/skills/claude-devbox-setup/` is auto-discovered. Say *"set up my dev box"*.
- **From anywhere:** install it globally —
  `cp -r .claude/skills/claude-devbox-setup ~/.claude/skills/` — then ask Claude to
  *"set up claude-devbox"* and it'll locate (or clone) the repo.

Or do it by hand with the Quickstart below.

## Prerequisites (on your laptop)

- `ansible` (`brew install ansible` / `pipx install ansible`)
- An SSH keypair (`ssh-keygen -t ed25519`)
- A small VPS running Ubuntu 24.04 / Debian 12 with your SSH key added at creation
  (any provider; Hetzner CX33 at ~€6.49 is the cheap pick)
- A [Tailscale](https://tailscale.com) account + a reusable auth key

## Quickstart

```bash
cd ansible
ansible-galaxy collection install -r requirements.yml

cp inventory.example.ini inventory.ini             # ansible_host (+ ansible_user=root for first run)
cp group_vars/all.example.yml group_vars/all.yml   # operator, ssh key, tailscale key, runtimes, profiles

../scripts/bundle-local-config.sh                  # optional: stage your portable ~/.claude config

ansible-playbook playbook.yml                      # ~15–25 min, idempotent
```

The playbook **prints an SSH public key per profile** — add each to that profile's
GitHub account (so its private repos clone; re-run the playbook to clone any that
failed the first pass). Then the one manual Claude step:

```bash
ssh admin@<box>            # your operator_user + box IP/Tailscale name
sudo claude-devbox-login   # one /login per profile (Remote Control needs OAuth)
```

Done. Servers come online within ~15s. Open the Claude mobile app → Code tab →
switch to that profile's account → your server → new session.

> **Re-runs:** after the first run, root SSH is disabled — change `ansible_user`
> in `inventory.ini` to your `operator_user`.

## What's automated vs. manual

| Automated (Ansible) | Manual (one-time) |
| --- | --- |
| Hardening, Tailscale, Docker, **mise + toolchain** | Add each profile's SSH key to its GitHub account |
| Per-profile users, **SSH keys + git identity** | One `/login` per profile (`sudo claude-devbox-login`) |
| Clone repos, `bun install`, `.env` scaffold | Fill in real `.env` secrets |
| Per-profile always-on Remote Control + config sync | (that's it) |

## Daily use

- **Laptop — Claude desktop app / VS Code Remote-SSH:** connect **as a profile
  user** (`ssh work@box`) → that profile's Claude, projects, and git identity.
  Auto port-forwarding for previews. See [docs/realtime-sync.md](docs/realtime-sync.md).
- **Phone — Claude mobile app:** Code tab → switch to the profile's account → its
  server → new session, runs on the box. See [docs/mobile.md](docs/mobile.md).
- **Flaky connection (mobile, switching networks) — mosh + tmux:** `mosh <user>@<box> -- tmux
  new -A -s main` then run `claude` inside. Survives network drops / IP changes and
  resumes on reconnect — the resilient alternative to Claude Desktop's integrated
  SSH (which drops the session on disconnect). On by default (`mosh_enabled`); see
  [docs/mobile.md](docs/mobile.md).
- **Dev servers / preview:** `sudo claude-devbox-dev <user> <project>` on the box,
  then Tailscale Serve or VS Code forward.
- **`scripts/connect.sh`** runs locally and wraps the common ssh/attach/mosh/login/serve
  calls — `export DEVBOX_HOST=admin@<box>` first.

## Isolation & runtimes

- **Isolation:** each profile is a separate Linux user — own home, processes, files,
  SSH key, and git identity. Strong isolation without Docker's overhead. (Want hard
  network/resource isolation or to run untrusted code? That's where containers earn
  their keep — out of scope here.)
- **Runtimes:** declared in `group_vars` `runtimes:` and installed by **mise**. mise
  owns the shell env (`mise activate`); the only glue is `mise activate --shims` in
  the Remote Control wrapper so the agent's non-interactive Bash tool sees the tools.
  See [docs/runtimes.md](docs/runtimes.md).

## Repo layout

```
ansible/
  inventory.example.ini   group_vars/all.example.yml   playbook.yml
  requirements.yml        ansible.cfg
  roles/
    base  security  tailscale  mosh  docker  runtime(mise)  users  projects
    claude_remote  claude_config  browser
claude-config/   README.md  settings.shared.example.json  shared/ (gitignored)
scripts/
  claude-devbox-login.sh  claude-config-apply.sh  claude-devbox-dev.sh
  claude-rc-wrapper.sh  claude-rc-run.sh   (box)
  bundle-local-config.sh  connect.sh        (laptop)
docs/
  multi-account.md  multi-project.md  config-sync.md  runtimes.md
  mobile.md  realtime-sync.md
```

## Docs

- [Connecting to the box (Remote Control · mosh+tmux · Desktop SSH · Remote-SSH)](docs/connecting.md)
- [Multiple accounts / profiles (+ Anthropic ToS)](docs/multi-account.md)
- [Multiple projects + per-profile git](docs/multi-project.md)
- [Runtimes (mise) & isolation](docs/runtimes.md)
- [Syncing your Claude config (MCPs/skills/hooks)](docs/config-sync.md)
- [Driving the box from your phone](docs/mobile.md)
- [Real-time sync & preview on your laptop](docs/realtime-sync.md)

## Security notes

- Key-only SSH (admin + profile users), root login disabled, UFW default-deny,
  Fail2Ban — all by default. Prefer reaching the box over Tailscale.
- Each profile's git key is its own; Remote Control is outbound-HTTPS only.
- `inventory.ini` and `group_vars/all.yml` hold secrets and are **gitignored**.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Profile clone failed | Add that profile's printed SSH key to its GitHub account, re-run. |
| Server not on phone | `systemctl status 'claude-rc-*'`; did you run `sudo claude-devbox-login`? Switch to that account in the app. |
| `not logged in` in logs | Run `sudo claude-devbox-login`. |
| `node`/`python` missing for the agent | `mise activate --shims` runs in the wrapper; check the service env and `mise ls` for that user. |
| Re-run fails as root | Set `ansible_user` to your operator in `inventory.ini` (root login is off). |
| Attach a service's tmux | `sudo -u <user> tmux -L claude-rc-<user>-<project> attach`. |
| A server died / unresponsive | `sudo systemctl restart claude-rc-<user>-<project>` (recreates its tmux). |

## License

MIT — see [LICENSE](LICENSE).
