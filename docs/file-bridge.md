# File bridge

Make client files available to the box. Two mechanisms:

## Lazy mount (read-only, while the client is online)

Declare paths in `group_vars` per profile:

```yaml
lazy_mounts:
  - { label: desktop, path: "~/Desktop" }
lazy_mount_on_connect: true
```

Re-run `gen-editor-config.py --cli` to propagate them, then:

```
devbox mount up        # serve + mount the configured paths
devbox mount status    # show live mounts
devbox mount down      # tear them down
```

On the box they appear read-only at `/home/<profile>/mnt/<label>/`, full-depth. They are a **live
window**: when the client sleeps they go away. For files that must survive the client being closed,
use the sync disk (below).

How it works: a client-side `rclone serve sftp` (jailed to the path, `--read-only`) is reached by
the box through an `ssh -R` reverse tunnel and mounted with `sshfs`. Nothing inbound is opened on
the client; an ephemeral per-mount SSH key keeps the localhost tunnel port private to your profile.

> `/mnt` = transient read-only window (don't author work there, may disappear).
> `/sync` and `/projects` = durable working copies.

## Sync disk (two-way, survives the client being closed)

Enable per profile in `group_vars`:

```yaml
sync_disk: true
sync_engine: mutagen     # default
```

Re-run `gen-editor-config.py --cli`, install Mutagen on the client
(`brew install mutagen-io/mutagen/mutagen`), then:

```
devbox sync up        # start the two-way disk (~/devbox/<profile> <-> box /home/<profile>/sync)
devbox sync status    # sessions + conflict counts
devbox sync pause / devbox sync resume
devbox sync down      # stop syncing (box copy stays on disk)
```

Drag folders into `~/devbox/<profile>/` like a normal disk. They appear on the box at
`/home/<profile>/sync/` and stay there when the client sleeps. Conflicts are surfaced by
`devbox sync status` and resolved manually (no auto-merge). `.git`, `node_modules`, `dist`,
`build`, `.next`, `target` are never synced. Keep git history on the box as your real undo.

### Using Syncthing instead of Mutagen

Set `sync_engine: syncthing` for the profile, re-run the playbook with `--tags syncthing`
(provisions the per-profile box instance), install Syncthing on the client (`brew install
syncthing` + `brew services start syncthing`), then `devbox sync up` as usual. The CLI pairs the
two devices and shares the single folder over the REST API (client directly; box via an ephemeral
`ssh -L` tunnel). Peers connect over Tailscale only — global/local discovery, relays, and NAT are
disabled and the listener is pinned to the box's Tailscale IP.

Conflicts: Syncthing writes `*.sync-conflict-*` files and keeps deleted/replaced copies under
`.stversions` (Trash-Can versioning on both peers). `devbox sync status` shows folder state; use
the Syncthing GUI for per-file conflict detail.
