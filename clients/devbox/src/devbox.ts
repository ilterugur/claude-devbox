#!/usr/bin/env bun
/**
 * devbox — connect to a claude-devbox profile/project over mosh+tmux (ssh fallback),
 * or `devbox push` a Claude Code session to the box and resume it there.
 *
 * Reads ~/.config/claude-devbox/config.json (written by gen-editor-config.py --cli)
 * and the active-profile state file. Bare `devbox` git-auto-opens the matching box
 * project for $PWD, else shows a fuzzy picker. All domain logic lives in config.ts;
 * this file is only the cac wiring. Set DEVBOX_DRYRUN=1 to print commands instead.
 */
import { cac } from "cac";
import { spawnSync } from "node:child_process";
import {
  type Config,
  connect,
  die,
  gitMatch,
  hostFor,
  lazyMountOnConnect,
  lazyMountsFor,
  loadConfig,
  projectsOf,
  readState,
  resolveProfile,
  users,
  writeState,
} from "./config";
import { pickUI } from "./picker";
import { runPush } from "./push";
import { runMountUp, runMountDown, runMountStatus } from "./mount";
import { runSyncUp, runSyncDown, runSyncStatus, runSyncPause } from "./sync";

function newHelp(prof: string) {
  const lines = [
    "",
    `  Add a new project to profile '${prof}' (edit the claude-devbox repo, re-run the playbook):`,
    `    1) ansible/group_vars/all.yml — add under that profile's projects:`,
    `         - { name: myproj, repo: "git@github.com:org/myproj.git", branch: main }`,
    `    2) cd ansible && ansible-playbook -i inventory.ini playbook.yml --tags projects`,
    `    3) private repo? add the profile's SSH key to GitHub, then re-run.`,
    `    Then:  devbox myproj`,
    "",
  ];
  process.stderr.write(lines.join("\n") + "\n");
}

const cfg: Config = loadConfig();
const cli = cac("devbox");

cli
  .command("use [profile]", "show, or set, the remembered active profile")
  .action((profile?: string) => {
    const active = readState() ?? cfg.default;
    if (!profile) {
      console.log(`active profile: ${active}`);
      if (users(cfg).length > 1) {
        console.log("profiles:");
        for (const u of users(cfg)) console.log(`  ${u === active ? "●" : "○"} ${u}`);
        console.log(`switch with:  devbox use <profile>   (or ⌃p in the picker)`);
      }
      return;
    }
    if (!users(cfg).includes(profile)) die(`unknown profile "${profile}" (have: ${users(cfg).join(" ")})`);
    writeState(profile);
    console.log(`active profile -> ${profile}`);
  });

cli
  .command("ls [profile]", "list open (attachable) tmux sessions")
  .action((profile?: string) => {
    const prof = resolveProfile(cfg, profile);
    const env = { ...process.env, LANG: cfg.locale, LC_ALL: cfg.locale, LC_CTYPE: cfg.locale };
    if (process.env.DEVBOX_DRYRUN) {
      return void process.stdout.write(JSON.stringify(["ssh", hostFor(cfg, prof), "tmux ls ..."]) + "\n");
    }
    const r = spawnSync("ssh", [hostFor(cfg, prof), "tmux ls 2>/dev/null || echo '(no open sessions)'"], {
      stdio: "inherit",
      env,
    });
    process.exit(r.status ?? 0);
  });

