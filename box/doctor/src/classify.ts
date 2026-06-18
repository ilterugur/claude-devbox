import type { ProcRef, SessionState } from "./types";

export interface ClassifyOpts {
  now: number;
  activityWindowSec: number;
  idleAfterSec: number;
}

export function classifySession(
  s: { pid: number | null; lastActivity: number | null },
  opts: ClassifyOpts,
): SessionState {
  if (s.pid === null) return "dead";
  // Live process but unknown last activity: treat as active (conservative —
  // never mark a running session idle/dead and thus eligible for cleanup).
  if (s.lastActivity === null) return "active";
  const age = opts.now - s.lastActivity;
  if (age <= opts.activityWindowSec) return "active";
  if (age >= opts.idleAfterSec) return "idle";
  // Middle band (older than the activity window, younger than the idle
  // threshold): treat as active. A session that merely paused mid-task must
  // never be classified idle/dead and become eligible for disruptive cleanup.
  return "active";
}

/**
 * A worktree is protected if ANY live process references its path — including a
 * process owned by a different session (e.g. a build cd'd into the worktree).
 * This is the guard that prevented deleting an in-use worktree during the
 * 2026-06-18 OOM cleanup.
 *
 * NOTE: matches by substring on the raw `ps` args column; relies on worktree
 * path uniqueness (bridge-cse_<ulid>) and does not resolve symlinks.
 */
export function isWorktreeProtected(
  worktreePath: string,
  procs: ProcRef[],
): boolean {
  const needle = worktreePath.replace(/\/+$/, "");
  return procs.some((p) => p.cmd.includes(needle));
}
