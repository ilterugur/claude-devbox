#!/usr/bin/env python3
"""Register the dev box in your editors, one entry per profile.

Run on your LAPTOP from the repo (or pass --repo). Reads ansible/inventory.ini +
ansible/group_vars/all.yml and writes:

  * ~/.ssh/config            — a managed `Host devbox-<user>` block per profile.
                               Covers VS Code / Cursor Remote-SSH, plain ssh, and
                               Zed (Zed shells out to ssh, inheriting the alias).
  * ~/.config/zed/settings.json — `ssh_connections` referencing those aliases,
                               pre-listing each profile's ~/projects/<name>.

Idempotent: rewrites only its own managed block / its own connection entries, and
backs up each file first. Zed is skipped unless Zed is installed or --zed is given.

  python3 scripts/gen-editor-config.py [--repo PATH] [--prefix devbox] [--host H] [--no-zed|--zed]
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo")
    ap.add_argument("--prefix", default="devbox")
    ap.add_argument("--host", help="override the box hostname (else from inventory.ini)")
    ap.add_argument("--key", help="override IdentityFile (else operator_private_key_path)")
    ap.add_argument("--zed", action="store_true", help="write Zed config even if Zed isn't detected")
    ap.add_argument("--no-zed", action="store_true")
    args = ap.parse_args()

    repo = find_repo(args.repo)
    v = load_vars(repo)
    profiles = v.get("profiles") or []
    if not profiles:
        die("no profiles in group_vars/all.yml")
    host = box_host(repo, args.host)
    key = args.key or v.get("operator_private_key_path") or "~/.ssh/id_ed25519"

    print(f"Box {host} · {len(profiles)} profile(s) · alias prefix '{args.prefix}-'")
    write_ssh_config(ssh_block(profiles, host, key, args.prefix))
    if not args.no_zed:
        write_zed(zed_entries(profiles, args.prefix), args.prefix, args.zed)

    aliases = ", ".join(f"{args.prefix}-{p['user']}" for p in profiles)
    print(f"\nDone. In VS Code/Cursor: Remote-SSH → Connect to Host → {aliases}")
    print(f"In Zed: command palette → 'projects: open remote'.")


if __name__ == "__main__":
    main()
