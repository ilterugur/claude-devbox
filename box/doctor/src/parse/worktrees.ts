import type { Worktree } from "../types";

const CSE = /bridge-(cse_[A-Za-z0-9]+)/;

export function parseWorktrees(porcelain: string): Worktree[] {
  const out: Worktree[] = [];
  let cur: Partial<Worktree> | null = null;
  const flush = () => {
    if (cur?.path) {
      out.push({
        path: cur.path,
        branch: cur.branch ?? "",
        locked: cur.locked ?? false,
        cse: cur.path.match(CSE)?.[1] ?? null,
      });
    }
  };
  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) {
      flush();
      cur = { path: line.slice("worktree ".length).trim(), locked: false };
    } else if (line.startsWith("branch ") && cur) {
      cur.branch = line.slice("branch ".length).trim();
    } else if (line.trim() === "locked" && cur) {
      cur.locked = true;
    }
  }
  flush();
  return out;
}
