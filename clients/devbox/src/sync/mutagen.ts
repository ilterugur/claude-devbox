/**
 * mutagen.ts — Mutagen-backed SyncEngine. `mutagen sync create` runs over the system
 * ssh (agent auto-installed on the box, no listener). Two-way-safe ONLY — never
 * two-way-resolved (it can silently delete the box side). Pure argv builders are
 * exported for tests.
 */
import { spawnSync } from "node:child_process";
import { die } from "../config";
import type { SyncEngine, SyncStatus, SyncUpOpts } from "./engine";

export const sessionName = (profile: string): string => `devbox-${profile}`;

export function buildCreateArgs(o: SyncUpOpts): string[] {
  return [
    "sync", "create",
    `--name=${sessionName(o.profile)}`,
    "--label=devbox=true",
    "--sync-mode=two-way-safe",
    "--ignore-vcs",
    ...o.ignores.map((p) => `--ignore=${p}`),
    o.localRoot,
    `${o.host}:${o.remoteRoot}`,
  ];
}

export function buildStatusArgs(): string[] {
  // NOTE: the template field paths (.Session.Name) are mutagen-version-sensitive — verify against
  // the installed mutagen before trusting `devbox sync status`. The char between }} and {{ is a TAB.
  return [
    "sync", "list", "--label-selector=devbox=true",
    "--template", '{{range .}}{{.Session.Name}}\t{{.Status}}\t{{len .Conflicts}}{{"\\n"}}{{end}}',
  ];
}

const mutagen = (args: string[]) => spawnSync("mutagen", args, { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8" });

export class MutagenEngine implements SyncEngine {
  readonly id = "mutagen" as const;

  // Mutagen is driven by synchronous spawnSync; the methods are async only to satisfy
  // the SyncEngine contract (Syncthing genuinely needs async).
  async up(o: SyncUpOpts): Promise<void> {
    // idempotent: skip if the named session exists. Use the exit code of
    // `mutagen sync list <name>` (robust — does NOT depend on --template field paths).
    const exists = spawnSync("mutagen", ["sync", "list", sessionName(o.profile)], { stdio: "ignore" }).status === 0;
    if (exists) return;
    spawnSync("mutagen", ["daemon", "register"], { stdio: "ignore" }); // best-effort login autostart
    const r = mutagen(buildCreateArgs(o));
    if (r.status !== 0) die(`mutagen sync create failed (exit ${r.status})`);
  }

  async down(profile: string): Promise<void> {
    spawnSync("mutagen", ["sync", "terminate", sessionName(profile)], { stdio: "inherit" });
  }

  async pause(profile: string): Promise<void> {
    spawnSync("mutagen", ["sync", "pause", sessionName(profile)], { stdio: "inherit" });
  }

  async resume(profile: string): Promise<void> {
    spawnSync("mutagen", ["sync", "resume", sessionName(profile)], { stdio: "inherit" });
  }

  async status(): Promise<SyncStatus[]> {
    const r = mutagen(buildStatusArgs());
    if (r.status !== 0 || !r.stdout) return [];
    return r.stdout
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => {
        const [name = "", state = "", conflicts = "0"] = l.split("\t");
        return { name, state, conflicts: parseInt(conflicts, 10) || 0 };
      });
  }
}
