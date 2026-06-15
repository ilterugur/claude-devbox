/**
 * engine.ts — pluggable two-way sync engine behind one interface. Mutagen is the
 * default; Syncthing is the second impl. The CLI never branches on engine id — it
 * calls engineFor(syncEngineFor(cfg, profile)).
 */
import { die, type EngineId } from "../config";
import { MutagenEngine } from "./mutagen";
import { SyncthingEngine } from "./syncthing";

export type SyncStatus = { name: string; state: string; conflicts: number };
export type SyncUpOpts = { profile: string; host: string; localRoot: string; remoteRoot: string; ignores: string[] };

export interface SyncEngine {
  id: EngineId;
  up(o: SyncUpOpts): Promise<void>;
  down(profile: string): Promise<void>;
  status(): Promise<SyncStatus[]>;
  pause(profile: string): Promise<void>;
  resume(profile: string): Promise<void>;
}

/** VCS is handled separately (engine-specific); these are the heavy build/dep dirs. */
export const DEFAULT_IGNORES = ["node_modules", "dist", "build", ".next", "target"];

export function engineFor(id: EngineId): SyncEngine {
  if (id === "mutagen") return new MutagenEngine();
  if (id === "syncthing") return new SyncthingEngine();
  return die(`unknown sync engine "${id}"`);
}
