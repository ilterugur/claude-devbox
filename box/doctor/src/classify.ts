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
  const age = s.lastActivity === null ? Infinity : opts.now - s.lastActivity;
  if (age <= opts.activityWindowSec) return "active";
  if (age >= opts.idleAfterSec) return "idle";
  return "active";
}

/**
 * A worktree is protected if ANY live process references its path — including a
 * process owned by a different session (e.g. a build cd'd into the worktree).
 * This is the guard that prevented deleting an in-use worktree during the
 * 2026-06-18 OOM cleanup.
 */
export function isWorktreeProtected(
  worktreePath: string,
  procs: ProcRef[],
): boolean {
  return procs.some((p) => p.cmd.includes(worktreePath));
}
