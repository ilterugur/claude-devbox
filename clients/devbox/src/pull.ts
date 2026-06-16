/**
 * pull.ts — `devbox pull`: copy a Claude Code session FROM the box back to the
 * client, rewriting the box absolute paths embedded in it so it resumes against
 * the client's filesystem and shows up in the local conversation list (CLI
 * `--resume` and the desktop app both scan ~/.claude/projects/<encoded-cwd>).
 *
 * It is the mirror of push: fetch the raw transcript over ssh, then do ALL the
 * rewrite/staging/backup locally with the shared transcript helpers. Nothing is
 * written on the box.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Config,
  type RemoteSession,
  die,
  getRemoteSession,
  gitMatch,
  hostFor,
  listRemoteSessions,
  localLiveSession,
  resolveProfile,
  sessionsDir,
  shQuote,
  users,
} from "./config";
import { pickSessionUI } from "./picker";
import { backupLocal, buildMappings, changedLines, rewriteJsonl, stageSidecar } from "./transcript";

export type PullOpts = {
  project?: string;
  session?: string;
  pick?: boolean;
  profile?: string;
  localCwd?: string;
  map?: string[];
  remapHome?: boolean;
  sidecar?: boolean; // default true
  go?: boolean;
  yes?: boolean;
  force?: boolean;
};

const isDry = () => !!process.env.DEVBOX_DRYRUN;

/** The client home prefix (/Users/<you> or /home/<you>) for a target dir, if any. */
function homePrefix(cwd: string): string | undefined {
  return /^(\/Users\/[^/]+|\/home\/[^/]+)/.exec(cwd)?.[1];
}

