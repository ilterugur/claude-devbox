/**
 * config.ts — side-effect-free domain layer for the devbox CLI.
 *
 * Everything here is a pure function or a small fs/spawn helper with NO top-level
 * execution (no loadConfig() call, no cli.parse()). devbox.ts (the CLI entrypoint)
 * and push.ts both import from here. Keeping it side-effect-free is what lets
 * push.ts reuse the targeting/host/connect logic without booting the CLI.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const CFG_DIR = join(homedir(), ".config", "claude-devbox");
export const CONFIG_PATH = join(CFG_DIR, "config.json");
export const STATE_PATH = join(CFG_DIR, "active-profile");

export type Project = { name: string; repo?: string };
export type Profile = { user: string; projects: Project[] };
// `host` is written by gen-editor-config.py for reference only — the CLI resolves
// the box via the ssh alias `${prefix}-${profile}` (HostName lives in ~/.ssh/config).
export type Config = { prefix: string; default: string; locale: string; launch: string; host?: string; profiles: Profile[] };

export function die(msg: string): never {
  process.stderr.write(`devbox: ${msg}\n`);
  process.exit(1);
}

export function loadConfig(): Config {
  if (!existsSync(CONFIG_PATH)) die(`no config at ${CONFIG_PATH} — run gen-editor-config.py --cli`);
  try {
    const c = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Config;
    if (!c.profiles?.length) die("config has no profiles");
    return c;
  } catch (e) {
    die(`could not read ${CONFIG_PATH}: ${(e as Error).message}`);
  }
}

export const users = (cfg: Config) => cfg.profiles.map((p) => p.user);

export function readState(): string | null {
  try {
    return readFileSync(STATE_PATH, "utf8").trim() || null;
  } catch {
    return null;
  }
}

export function writeState(prof: string) {
  mkdirSync(CFG_DIR, { recursive: true });
  writeFileSync(STATE_PATH, prof + "\n");
}

export function resolveProfile(cfg: Config, override?: string): string {
  const prof = override || readState() || cfg.default;
  if (!users(cfg).includes(prof)) die(`unknown profile "${prof}" (have: ${users(cfg).join(" ")})`);
  return prof;
}

/** Normalize a git remote URL to host/owner/repo (lowercased, no scheme/.git). */
export function normRepo(url: string): string {
  let u = url.trim().toLowerCase();
  u = u.replace(/^[a-z+]+:\/\//, ""); // scheme
  u = u.replace(/^git@/, "");
  u = u.replace(/^[^@/]*@/, ""); // user@
  u = u.replace(":", "/"); // git@host:path -> host/path
  u = u.replace(/\/+$/, "");
  u = u.replace(/\.git$/, "");
  return u.replace(/\/+$/, "");
}

/**
 * Return ALL config profiles/projects whose repo matches the origin of the git
 * repo at `cwd` (default: process.cwd()). Empty array if `cwd` is not a git repo,
 * has no origin, or nothing matches. push uses the full list to detect ambiguity;
 * the connect path uses the first entry.
 */
export function gitMatch(cfg: Config, cwd: string = process.cwd()): { profile: string; project: string }[] {
  if (spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd, stdio: "ignore" }).status !== 0) return [];
  const r = spawnSync("git", ["remote", "get-url", "origin"], { cwd, encoding: "utf8" });
  if (r.status !== 0 || !r.stdout?.trim()) return [];
  const want = normRepo(r.stdout);
  const out: { profile: string; project: string }[] = [];
  for (const p of cfg.profiles)
    for (const pr of p.projects) if (pr.repo && normRepo(pr.repo) === want) out.push({ profile: p.user, project: pr.name });
  return out;
}

/**
 * True when `cwd` is a linked git worktree. In a worktree, --absolute-git-dir is
 * .../.git/worktrees/<name> while --git-common-dir resolves to the main .../.git;
 * in the main checkout they are the same.
 */
export function isWorktree(cwd: string): boolean {
  const gitDir = spawnSync("git", ["rev-parse", "--absolute-git-dir"], { cwd, encoding: "utf8" });
  const commonDir = spawnSync("git", ["rev-parse", "--git-common-dir"], { cwd, encoding: "utf8" });
  if (gitDir.status !== 0 || commonDir.status !== 0) return false;
  return resolve(cwd, gitDir.stdout.trim()) !== resolve(cwd, commonDir.stdout.trim());
}

/** POSIX single-quote a value for safe embedding in a remote command string. */
export const shQuote = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";

