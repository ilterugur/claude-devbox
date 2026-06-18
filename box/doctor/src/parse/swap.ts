import type { SwapDevice } from "../types";

export function parseSwap(swaponOutput: string): SwapDevice[] {
  return swaponOutput
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => {
      const [name, type, size, used, prio] = l.split(/\s+/);
      return {
        name,
        type,
        sizeBytes: Number(size),
        usedBytes: Number(used),
        priority: Number(prio),
      };
    });
}
