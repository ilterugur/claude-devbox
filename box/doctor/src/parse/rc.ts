import type { RcUnit } from "../types";

export function parseRcUnits(systemctlOutput: string): RcUnit[] {
  return systemctlOutput
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("claude-rc-"))
    .map((l) => {
      const [unit, load, active, sub] = l.split(/\s+/);
      return { unit, loaded: load === "loaded", active, sub };
    });
}
