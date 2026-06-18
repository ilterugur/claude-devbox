import type { SwapDevice } from "../types";

export function parseSwap(swaponOutput: string): SwapDevice[] {
  return swaponOutput
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => l.split(/\s+/))
    .filter((f) => f.length >= 5)
    .map(([name, type, size, used, prio]) => ({
      name,
      type,
      sizeBytes: Number(size),
      usedBytes: Number(used),
      priority: Number(prio),
    }));
}
