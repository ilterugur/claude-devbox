import { isWorktreeProtected } from "./classify";
import type { Condition, ProcRef, RcUnit, Worktree } from "./types";

export interface ConditionInput {
  units: RcUnit[];
  worktrees: Worktree[];
  procs: ProcRef[];
}

export function detectConditions(input: ConditionInput): Condition[] {
  const conds: Condition[] = [];

  for (const u of input.units) {
    if (u.active === "failed") {
      conds.push({
        id: `rc-${u.unit}-failed`,
        severity: "high",
        facts: { unit: u.unit, active: u.active, sub: u.sub },
        candidateAction: "restart-failed-rc",
        guard: "pass", // a failed unit has no running work to protect
      });
    }
  }

  for (const w of input.worktrees) {
    if (w.cse === null) continue; // skip the main checkout
    const protectedByProc = isWorktreeProtected(w.path, input.procs);
    if (protectedByProc) continue; // in use -> not an orphan
    conds.push({
      id: `worktree-${w.cse}-orphan`,
      severity: "low",
      facts: { path: w.path, cse: w.cse },
      candidateAction: "prune-orphan-worktree",
      guard: "pass",
    });
  }

  return conds;
}