/** The ssh/mosh host alias for a profile (e.g. `devbox-work`). */
export const hostFor = (cfg: Config, prof: string) => `${cfg.prefix}-${prof}`;

export function connect(
  cfg: Config,
  prof: string,
  project: string | null,
  opts: { shellOnly?: boolean; launch?: string; dir?: string } = {},
) {
  const sess = project || "main"; // treat "" like null (an empty tmux -s name is rejected)
  const dir = opts.dir ?? (project ? `/home/${prof}/projects/${project}` : `/home/${prof}`);
  const host = hostFor(cfg, prof);
  const env = { ...process.env, LANG: cfg.locale, LC_ALL: cfg.locale, LC_CTYPE: cfg.locale };
  const tmux = ["tmux", "new", "-A", "-s", sess, "-c", dir];
  const launch = opts.launch ?? cfg.launch;
  if (!opts.shellOnly && launch) tmux.push("bash", "-lc", `${launch}; exec bash`);
  // Hide tmux's status bar (the green strip) for this session — chained as a second
  // tmux command via a literal ";" arg (works for both the mosh argv and the ssh
  // string, since tmux treats a bare ";" as a command separator).
  tmux.push(";", "set", "status", "off");

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

export function projectsOf(cfg: Config, prof: string): string[] {
  return (cfg.profiles.find((p) => p.user === prof)?.projects ?? []).map((p) => p.name);
}

// ── session / transcript helpers ─────────────────────────────────────────────

/** The Claude Code projects root: ~/.claude/projects. */
export const projectsRoot = () => join(homedir(), ".claude", "projects");

/**
 * Claude Code's encoded-dir rule: an absolute cwd becomes a dir name by replacing
 * every '/' AND every '.' with '-'. Lossy (so ENCODE-only; never decode a dir name).
 */
export const encodeCwd = (cwd: string) => cwd.replaceAll("/", "-").replaceAll(".", "-");

/** ~/.claude/projects/<encoded-cwd> for a given working directory. */
export const sessionsDir = (cwd: string) => join(projectsRoot(), encodeCwd(cwd));

export type SessionItem = { id: string; mtime: number; firstPrompt: string; file: string; dir: string };

/** First genuine human prompt in a transcript, skipping SDK/meta/command injections. */
export function firstHumanPrompt(jsonlPath: string): string {
  let content: string;
  try {
    content = readFileSync(jsonlPath, "utf8");
  } catch {
    return "";
  }
  for (const line of content.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    let rec: any;
    try {
      rec = JSON.parse(s);
    } catch {
      continue;
    }
    if (rec.type !== "user" || rec.isMeta === true || rec.promptSource === "sdk") continue;
    const c = rec.message?.content;
    let text = "";
    if (typeof c === "string") text = c;
    else if (Array.isArray(c)) text = c.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("");
    text = text.trim();
    if (!text || text.startsWith("<command-") || text.startsWith("<system-reminder") || text.startsWith("Caveat:"))
      continue;
    return text;
  }
  return "";
}

/** The first non-null `cwd` recorded in a transcript (the session's working dir). */
export function readSessionCwd(jsonlPath: string): string | null {
  const content = readFileSync(jsonlPath, "utf8");
  for (const line of content.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    let rec: any;
    try {
      rec = JSON.parse(s);
    } catch {
      continue;
    }
    if (typeof rec.cwd === "string" && rec.cwd) return rec.cwd;
  }
  return null;
}

/** Recent sessions for a project's encoded dir, newest first. */
export function listSessions(projectCwd: string): SessionItem[] {
  const dir = sessionsDir(projectCwd);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const items: SessionItem[] = [];
  for (const n of names) {
    if (!n.endsWith(".jsonl")) continue;
    const file = join(dir, n);
    let st;
    try {
      st = statSync(file);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    items.push({ id: n.slice(0, -6), mtime: st.mtimeMs, firstPrompt: firstHumanPrompt(file), file, dir });
  }
  items.sort((a, b) => b.mtime - a.mtime);
  return items;
}

/** Locate a session .jsonl by id across all project dirs. */
export function findSessionFile(id: string): { file: string; dir: string } | null {
  const root = projectsRoot();
  let dirs: string[];
  try {
    dirs = readdirSync(root);
  } catch {
    return null;
  }
  for (const d of dirs) {
    const file = join(root, d, `${id}.jsonl`);
    if (existsSync(file)) return { file, dir: join(root, d) };
  }
  return null;
}
