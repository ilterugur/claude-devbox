# claude-config/ — portable Claude config to sync to the box

`shared/` (gitignored) is the **single source of truth** for the portable subset
of your `~/.claude` that gets mirrored to the box and copied into every account's
`CLAUDE_CONFIG_DIR`. Populate it with:

```bash
./scripts/bundle-local-config.sh      # curates ~/.claude -> claude-config/shared/
```

then `cd ansible && ansible-playbook playbook.yml` deploys it.

## What belongs here (portable)
`CLAUDE.md`, `skills/`, `agents/`, `commands/`, `output-styles/`, `rules/`,
`workflows/`, `themes/`, `keybindings.json`, `mcp.json` (scrub secrets),
`hooks/` scripts, `statusline-command.sh`.

## What must NOT be here (the bundle script strips these)
`.credentials.json` and `~/.claude.json` (identity + per-project cost/usage —
sharing them cross-wires accounts), plus all session/machine state (`projects/`,
`sessions/`, `history.jsonl`, `statsig/`, caches, `plugins/` payload…).

## settings.json is special
It's collected but **not deployed by default** (`claude_sync_settings: false`)
because real settings carry machine-coupled values — absolute hook paths,
`ANTHROPIC_BASE_URL`, local-binary commands. Curate a box-portable version
(see `settings.shared.example.json`) before opting in. Full details and the
hard caveats: [docs/config-sync.md](../docs/config-sync.md).
