import { describe, expect, test } from "bun:test";
import { planSync } from "./sync";
import type { Config } from "./config";

const base: Config = {
  prefix: "devbox", default: "work", locale: "en_US.UTF-8", launch: "claude",
  profiles: [{ user: "work", projects: [], syncDisk: true, syncEngine: "mutagen" }],
};

describe("planSync", () => {
  test("derives disk root, remote root, host, engine", () => {
    const p = planSync(base, "work");
    expect(p.localRoot.endsWith("/devbox/work")).toBe(true);
    expect(p.remoteRoot).toBe("/home/work/sync");
    expect(p.host).toBe("devbox-work");
    expect(p.engine).toBe("mutagen");
  });
  test("rejects when sync disk disabled", () => {
    const off: Config = { ...base, profiles: [{ user: "work", projects: [] }] };
    expect(() => planSync(off, "work")).toThrow(/sync disk is not enabled/);
  });
  test("rejects a lazy mount that overlaps the disk", () => {
    const bad: Config = { ...base, profiles: [{ user: "work", projects: [], syncDisk: true,
      lazyMounts: [{ label: "x", path: "~/devbox/work/inner" }] }] };
    expect(() => planSync(bad, "work")).toThrow(/overlaps the sync disk/);
  });
});