cli
  .command("push [project]", "copy the current (or picked) session to the box and resume it there")
  .option("--session <id>", "session id (default: $CLAUDE_CODE_SESSION_ID, else newest in $PWD)")
  .option("--pick", "fuzzy-pick a recent session for this project")
  .option("-p, --profile <profile>", "target profile (required when origin is unmatched/ambiguous)")
  .option("--remote-cwd <dir>", "override the remote project root (required for worktree sources)")
  .option("--map <pair>", "extra path mapping OLD=NEW (repeatable)")
  .option("--remap-home", "also remap /Users/<you> -> /home/<profile>")
  .option("--no-sidecar", "do not transfer the <id>/ sidecar dir")
  .option("--go", "after push, connect and `claude --resume` on the box")
  .option("--yes", "skip the confirmation prompt")
  .option("--force", "overwrite even if the remote copy is live or newer")
  .action(async (project: string | undefined, opts: Record<string, unknown>) => {
    const maps = opts.map ? (Array.isArray(opts.map) ? (opts.map as string[]) : [opts.map as string]) : [];
    await runPush(cfg, {
      project,
      session: opts.session as string | undefined,
      pick: !!opts.pick,
      profile: opts.profile as string | undefined,
      remoteCwd: opts.remoteCwd as string | undefined,
      map: maps,
      remapHome: !!opts.remapHome,
      sidecar: opts.sidecar !== false,
      go: !!opts.go,
      yes: !!opts.yes,
      force: !!opts.force,
    });
  });

cli
  .command("mount [action]", "lazy-mount configured client paths on the box (action: up|down|status)")
  .option("-p, --profile <profile>", "target profile")
  .option("--label <label>", "only this mount (for down)")
  .action((action: string | undefined, opts: { profile?: string; label?: string }) => {
    const prof = resolveProfile(cfg, opts.profile);
    switch (action ?? "up") {
      case "up": return runMountUp(cfg, prof);
      case "down": return runMountDown(cfg, prof, opts.label);
      case "status": return runMountStatus();
      default: return die(`unknown mount action "${action}" (up|down|status)`);
    }
  });

cli
  .command("sync [action]", "two-way sync the ~/devbox/<profile> disk with the box (action: up|down|status|pause|resume)")
  .option("-p, --profile <profile>", "target profile")
  .action(async (action: string | undefined, opts: { profile?: string }) => {
    if ((action ?? "up") === "status") return runSyncStatus(cfg);
    const prof = resolveProfile(cfg, opts.profile);
    switch (action ?? "up") {
      case "up": return runSyncUp(cfg, prof);
      case "down": return runSyncDown(cfg, prof);
      case "pause": return runSyncPause(cfg, prof, false);
      case "resume": return runSyncPause(cfg, prof, true);
      default: return die(`unknown sync action "${action}" (up|down|status|pause|resume)`);
    }
  });

cli
  .command("[project]", "connect — picker, or git-auto-open, when no project is given")
  .option("-p, --profile <profile>", "use this profile for this call only")
  .option("-m, --menu", "force the picker (skip git auto-open)")
  .option("-s, --shell", "open a plain shell (skip the auto-launch)")
  .action(async (project: string | undefined, opts: { profile?: string; menu?: boolean; shell?: boolean }) => {
    const prof = resolveProfile(cfg, opts.profile);
    if (lazyMountOnConnect(cfg, prof) && lazyMountsFor(cfg, prof).length) {
      try { runMountUp(cfg, prof); } catch (e) { process.stderr.write(`devbox: lazy mount skipped: ${(e as Error).message}\n`); }
    }
    if (project) return connect(cfg, prof, project, { shellOnly: !!opts.shell });
    if (!opts.menu) {
      const m = gitMatch(cfg);
      if (m.length) return connect(cfg, m[0].profile, m[0].project, { shellOnly: !!opts.shell });
    }
    const profilesList = cfg.profiles.map((p) => ({ user: p.user, projects: projectsOf(cfg, p.user) }));
    const { profile, result } = await pickUI(profilesList, prof);
    if (result === null) return; // cancelled
    if (profile !== prof) writeState(profile); // persist an in-picker profile switch
    if (result === "__home__") return connect(cfg, profile, null, { shellOnly: !!opts.shell });
    if (result === "__new__") return newHelp(profile);
    return connect(cfg, profile, result, { shellOnly: !!opts.shell });
  });

cli.help();
cli.version("0.1.0");
cli.parse();
