#!/usr/bin/env python3
"""Register the dev box in your editors, one entry per profile.

Run on your LAPTOP from the repo (or pass --repo). Reads ansible/inventory.ini +
ansible/group_vars/all.yml and writes:

  * ~/.ssh/config            — a managed `Host devbox-<user>` block per profile.
                               Covers VS Code / Cursor Remote-SSH, plain ssh, and
                               Zed (Zed shells out to ssh, inheriting the alias).
  * ~/.config/zed/settings.json — `ssh_connections` referencing those aliases,
                               pre-listing each profile's ~/projects/<name>.
  * your shell rc (~/.zshrc / ~/.bashrc) — a `devbox-<user>` function per profile
                               that connects over mosh (falls back to ssh) into a
                               persistent tmux session, so a dropped connection
                               never loses work. mosh needs this client on the
                               box's Tailscale net (mosh UDP is tailscale-only).

Idempotent: rewrites only its own managed block / its own connection entries, and
backs up each file first. Zed is skipped unless Zed is installed or --zed is given.

  python3 scripts/gen-editor-config.py [--repo PATH] [--prefix devbox] [--host H]
       [--default PROFILE] [--launch CMD] [--locale L] [--no-zed|--zed]
       [--no-shell|--shell-rc PATH]

The generated `<prefix>` command supports: `<prefix>` (default profile), `<prefix>
<profile> [session]`, `<prefix> ls [profile]` (list open tmux sessions), and — when
--launch is set — `<prefix> -s [profile]` (plain shell, skip the auto-launched command).
"""
import argparse
import json
import os
import re
import shutil
import sys

BEGIN = "# >>> claude-devbox (managed) >>>"
END = "# <<< claude-devbox <<<"


def die(msg):
    sys.exit(f"error: {msg}")


def find_repo(arg):
    if arg:
        return os.path.abspath(os.path.expanduser(arg))
    here = os.path.dirname(os.path.abspath(__file__))
    cand = os.path.dirname(here)  # repo root (scripts/..)
    if os.path.exists(os.path.join(cand, "ansible", "playbook.yml")):
        return cand
    die("couldn't locate the claude-devbox repo; pass --repo PATH")


def box_host(repo, override):
    if override:
        return override
    inv = os.path.join(repo, "ansible", "inventory.ini")
    if os.path.exists(inv):
        m = re.search(r"ansible_host\s*=\s*(\S+)", open(inv).read())
        if m:
            return m.group(1)
    die("no ansible_host in inventory.ini; pass --host")


def load_vars(repo):
    try:
        import yaml
    except ImportError:
        die("PyYAML needed: `pip install pyyaml` (or run from the ansible venv)")
    path = os.path.join(repo, "ansible", "group_vars", "all.yml")
    if not os.path.exists(path):
        die("ansible/group_vars/all.yml not found — set up the box first")
    return yaml.safe_load(open(path)) or {}


def ssh_block(profiles, host, key, prefix):
    out = [BEGIN]
    for p in profiles:
        out += [
            f"Host {prefix}-{p['user']}",
            f"    HostName {host}",
            f"    User {p['user']}",
            f"    IdentityFile {key}",
            "    Port 22",
            "    IdentitiesOnly yes",
            "",
        ]
    out.append(END)
    return "\n".join(out) + "\n"


def write_ssh_config(block):
    path = os.path.expanduser("~/.ssh/config")
    os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
    existing = open(path).read() if os.path.exists(path) else ""
    if existing:
        shutil.copy2(path, path + ".bak")
    # Strip a previous managed block, then append the new one.
    stripped = re.sub(re.escape(BEGIN) + r".*?" + re.escape(END) + r"\n?", "", existing, flags=re.S)
    new = (stripped.rstrip() + "\n\n" if stripped.strip() else "") + block
    with open(path, "w") as f:
        f.write(new)
    os.chmod(path, 0o600)
    print(f"  ✓ ~/.ssh/config updated (backup: ~/.ssh/config.bak)")


def zed_entries(profiles, prefix):
    entries = []
    for p in profiles:
        projects = [{"paths": [f"~/projects/{pr['name']}"]} for pr in (p.get("projects") or [])]
        entries.append({"host": f"{prefix}-{p['user']}", "nickname": f"claude-devbox · {p['user']}", "projects": projects})
    return entries


