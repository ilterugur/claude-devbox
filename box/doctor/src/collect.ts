import { parseMem } from "./parse/mem";
import { parseSwap } from "./parse/swap";
import { parseOomEvents } from "./parse/oom";
import { parseRcUnits } from "./parse/rc";
import { parseWorktrees } from "./parse/worktrees";
import { parseProcs, sessionPidsByCse } from "./parse/sessions";
import { classifySession } from "./classify";
import { detectConditions } from "./conditions";
import type { Health, Session } from "./types";

async function sh(cmd: string[]): Promise<string> {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore" });
  const out = await new Response(p.stdout).text();
  await p.exited;
  return out;
}

export interface CollectOpts {
  profileHome: string; // e.g. /home/ilterugur
  activityWindowSec: number;
  idleAfterSec: number;
}

export async function collect(opts: CollectOpts): Promise<Health> {
  const now = Math.floor(Date.now() / 1000);

  const [free, swap, dmesg, units, ps] = await Promise.all([
    sh(["free", "-b"]),
    sh(["swapon", "--show=NAME,TYPE,SIZE,USED,PRIO", "--bytes", "--noheadings"]),
    sh(["sh", "-c", "dmesg -T 2>/dev/null | grep -i 'killed process' || true"]),
    sh(["systemctl", "list-units", "claude-rc*", "--all", "--no-legend", "--plain"]),
    sh(["ps", "-eo", "pid,cmd", "--no-headers"]),
  ]);

  const procs = parseProcs(ps);
  const sessionPids = sessionPidsByCse(procs);

  const wtRaw = await sh([
    "sh",
    "-c",
    `find ${opts.profileHome}/projects -maxdepth 2 -name .git -prune -o -type d -name worktrees -print 2>/dev/null | head -1 | xargs -I{} dirname {} | xargs -I{} git -C {} worktree list --porcelain 2>/dev/null || true`,
  ]);
  const worktrees = parseWorktrees(wtRaw);

  const sessions: Session[] = [...sessionPids.entries()].map(([cse, pid]) => ({
    cse,
    pid,
    lastActivity: null,
    worktreePath: worktrees.find((w) => w.cse === cse)?.path ?? null,
    state: classifySession(
      { pid, lastActivity: null },
      { now, activityWindowSec: opts.activityWindowSec, idleAfterSec: opts.idleAfterSec },
    ),
  }));

  return {
    now,
    mem: parseMem(free),
    swap: parseSwap(swap),
    oom: parseOomEvents(dmesg),
    units: parseRcUnits(units),
    sessions,
    worktrees,
    conditions: detectConditions({ units: parseRcUnits(units), worktrees, procs }),
  };
}
