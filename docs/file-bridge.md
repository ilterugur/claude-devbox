# File bridge

Make laptop files available to the box. Two mechanisms:

## Lazy mount (read-only, while the laptop is online)

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
window**: when the laptop sleeps they go away. For files that must survive the laptop being closed,
use the sync disk (below).

How it works: a laptop-side `rclone serve sftp` (jailed to the path, `--read-only`) is reached by
the box through an `ssh -R` reverse tunnel and mounted with `sshfs`. Nothing inbound is opened on
the laptop; an ephemeral per-mount SSH key keeps the localhost tunnel port private to your profile.

> `/mnt` = transient read-only window (don't author work there, may disappear).
> `/sync` and `/projects` = durable working copies.

## Sync disk (two-way, survives the laptop being closed)

Enable per profile in `group_vars`:

```yaml
sync_disk: true
sync_engine: mutagen     # default
```

Re-run `gen-editor-config.py --cli`, install Mutagen on the laptop
(`brew install mutagen-io/mutagen/mutagen`), then:

```
devbox sync up        # start the two-way disk (~/devbox/<profile> <-> box /home/<profile>/sync)
devbox sync status    # sessions + conflict counts
devbox sync pause / devbox sync resume
devbox sync down      # stop syncing (box copy stays on disk)
```

Drag folders into `~/devbox/<profile>/` like a normal disk. They appear on the box at
`/home/<profile>/sync/` and stay there when the laptop sleeps. Conflicts are surfaced by
`devbox sync status` and resolved manually (no auto-merge). `.git`, `node_modules`, `dist`,
`build`, `.next`, `target` are never synced. Keep git history on the box as your real undo.