def write_zed(entries, prefix, forced):
    cfg_dir = os.path.expanduser("~/.config/zed")
    path = os.path.join(cfg_dir, "settings.json")
    if not forced and not os.path.isdir(cfg_dir):
        print("  – Zed not detected (no ~/.config/zed); skipping. Use --zed to force.")
        return
    snippet = json.dumps({"ssh_connections": entries}, indent=2, ensure_ascii=False)
    if os.path.exists(path):
        try:
            data = json.load(open(path))
        except (json.JSONDecodeError, ValueError):
            print("  ! ~/.config/zed/settings.json has comments/JSON5 — not editing it.")
            print("    Paste this `ssh_connections` block in yourself:\n")
            print(snippet)
            return
        shutil.copy2(path, path + ".bak")
    else:
        os.makedirs(cfg_dir, exist_ok=True)
        data = {}
    others = [c for c in data.get("ssh_connections", []) if not str(c.get("host", "")).startswith(prefix + "-")]
    data["ssh_connections"] = others + entries
    with open(path, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"  ✓ ~/.config/zed/settings.json updated (backup alongside if it existed)")


def shell_block(profiles, prefix, default, locale, launch):
    users = " ".join(p["user"] for p in profiles)
    # Pin LANG/LC_ALL/LC_CTYPE: mosh hands the client's locale to mosh-server, and a
    # macOS region locale (e.g. en_TR.UTF-8, or a bare LC_CTYPE=UTF-8) that Linux can't
    # provide makes mosh-server fail to start or bash warn. LC_CTYPE must be pinned too.
    loc = f"LANG={locale} LC_ALL={locale} LC_CTYPE={locale}"
    bad = f'printf "{prefix}: unknown profile \'%s\' (have: {users})\\n" "$prof" >&2; return 1'
    chk = f'case " {users} " in *" $prof "*) ;; *) {bad} ;; esac'
    out = [
        BEGIN,
        f"# `{prefix} [profile] [session]` — connect to a profile over mosh (falls back to ssh)",
        "# into a persistent tmux session, so a dropped connection never loses work.",
        f"#   {prefix}                  default profile '{default}', session 'main'",
        f"#   {prefix} <profile> [sess] a specific profile / named tmux session",
        f"#   {prefix} ls [profile]     list that profile's open (attachable) tmux sessions",
    ]
    if launch:
        out += [
            f"#   {prefix} -s [profile]    open a plain shell (skip the auto-`{launch}`)",
            f"# A fresh session auto-runs `{launch}` (re-attach resumes it); `exec $SHELL` keeps",
            "# the session alive after it exits. mosh needs this client on the box's Tailscale",
            "# net (mosh UDP is tailscale-only); `brew install mosh` / Blink / Termius provide it.",
        ]
    else:
        out += [
            "# mosh needs this client on the box's Tailscale net (mosh UDP is tailscale-only);",
            "# `brew install mosh` / Blink / Termius provide the client. Run `claude` once attached.",
        ]
    out += [
        f"{prefix}() {{",
        f'  local prof sess h nolaunch=',
        f'  if [ "$1" = ls ] || [ "$1" = -l ] || [ "$1" = --list ]; then',
        f'    prof="${{2:-{default}}}"; {chk}',
        f'''    {loc} ssh "{prefix}-$prof" "tmux ls 2>/dev/null || echo '(no open sessions)'"; return''',
        f'  fi',
    ]
    if launch:
        out += [f'  case "$1" in -s|--shell) nolaunch=1; shift ;; esac']
    out += [
        f'  prof="${{1:-{default}}}" sess="${{2:-main}}"; {chk}',
        f'  h="{prefix}-$prof"',
    ]
    if launch:
        # Run <launch> via a LOGIN shell (bash -lc) so ~/.local/bin + mise are on PATH —
        # tmux runs its command through a bare `sh -c`, where `claude` wouldn't be found.
        # `exec bash` after keeps the session alive (inheriting the login PATH).
        run = f"bash -lc '{launch}; exec bash'"
        out += [
            f'  if command -v mosh >/dev/null 2>&1; then',
            f'    if [ -n "$nolaunch" ]; then {loc} mosh "$h" -- tmux new -A -s "$sess"',
            f'''    else {loc} mosh "$h" -- tmux new -A -s "$sess" "{run}"; fi''',
            f'  else',
            f'    if [ -n "$nolaunch" ]; then {loc} ssh -t "$h" "tmux new -A -s $sess"',
            f'''    else {loc} ssh -t "$h" "tmux new -A -s $sess \\"{run}\\""; fi''',
            f'  fi',
        ]
    else:
        out += [
            f'  if command -v mosh >/dev/null 2>&1; then {loc} mosh "$h" -- tmux new -A -s "$sess"',
            f'  else {loc} ssh -t "$h" "tmux new -A -s $sess"; fi',
        ]
    out += ["}", END]
    return "\n".join(out) + "\n"


