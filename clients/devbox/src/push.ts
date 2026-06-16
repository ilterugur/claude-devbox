/**
 * push.ts — `devbox push`: copy a Claude Code session to the box, rewriting the
 * client-local absolute paths embedded in it so it resumes against the box's
 * filesystem. Pure helpers (buildMappings / applyMappings / rewriteJsonl) are
 * exported for unit tests; runPush() is the orchestration.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  type Config,
  connect,
  die,
  encodeCwd,
  findSessionFile,
  gitMatch,
  hostFor,
  isWorktree,
  listSessions,
  readSessionCwd,
  sessionsDir,
  shQuote,
  users,
} from "./config";
import { pickSessionUI } from "./picker";
import { buildMappings, changedLines, rewriteJsonl, stageSidecar } from "./transcript";

export type PushOpts = {
  project?: string;
  session?: string;
  pick?: boolean;
  profile?: string;
  remoteCwd?: string;
  map?: string[];
  remapHome?: boolean;
  sidecar?: boolean; // default true
  go?: boolean;
  yes?: boolean;
  force?: boolean;
};

const isDry = () => !!process.env.DEVBOX_DRYRUN;

export async function runPush(cfg: Config, opts: PushOpts): Promise<void> {
  // --go drives an interactive mosh/ssh; refuse early under a non-TTY (e.g. the
  // /devbox-push slash command), where it would hang or fail.
  if (opts.go && !isDry() && !process.stdout.isTTY)
    die("--go needs an interactive terminal — run the printed `claude --resume` yourself, or drop --go");

  // ── 1. resolve the session ──────────────────────────────────────────────
  let id = opts.session || process.env.CLAUDE_CODE_SESSION_ID || null;

  if (opts.pick) {
    const items = listSessions(process.cwd());
    if (!items.length) die(`no sessions found for ${process.cwd()}`);
    const chosen = await pickSessionUI(items);
    if (!chosen) return; // cancelled
    id = chosen.id;
  }

  if (!id) {
    const items = listSessions(process.cwd());
    if (!items.length) die(`no session id ($CLAUDE_CODE_SESSION_ID unset) and no sessions in ${sessionsDir(process.cwd())}`);
    if (items.length > 1 && Math.abs(items[0].mtime - items[1].mtime) < 1000)
      die("two sessions touched simultaneously here — pass --session <id> or --pick");
    id = items[0].id;
  }

  if (!/^[A-Za-z0-9._-]+$/.test(id)) die(`invalid session id "${id}" (expected a session uuid, no slashes)`);

  const found = findSessionFile(id);
  if (!found) die(`session ${id} not found under ~/.claude/projects`);
  const { file: sourceFile, dir: sourceDir } = found;
  const sourceCwd = readSessionCwd(sourceFile);
  if (!sourceCwd) die(`could not read a cwd from ${sourceFile}`);

  // ── 2. resolve the target (fail closed) ─────────────────────────────────
  const matches = gitMatch(cfg, sourceCwd);
  let profile: string;
  let project: string;
  if (opts.profile) {
    if (!users(cfg).includes(opts.profile)) die(`unknown profile "${opts.profile}" (have: ${users(cfg).join(" ")})`);
    profile = opts.profile;
    project = opts.project || matches.find((m) => m.profile === profile)?.project || "";
    if (!project && !opts.remoteCwd) die(`pass the box project name: devbox push <project> --profile ${profile}`);
  } else if (matches.length === 0) {
    die(
      `origin of ${sourceCwd} is not in any profile's config — ` +
        `pass --profile <p> <project> (and --remote-cwd <dir> if needed)`,
    );
  } else if (matches.length > 1) {
    const cands = matches.map((m) => `${m.profile}/${m.project}`).join(", ");
    die(`origin matches multiple profiles (${cands}) — disambiguate with --profile <p>`);
  } else {
    profile = matches[0].profile;
    project = matches[0].project;
  }

  // worktree guard — also catch a worktree whose dir was already removed locally
  // (then isWorktree can't inspect it) by spotting the '.claude-worktrees' shape.
  if (!opts.remoteCwd && (sourceCwd.includes("/.claude-worktrees/") || (existsSync(sourceCwd) && isWorktree(sourceCwd))))
    die(`${sourceCwd} looks like a git worktree with no /home/${profile}/projects/<project> equivalent — pass --remote-cwd <dir>`);

  const remoteRoot = opts.remoteCwd || `/home/${profile}/projects/${project}`;
  // A label for the tmux session / resume hint when project couldn't be resolved
  // (only possible with --profile + --remote-cwd and no config match).
  const projectLabel = project || basename(remoteRoot);
  const host = hostFor(cfg, profile);
  const remoteDir = `/home/${profile}/.claude/projects/${encodeCwd(remoteRoot)}`;
  const remoteFile = `${remoteDir}/${id}.jsonl`;
  const remoteSidecar = `${remoteDir}/${id}`;

  // ── 3. mappings + sidecar inventory ─────────────────────────────────────
  // push direction: client home (/Users/<you>) -> /home/<profile>
  const mappings = buildMappings(sourceCwd, remoteRoot, {
    map: opts.map,
    homeFrom: opts.remapHome ? sourceCwd : undefined,
    homeTo: opts.remapHome ? `/home/${profile}` : undefined,
  });
  const sidecarSrc = join(sourceDir, id);
  const hasSidecar = (opts.sidecar ?? true) && existsSync(sidecarSrc) && statSync(sidecarSrc).isDirectory();

  // remote script (built up front so the dry-run can show it verbatim)
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const remoteScript = [
    "set -e",
    `mkdir -p ${shQuote(remoteDir)}`,
    `if [ -f ${shQuote(remoteFile)} ]; then cp -p ${shQuote(remoteFile)} ${shQuote(`${remoteFile}.bak-${ts}`)}; fi`,
    `if [ -d ${shQuote(remoteSidecar)} ]; then cp -a ${shQuote(remoteSidecar)} ${shQuote(`${remoteSidecar}.bak-${ts}`)}; fi`,
    `tar -xzf - -C ${shQuote(remoteDir)}`,
    `chmod 600 ${shQuote(remoteFile)}`,
    `if [ -d ${shQuote(remoteSidecar)} ]; then chmod -R u=rwX,go= ${shQuote(remoteSidecar)}; fi`,
  ].join("; ");

  // ── 4. plan / dry-run output ────────────────────────────────────────────
  const out = (s: string) => process.stdout.write(s + "\n");
  out("");
  out(`  session   ${id}`);
  out(`  source    ${sourceFile}${hasSidecar ? "  (+ sidecar dir)" : ""}`);
  out(`  target    ${host}:${remoteFile}`);
  out(`  remap     ${sourceCwd}`);
  out(`         -> ${remoteRoot}`);
  for (const m of mappings) if (m.from !== sourceCwd) out(`            +  ${m.from} -> ${m.to}`);
  out("");

  if (isDry()) {
    const preview = changedLines(readFileSync(sourceFile, "utf8"), mappings);
    out(`  ── dry run — would rewrite ${preview.length}${preview.length >= 8 ? "+" : ""} lines (paths swapped per the remap above)`);
    out(`  ── would probe liveness, then run on ${host}:`);
    out(`     tar -czf - -C <staging> . | ssh ${shQuote(host)} ${shQuote(remoteScript)}`);
    if (opts.go) {
      out(`  ── then resume on the box:`);
      connect(cfg, profile, projectLabel, { launch: `claude --resume ${shQuote(id)}`, dir: opts.remoteCwd });
    }
    out("");
    return;
  }

  // ── 5. liveness / divergence (unless --force) ───────────────────────────
  if (!opts.force) {
    const probe = `stat -c %Y ${shQuote(remoteFile)} 2>/dev/null || echo NONE; echo ---SPLIT---; tmux ls 2>/dev/null || true`;
    const r = spawnSync("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", host, probe], { encoding: "utf8" });
    if (!r.stdout?.includes("---SPLIT---"))
      die(`could not reach ${host}: ${(r.stderr || "").trim() || "ssh failed"}`);
    const [mtimePart = "", tmuxPart = ""] = r.stdout.split("---SPLIT---");
    const remoteMtime = mtimePart.trim() === "NONE" ? 0 : parseInt(mtimePart.trim(), 10) * 1000;
    const localMtime = statSync(sourceFile).mtimeMs;
    if (remoteMtime && remoteMtime > localMtime + 2000)
      out(`  ⚠ remote copy is newer than local (box-side edits, or clock skew) — a backup is made before overwriting.`);
    const live = tmuxPart.split("\n").some((l) => l.startsWith(`${projectLabel}:`) && l.includes("(attached)"));
    if (live) die(`a tmux session "${projectLabel}" is attached on ${host} — close it or re-run with --force.`);
  }

  // ── 6. confirm (unless --yes) ───────────────────────────────────────────
  if (!opts.yes) {
    if (!process.stdin.isTTY) die("refusing to push without confirmation — pass --yes (or run in a terminal)");
    const ans = prompt(`Push to ${host}:${remoteFile}? [y/N]`);
    if (!ans || !/^y(es)?$/i.test(ans.trim())) die("aborted");
  }

  // ── 7. stage (rewrite) into a temp dir mirroring the remote layout ──────
  const staging = mkdtempSync(join(tmpdir(), "devbox-push-"));
  writeFileSync(join(staging, `${id}.jsonl`), rewriteJsonl(readFileSync(sourceFile, "utf8"), mappings));
  let sidecarInfo = "";
  if (hasSidecar) {
    const stats = stageSidecar(sidecarSrc, join(staging, id), mappings);
    sidecarInfo = `, sidecar ${stats.files} files`;
  }

  // ── 8. transfer (backup + extract + perms) over one ssh channel ─────────
  const pipe = `tar -czf - -C ${shQuote(staging)} . | ssh ${shQuote(host)} ${shQuote(remoteScript)}`;
  const t = spawnSync("sh", ["-c", pipe], { stdio: ["ignore", "inherit", "inherit"] });
  if (t.status !== 0) die(`transfer failed (exit ${t.status}); the remote backup .bak-${ts} (if any) is intact`);

  out(`  ✓ pushed ${id} -> ${host}:${remoteFile}${sidecarInfo}`);
  out(`  ⓘ fork: this client session keeps growing independently of the box copy.`);
  if (opts.remoteCwd) out(`     continue on the box:  in ${remoteRoot},  claude --resume ${id}`);
  else out(`     continue on the box:  devbox ${projectLabel} --shell   then   claude --resume ${id}`);

  // ── 9. --go: connect and resume on the box ──────────────────────────────
  if (opts.go) connect(cfg, profile, projectLabel, { launch: `claude --resume ${shQuote(id)}`, dir: opts.remoteCwd });
}
