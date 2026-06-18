import type { Health } from "./types";

export function formatJson(h: Health): string {
  return JSON.stringify(h, null, 2);
}

const gib = (b: number) => (b / 1024 ** 3).toFixed(1) + "G";

export function formatHuman(h: Health): string {
  const lines: string[] = [];
  lines.push(
    `MEM  used ${gib(h.mem.usedBytes)}/${gib(h.mem.totalBytes)}  avail ${gib(h.mem.availableBytes)}`,
  );
  for (const s of h.swap) {
    lines.push(`SWAP ${s.name} used ${gib(s.usedBytes)}/${gib(s.sizeBytes)} prio ${s.priority}`);
  }
  if (h.oom.length) {
    lines.push(`OOM  ${h.oom.length} event(s); last: ${h.oom.at(-1)!.atText} (${h.oom.at(-1)!.process})`);
  }
  for (const u of h.units) {
    lines.push(`RC   ${u.unit} ${u.active}/${u.sub}`);
  }
  lines.push("");
  lines.push("CONDITIONS:");
  if (!h.conditions.length) lines.push("  (none)");
  for (const c of h.conditions) {
    lines.push(`  [${c.severity}] ${c.id} -> ${c.candidateAction} (guard: ${c.guard})`);
  }
  return lines.join("\n");
}
