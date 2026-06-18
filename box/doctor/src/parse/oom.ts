import type { OomEvent } from "../types";

const LINE =
  /^\[(.+?)\]\s+Out of memory: Killed process (\d+) \(([^)]+)\).*?UID:(\d+)/;

export function parseOomEvents(dmesgOutput: string): OomEvent[] {
  const events: OomEvent[] = [];
  for (const line of dmesgOutput.split("\n")) {
    const m = line.match(LINE);
    if (!m) continue;
    const atText = m[1];
    const at = Math.floor(Date.parse(atText + " UTC") / 1000);
    events.push({
      at: Number.isNaN(at) ? 0 : at,
      atText,
      pid: Number(m[2]),
      process: m[3],
      uid: Number(m[4]),
    });
  }
  return events;
}
