#!/usr/bin/env bun
/**
 * devbox — connect to a claude-devbox profile/project over mosh+tmux (ssh fallback).
 *
 * Reads ~/.config/claude-devbox/config.json (written by gen-editor-config.py --cli)
 * and the active-profile state file. Bare `devbox` git-auto-opens the matching box
 * project for $PWD, else shows a fuzzy picker. The remote command is built as an argv
 * ARRAY and spawned (mosh) — no shell quoting — and POSIX-quoted only for the ssh
 * fallback. Set DEVBOX_DRYRUN=1 to print the command instead of running it.
 */
import { autocomplete, isCancel, note, select } from "@clack/prompts";
import { cac } from "cac";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CFG_DIR = join(homedir(), ".config", "claude-devbox");
const CONFIG_PATH = join(CFG_DIR, "config.json");
const STATE_PATH = join(CFG_DIR, "active-profile");

type Project = { name: string; repo?: string };
type Profile = { user: string; projects: Project[] };
type Config = { prefix: string; default: string; locale: string; launch: string; profiles: Profile[] };

function die(msg: string): never {
  process.stderr.write(`devbox: ${msg}\n`);
  process.exit(1);
}

function loadConfig(): Config {
  if (!existsSync(CONFIG_PATH)) die(`no config at ${CONFIG_PATH} — run gen-editor-config.py --cli`);
  try {
    const c = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Config;
    if (!c.profiles?.length) die("config has no profiles");
    return c;
  } catch (e) {
    die(`could not read ${CONFIG_PATH}: ${(e as Error).message}`);
  }
}

const users = (cfg: Config) => cfg.profiles.map((p) => p.user);

function readState(): string | null {
  try {
    return readFileSync(STATE_PATH, "utf8").trim() || null;
  } catch {
    return null;
  }
}

function writeState(prof: string) {
  mkdirSync(CFG_DIR, { recursive: true });
  writeFileSync(STATE_PATH, prof + "\n");
}

function resolveProfile(cfg: Config, override?: string): string {
  const prof = override || readState() || cfg.default;
  if (!users(cfg).includes(prof)) die(`unknown profile "${prof}" (have: ${users(cfg).join(" ")})`);
  return prof;
}

/** Normalize a git remote URL to host/owner/repo (lowercased, no scheme/.git). */
function normRepo(url: string): string {
  let u = url.trim().toLowerCase();
  u = u.replace(/^[a-z+]+:\/\//, ""); // scheme
  u = u.replace(/^git@/, "");
  u = u.replace(/^[^@/]*@/, ""); // user@
  u = u.replace(":", "/"); // git@host:path -> host/path
  u = u.replace(/\/+$/, "");
  u = u.replace(/\.git$/, "");
  return u.replace(/\/+$/, "");
}

function gitMatch(cfg: Config): { profile: string; project: string } | null {
  if (spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { stdio: "ignore" }).status !== 0) return null;
  const r = spawnSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" });
  if (r.status !== 0 || !r.stdout?.trim()) return null;
  const want = normRepo(r.stdout);
  for (const p of cfg.profiles)
    for (const pr of p.projects) if (pr.repo && normRepo(pr.repo) === want) return { profile: p.user, project: pr.name };
  return null;
}

/** POSIX single-quote a value for safe embedding in the ssh remote command string. */
const shQuote = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";

function connect(cfg: Config, prof: string, project: string | null, shellOnly: boolean) {
  const sess = project ?? "main";
  const dir = project ? `/home/${prof}/projects/${project}` : `/home/${prof}`;
  const host = `${cfg.prefix}-${prof}`;
  const env = { ...process.env, LANG: cfg.locale, LC_ALL: cfg.locale, LC_CTYPE: cfg.locale };
  const tmux = ["tmux", "new", "-A", "-s", sess, "-c", dir];
  if (!shellOnly && cfg.launch) tmux.push("bash", "-lc", `${cfg.launch}; exec bash`);

  const useMosh = Bun.which("mosh") != null;
  // mosh forwards argv after `--` intact (no shell) — clean. ssh joins args into one
  // remote string, so build a properly-quoted string for it.
  const cmd = useMosh ? "mosh" : "ssh";
  const args = useMosh ? [host, "--", ...tmux] : ["-t", host, tmux.map(shQuote).join(" ")];

  if (process.env.DEVBOX_DRYRUN) {
    process.stdout.write(JSON.stringify([cmd, ...args]) + "\n");
    return;
  }
  const child = spawn(cmd, args, { stdio: "inherit", env });
  child.on("error", (e) => die(`failed to run ${cmd}: ${e.message}`));
  child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
}

