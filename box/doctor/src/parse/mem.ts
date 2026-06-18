import type { MemInfo } from "../types";

export function parseMem(freeOutput: string): MemInfo {
  const line = freeOutput
    .split("\n")
    .find((l) => l.startsWith("Mem:"));
  if (!line) throw new Error("parseMem: no Mem: row in `free -b` output");
  const [, total, used, free, , , available] = line.trim().split(/\s+/);
  return {
    totalBytes: Number(total),
    usedBytes: Number(used),
    freeBytes: Number(free),
    availableBytes: Number(available),
  };
}