def shell_rc_path(override):
    if override:
        return os.path.expanduser(override)
    home = os.path.expanduser("~")
    sh = os.environ.get("SHELL", "")
    if "zsh" in sh:
        return os.path.join(home, ".zshrc")
    if "bash" in sh:
        return os.path.join(home, ".bashrc")
    for cand in (".zshrc", ".bashrc"):
        if os.path.exists(os.path.join(home, cand)):
            return os.path.join(home, cand)
    return os.path.join(home, ".zshrc")


def write_shell_rc(block, path):
    existing = open(path).read() if os.path.exists(path) else ""
    if existing:
        shutil.copy2(path, path + ".bak")
    stripped = re.sub(re.escape(BEGIN) + r".*?" + re.escape(END) + r"\n?", "", existing, flags=re.S)
    new = (stripped.rstrip() + "\n\n" if stripped.strip() else "") + block
    with open(path, "w") as f:
        f.write(new)
    short = path.replace(os.path.expanduser("~"), "~")
    print(f"  ✓ {short} updated (backup: {short}.bak) — open a new terminal or `source {short}`")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo")
    ap.add_argument("--prefix", default="devbox")
    ap.add_argument("--host", help="override the box hostname (else from inventory.ini)")
    ap.add_argument("--key", help="override IdentityFile (else operator_private_key_path)")
    ap.add_argument("--zed", action="store_true", help="write Zed config even if Zed isn't detected")
    ap.add_argument("--no-zed", action="store_true")
    ap.add_argument("--default", help="default profile for the bare `<prefix>` command (else the first)")
    ap.add_argument("--shell-rc", help="shell rc file to write the connect function into (else autodetect)")
    ap.add_argument("--no-shell", action="store_true", help="don't add the shell connect function")
    ap.add_argument("--locale", default="en_US.UTF-8", help="locale the connect command pins (LANG/LC_ALL/LC_CTYPE) so mosh-server starts (default en_US.UTF-8)")
    ap.add_argument("--launch", default="", help="command to auto-run on a fresh session, e.g. 'claude' (default: none — lands in a shell)")
    args = ap.parse_args()

    repo = find_repo(args.repo)
    v = load_vars(repo)
    profiles = v.get("profiles") or []
    if not profiles:
        die("no profiles in group_vars/all.yml")
    host = box_host(repo, args.host)
    key = args.key or v.get("operator_private_key_path") or "~/.ssh/id_ed25519"
    users = [p["user"] for p in profiles]
    default = args.default or users[0]
    if default not in users:
        die(f"--default '{default}' is not a profile (have: {', '.join(users)})")

    print(f"Box {host} · {len(profiles)} profile(s) · alias prefix '{args.prefix}-'")
    write_ssh_config(ssh_block(profiles, host, key, args.prefix))
    if not args.no_zed:
        write_zed(zed_entries(profiles, args.prefix), args.prefix, args.zed)
    if not args.no_shell:
        write_shell_rc(shell_block(profiles, args.prefix, default, args.locale, args.launch), shell_rc_path(args.shell_rc))

    aliases = ", ".join(f"{args.prefix}-{p['user']}" for p in profiles)
    print(f"\nDone.")
    print(f"  • Terminal (mosh+tmux, drop-proof):  {args.prefix} [profile] [session]")
    print(f"      e.g. `{args.prefix}` → {default} · `{args.prefix} {users[-1]}` → {users[-1]} · 2nd arg = tmux session")
    print(f"  • VS Code / Cursor: Remote-SSH → Connect to Host → {aliases}")
    print(f"  • Zed: command palette → 'projects: open remote'")


if __name__ == "__main__":
    main()
