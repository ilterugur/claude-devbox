# Connecting to the box

The box is the host; your laptop and phone are clients. There are several ways to
reach it — they differ mainly in **UI** and in **what happens when the connection
drops**. Pick by situation.

## Coordinates

- **Address:** prefer the box's **Tailscale** name / `100.x` IP (private, stable).
  The public IP works too (SSH is open via UFW).
- **Which user?**
  - **A profile user** (e.g. `work`) — for *driving Claude / coding*.
    Its `$HOME`, its projects, its Claude login, its git identity.
  - **The operator** (`admin`) — for *maintenance only* (Ansible, `sudo`). Not a
    Claude account. Root SSH is disabled after hardening.

## The methods

### 1. Remote Control — phone / web (most resilient, zero setup)

An always-on `claude remote-control` server runs on the box per `(profile, project)`
(systemd + tmux). The agent runs **on the box**; the client is just a view.

- **Connect:** Claude mobile app (or `claude.ai/code`) → **Code** tab → switch to that
  **profile's Claude account** → tap the server → new/continue session.
- **Disconnect (network loss, lid close):** the agent **keeps running on the box**; reconnect
  resumes the same session. A long task continues with your phone off.
- Best for: phones, flaky connections, laptop closed. See [mobile.md](mobile.md).

### 2. mosh + tmux — terminal, roaming-resilient (best for flaky connections)

Drive the real `claude` TUI from a terminal that survives network drops.

```bash
mosh <user>@<box> -- tmux new -A -s main     # over Tailscale
#   inside:
claude
```

- **mosh** auto-reconnects across network/IP changes; **tmux** keeps the session (and
  `claude`) alive on the box, so a reconnect lands exactly where you left off.
- Installed by default (`mosh_enabled`); its UDP range is open **only on tailscale0**,
  so connect over Tailscale. Clients: Blink / Termius on the phone, `brew install mosh`
  on the laptop (or `scripts/connect.sh mosh <user>`).
- Best for: mobile, switching cells/Wi‑Fi, a real terminal.

### 3. Claude Desktop — integrated SSH remote project (desk only)

The desktop app opens the project on the box over its own SSH connection.

- **Not resilient:** on disconnect the remote Claude Code session **drops with no
  resume**, and it times out after ~10 min of network loss (open feature request:
  [anthropics/claude-code#49790](https://github.com/anthropics/claude-code/issues/49790)).
  It can't be wrapped in mosh/tmux — the app drives `claude`'s stdio directly.
- Best for: stable, at‑the‑desk work. For anything flaky, use #1 or #2.

### 4. VS Code / Cursor — Remote-SSH

`gen-editor-config.py` writes a `Host devbox-<user>` block to `~/.ssh/config`.

- **Connect:** Remote-SSH → Connect to Host → `devbox-<user>` → open
  `~/projects/<project>`. Editor + integrated terminal run on the box; auto
  port-forwarding for previews ([realtime-sync.md](realtime-sync.md)).
- Disconnects: the editor reconnects, but a `claude` in the integrated terminal is
  connection-tied — run it inside `tmux` if you need it to survive drops.

### 5. Plain SSH — terminal

```bash
ssh <user>@<box>            # profile user to code, admin to maintain
```

- Run `claude` directly and a dropped SSH **kills it** (SIGHUP). Wrap it in `tmux`
  (`tmux new -A -s main`) — or just use mosh+tmux (#2) — to survive disconnects.
- `scripts/connect.sh` wraps the common operator calls (`ssh`/`status`/`login`/
  `attach`/`mosh`/`devup`/`serve`); `export DEVBOX_HOST=admin@<box>` first.

## At a glance

| Method | UI | Survives a disconnect? | Best for |
| --- | --- | --- | --- |
| Remote Control | phone / web | ✅ agent runs on the box | phone, flaky net, laptop off |
| mosh + tmux | terminal (`claude` TUI) | ✅✅ auto-reconnect + persistent | mobile, flaky connections, terminal lovers |
| Claude Desktop integrated SSH | desktop app | ❌ session drops, no resume | stable desk work |
| VS Code / Cursor Remote-SSH | editor | ⚠️ editor reconnects; `claude` only if in tmux | editing on the box |
| Plain SSH | terminal | ❌ unless you use tmux | quick ops, scripted access |

> **Your conversation is never lost.** Claude Code persists each session to disk on
> the box (`~/.claude/projects/<slug>/*.jsonl`). After any drop, `claude --continue`
> (resume the latest) or `claude --resume` (pick one) brings the conversation back —
> only an in‑flight turn is lost.