/** Subsequence fuzzy match (e.g. "isc" matches "insurchat"). */
function fuzzy(label: string, search: string): boolean {
  const s = label.toLowerCase();
  const q = search.toLowerCase();
  let i = 0;
  for (const c of s) if (c === q[i]) i++;
  return i === q.length;
}

async function pick(cfg: Config, prof: string): Promise<string | null> {
  const projects = (cfg.profiles.find((p) => p.user === prof)?.projects ?? []).map((p) => p.name);
  // Level 1 — a tiny fixed branch menu, so the actions are never buried in (and never
  // grow with) the project list. "open a project" leads to the fuzzy project picker.
  const branch = await select({
    message: `devbox · ${prof}`,
    options: [
      ...(projects.length
        ? [{ value: "__project__", label: "open a project", hint: `${projects.length} project${projects.length > 1 ? "s" : ""} — fuzzy search` }]
        : []),
      { value: "__home__", label: "⌂  open in HOME", hint: "no project" },
      { value: "__new__", label: "＋  new project", hint: "how to add one" },
    ],
  });
  if (isCancel(branch)) return null;
  if (branch === "__home__" || branch === "__new__") return branch;
  // Level 2 — the clean fuzzy project list (scales to many projects).
  const proj = await autocomplete({
    message: `devbox · ${prof} › project`,
    placeholder: "type to filter…",
    options: projects.map((p) => ({ value: p, label: p })),
    filter: (search, option) => !search || fuzzy(String(option.label ?? option.value), search),
  });
  return isCancel(proj) ? null : (proj as string);
}

function newHelp(prof: string) {
  note(
    [
      `Edit the claude-devbox repo, then re-run the playbook:`,
      `  1) ansible/group_vars/all.yml — add under ${prof}'s projects:`,
      `       - { name: myproj, repo: "git@github.com:org/myproj.git", branch: main }`,
      `  2) cd ansible && ansible-playbook -i inventory.ini playbook.yml --tags projects`,
      `  3) private repo? add the profile's SSH key to GitHub, then re-run.`,
      `  Then:  devbox myproj`,
    ].join("\n"),
    "Add a new project",
  );
}

const cfg = loadConfig();
const cli = cac("devbox");

cli
  .command("use [profile]", "show, or set, the remembered active profile")
  .action((profile?: string) => {
    if (!profile) return void console.log(`active profile: ${readState() ?? cfg.default}`);
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
      return void process.stdout.write(JSON.stringify(["ssh", `${cfg.prefix}-${prof}`, "tmux ls ..."]) + "\n");
    }
    const r = spawnSync("ssh", [`${cfg.prefix}-${prof}`, "tmux ls 2>/dev/null || echo '(no open sessions)'"], {
      stdio: "inherit",
      env,
    });
    process.exit(r.status ?? 0);
  });

cli
  .command("[project]", "connect — picker, or git-auto-open, when no project is given")
  .option("-p, --profile <profile>", "use this profile for this call only")
  .option("-m, --menu", "force the picker (skip git auto-open)")
  .option("-s, --shell", "open a plain shell (skip the auto-launch)")
  .action(async (project: string | undefined, opts: { profile?: string; menu?: boolean; shell?: boolean }) => {
    const prof = resolveProfile(cfg, opts.profile);
    if (project) return connect(cfg, prof, project, !!opts.shell);
    if (!opts.menu) {
      const m = gitMatch(cfg);
      if (m) return connect(cfg, m.profile, m.project, !!opts.shell);
    }
    const sel = await pick(cfg, prof);
    if (sel === null) return; // cancelled
    if (sel === "__home__") return connect(cfg, prof, null, !!opts.shell);
    if (sel === "__new__") return newHelp(prof);
    return connect(cfg, prof, sel, !!opts.shell);
  });

cli.help();
cli.version("0.1.0");
cli.parse();