export async function runPull(cfg: Config, opts: PullOpts): Promise<void> {
  if (opts.go && !isDry() && !process.stdout.isTTY)
    die("--go needs an interactive terminal — run the printed `claude --resume` yourself, or drop --go");

  // ── 1. resolve the profile + host ───────────────────────────────────────
  const profile = resolveProfile(cfg, opts.profile);
  if (!users(cfg).includes(profile)) die(`unknown profile "${profile}" (have: ${users(cfg).join(" ")})`);
  const host = hostFor(cfg, profile);

  // ── 2. resolve the box session (pick, or by id) ─────────────────────────
  let remote: RemoteSession | null = null;
  const id = opts.session || null;

  if (opts.pick) {
    if (!process.stdin.isTTY) die("--pick needs an interactive terminal — pass --session <id> instead");
    const sessions = listRemoteSessions(host, profile);
    if (!sessions.length) die(`no sessions found on ${host} for profile ${profile}`);
    const chosen = await pickSessionUI(sessions, "devbox pull");
    if (!chosen) return; // cancelled
    remote = sessions.find((s) => s.id === chosen.id) ?? null;
  } else {
    if (!id) die("no session id — pass --session <id> (or --pick to choose interactively)");
    if (!/^[A-Za-z0-9._-]+$/.test(id)) die(`invalid session id "${id}" (expected a session uuid, no slashes)`);
    remote = getRemoteSession(host, profile, id);
    if (!remote) die(`session ${id} not found on ${host} under /home/${profile}/.claude/projects`);
  }
  if (!remote) return;
  if (!remote.boxRoot) die(`could not read a cwd from the box transcript ${remote.file}`);

  // ── 3. resolve the local target (fail closed, like push) ────────────────
  const localCwd = opts.localCwd || process.cwd();
  if (!opts.localCwd) {
    // No explicit target: require the invocation dir to be a checkout of a project
    // configured for this profile, so we never write into the wrong local tree.
    const matches = gitMatch(cfg, localCwd);
    if (!matches.some((m) => m.profile === profile))
      die(
        `${localCwd} is not a checkout of a ${profile} project — ` +
          `cd into the project's local repo, or pass --local-cwd <dir>`,
      );
  }

  const localDir = sessionsDir(localCwd);
  const localFile = join(localDir, `${remote.id}.jsonl`);
  const localSidecar = join(localDir, remote.id);

  // ── 4. mappings (box -> client; reverse of push) ────────────────────────
  // remap-home reverses push: /home/<profile> -> the client home (/Users/<you>).
  const clientHome = opts.remapHome ? homePrefix(localCwd) : undefined;
  const mappings = buildMappings(remote.boxRoot, localCwd, {
    map: opts.map,
    homeFrom: opts.remapHome ? remote.boxRoot : undefined,
    homeTo: clientHome,
  });

  // ── 5. fetch the raw transcript (+ sidecar) into staging over one ssh ────
  // A conditional remote tar so a missing sidecar isn't a fatal "no such file".
  const wantSidecar = opts.sidecar ?? true;
  const remoteDir = remote.file.replace(/\/[^/]+$/, "");
  const fetchScript =
    `cd ${shQuote(remoteDir)}; files=${shQuote(`${remote.id}.jsonl`)}; ` +
    (wantSidecar ? `[ -d ${shQuote(remote.id)} ] && files="$files ${remote.id}"; ` : "") +
    `tar -czf - $files`;

  // ── 6. plan / dry-run output ────────────────────────────────────────────
  const out = (s: string) => process.stdout.write(s + "\n");
  out("");
  out(`  session   ${remote.id}`);
  out(`  source    ${host}:${remote.file}`);
  out(`  target    ${localFile}`);
  out(`  remap     ${remote.boxRoot}`);
  out(`         -> ${localCwd}`);
  for (const m of mappings) if (m.from !== remote.boxRoot) out(`            +  ${m.from} -> ${m.to}`);
  if (remote.firstPrompt) out(`  prompt    ${remote.firstPrompt.slice(0, 72)}`);
  out("");

  if (isDry()) {
    // Fetch is read-only — safe to preview the real rewrite even in a dry run.
    const staging = fetchToStaging(host, fetchScript);
    const raw = readFileSync(join(staging, `${remote.id}.jsonl`), "utf8");
    const preview = changedLines(raw, mappings);
    out(`  ── dry run — would rewrite ${preview.length}${preview.length >= 8 ? "+" : ""} lines (paths swapped per the remap above)`);
    out(`  ── would back up any existing local copy, then write ${localFile}`);
    if (opts.go) out(`  ── then resume locally:  claude --resume ${remote.id}`);
    out("");
    return;
  }

  // ── 7. liveness / divergence (unless --force) ───────────────────────────
  if (!opts.force) {
    if (localLiveSession(remote.id))
      die(`session ${remote.id} is live on this client — close it or re-run with --force.`);
    if (existsSync(localFile) && statSync(localFile).mtimeMs > remote.mtime + 2000)
      out(`  ⚠ local copy is newer than the box copy (client-side edits) — a backup is made before overwriting.`);
  }

  // ── 8. confirm (unless --yes) ───────────────────────────────────────────
  if (!opts.yes) {
    if (!process.stdin.isTTY) die("refusing to pull without confirmation — pass --yes (or run in a terminal)");
    const ans = prompt(`Pull ${host}:${remote.file} -> ${localFile}? [y/N]`);
    if (!ans || !/^y(es)?$/i.test(ans.trim())) die("aborted");
  }

  // ── 9. fetch, rewrite locally, back up, install ─────────────────────────
  const staging = fetchToStaging(host, fetchScript);
  mkdirSync(localDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  backupLocal(localFile, localSidecar, ts);

  writeFileSync(localFile, rewriteJsonl(readFileSync(join(staging, `${remote.id}.jsonl`), "utf8"), mappings));
  let sidecarInfo = "";
  const stagedSidecar = join(staging, remote.id);
  if (wantSidecar && existsSync(stagedSidecar) && statSync(stagedSidecar).isDirectory()) {
    // Rewrite into a temp sibling, then swap into place so a half-written sidecar
    // never shadows the backup we just made.
    const tmpDest = `${localSidecar}.new-${ts}`;
    const stats = stageSidecar(stagedSidecar, tmpDest, mappings);
    if (existsSync(localSidecar)) renameSync(localSidecar, `${localSidecar}.old-${ts}`);
    renameSync(tmpDest, localSidecar);
    sidecarInfo = `, sidecar ${stats.files} files`;
  }

  out(`  ✓ pulled ${remote.id} <- ${host}:${remote.file}${sidecarInfo}`);
  out(`  ⓘ fork: the box copy keeps growing independently of this client copy.`);
  out(`     resume locally:  claude --resume ${remote.id}`);

  // ── 10. --go: resume locally ────────────────────────────────────────────
  if (opts.go) {
    const r = spawnSync("claude", ["--resume", remote.id], { stdio: "inherit", cwd: localCwd });
    process.exit(r.status ?? 0);
  }
}

/** Stream the remote tar into a fresh temp dir and extract it. Read-only on the box. */
function fetchToStaging(host: string, fetchScript: string): string {
  const staging = mkdtempSync(join(tmpdir(), "devbox-pull-"));
  const pipe = `ssh ${shQuote(host)} ${shQuote(fetchScript)} | tar -xzf - -C ${shQuote(staging)}`;
  const r = spawnSync("sh", ["-c", pipe], { stdio: ["ignore", "inherit", "inherit"] });
  if (r.status !== 0) die(`fetch failed (exit ${r.status})`);
  return staging;
}
