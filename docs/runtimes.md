# Runtimes (mise) & isolation

## Isolation model

Each **profile is its own Linux user** (`profiles[].user`): isolated `$HOME`,
processes, file permissions, SSH key, and git identity. This is real OS-level
isolation without Docker's overhead, and it's what makes "a different git account
per profile" trivial (each user just has its own `~/.ssh/id_ed25519` + `~/.gitconfig`).

Go further (Docker container per profile) only if you need hard **network/resource**
isolation or to run **untrusted** code — that's a heavier setup (per-container
Tailscale/ports, dev-service decisions, overhead) and is intentionally out of scope.

## Runtimes via mise

Declare the shared toolchain in `group_vars/all.yml`:

```yaml
runtimes:
  node: "lts"
  python: "3.12"
  bun: "latest"
  uv: "latest"
```

The `runtime` role installs **mise** (official apt repo) and writes these to the
system config `/etc/mise/config.toml`. The `users` role then runs `mise install`
**per profile** (into each user's own `~/.local/share/mise` — consistent with the
per-user isolation, and avoids the unsupported shared-data-dir setup).

### mise owns the env — we add almost nothing

- **Interactive/login shells:** `/etc/profile.d/mise.sh` runs `eval "$(mise
  activate bash)"`. mise manages PATH/versions.
- **The agent's Bash tool** runs in a **non-interactive, non-login shell**, which
  reads *no* rc files — so `mise activate` (a shell hook) can't reach it and
  `/etc/profile.d` doesn't apply. The one piece of glue: the Remote Control loop
  (`claude-rc-run`) runs `eval "$(mise activate bash --shims)"` before launching
  Claude, so the claude process — and every Bash-tool subshell it spawns — inherits
  the toolchain. mise still computes the env; we just trigger it in the right place.
- We do **not** hand-edit `/etc/environment` or maintain a PATH list.

`bun` and `uv` are first-class mise tools (`mise use -g bun@latest`, `uv@latest`),
so the whole toolchain is one declarative list.

### Per-project versions

A repo's own `mise.toml` is honored in interactive shells (where `mise activate`
runs). The agent's non-interactive shell uses the shims (the globally-installed
versions); per-project switching there isn't expected — an inherent limitation of
non-interactive shells, not specific to this setup.

## References

- [mise — installing](https://mise.jdx.dev/installing-mise.html) ·
  [shims (non-interactive)](https://mise.jdx.dev/dev-tools/shims.html) ·
  [configuration](https://mise.jdx.dev/configuration.html) ·
  [CI / non-interactive](https://mise.jdx.dev/continuous-integration.html)
- Why non-login shells skip rc files: [Baeldung](https://www.baeldung.com/linux/shell-etc-profile-not-invoked-non-login)
