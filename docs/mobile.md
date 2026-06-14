# Driving the box from your phone

Goal: laptop closed, you start and steer Claude Code tasks **on the box** from your
phone — including brand-new sessions.

## Why this works with the laptop off

The box is the host; your laptop and phone are only clients. Each profile's
`servers` entry runs an always-on `claude remote-control` server (in tmux, kept
alive by systemd, as that profile's user). Remote Control is **outbound HTTPS
only** — no inbound ports — so it reaches your phone through the firewall and
Tailscale untouched.

## One-time setup

1. Provision (`ansible-playbook playbook.yml`).
2. Log in each profile once (see [multi-account.md](multi-account.md)):
   ```bash
   ssh admin@<box>
   sudo claude-devbox-login
   ```

That's it — the servers come online within ~15s of login.

## Daily use from the phone

1. Open the **Claude mobile app** (or `claude.ai/code` in mobile Safari/Chrome).
2. Go to the **Code** tab. Your servers appear by their `name:` with a green dot.
   - Multiple accounts? **Switch account** in the app to see each one's servers.
3. Tap a server → **new session** → it spawns a fresh session **on the box**.
   With `spawn: worktree`, each session gets its own git worktree, so parallel
   tasks never clobber each other's files (up to `capacity`).
4. Type your task. It runs on the box, against your Docker services and real
   project files; output streams back to your phone.

## What does / doesn't work

| You want | Works? | How |
| --- | --- | --- |
| Start a new session from phone, runs on the box | ✅ | A `claude-rc-*` server must be running (it is, always-on) |
| Laptop fully off | ✅ | Box is the host; nothing depends on the laptop |
| Steer/continue a running session | ✅ | Same server, same phone UI |
| Spawn the box from zero with no server running | ❌ | At least one `claude-rc-*` server must be alive — that's what the always-on service guarantees |
| `claude.ai/code` web "new session" running on the box | ❌ | The web's own new-session runs on **Anthropic cloud**, not your box. Always connect to **your** server. |
| Dispatch (start tasks from phone) | ❌ here | Dispatch needs the **desktop app** running on a Mac/Windows — useless with the laptop off |

## Caveats

- Remote Control is a **research preview** (Pro/Max; Team/Enterprise need an admin
  to enable it org-wide).
- A session times out after ~10 min of network loss; the box-side server keeps
  running and you reconnect.
- Approving tool calls from a phone is easy — don't rubber-stamp risky ones.

## References

- [Remote Control](https://code.claude.com/docs/en/remote-control)
- [Claude Code on the web (runs on Anthropic cloud)](https://code.claude.com/docs/en/claude-code-on-the-web)
