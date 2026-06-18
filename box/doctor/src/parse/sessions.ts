import type { ProcRef } from "../types";

export function parseProcs(psOutput: string): ProcRef[] {
  return psOutput
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^\d+\s/.test(l))
    .map((l) => {
      const sp = l.indexOf(" ");
      return { pid: Number(l.slice(0, sp)), cmd: l.slice(sp + 1) };
    });
}

const SESSION_ID = /--session-id (cse_[A-Za-z0-9]+)/;

export function sessionPidsByCse(procs: ProcRef[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const p of procs) {
    const m = p.cmd.match(SESSION_ID);
    if (m && p.cmd.includes("--print")) map.set(m[1], p.pid);
  }
  return map;
}
