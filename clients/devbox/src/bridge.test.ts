import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join as pjoin } from "node:path";
import { lazyMountsFor, syncEngineFor, syncDiskEnabled, lazyMountOnConnect, type Config } from "./config";
import {
  normalizePath, pathsOverlap, readBridges, writeBridges, reconcileBridges, syncDiskRoot, freePort, type LiveMount,
} from "./bridge";

const cfg: Config = {
  prefix: "devbox", default: "work", locale: "en_US.UTF-8", launch: "claude",
  profiles: [
    { user: "work", projects: [], lazyMounts: [{ label: "desktop", path: "~/Desktop" }],
      syncEngine: "mutagen", syncDisk: true, lazyMountOnConnect: true },
    { user: "bare", projects: [] },
  ],
};

describe("config bridge accessors", () => {
  test("lazyMountsFor returns the profile's mounts, [] when absent", () => {
    expect(lazyMountsFor(cfg, "work")).toEqual([{ label: "desktop", path: "~/Desktop" }]);
    expect(lazyMountsFor(cfg, "bare")).toEqual([]);
  });
  test("syncEngineFor defaults to mutagen", () => {
    expect(syncEngineFor(cfg, "work")).toBe("mutagen");
    expect(syncEngineFor(cfg, "bare")).toBe("mutagen");
  });
  test("syncDiskEnabled / lazyMountOnConnect default to false", () => {
    expect(syncDiskEnabled(cfg, "work")).toBe(true);
    expect(syncDiskEnabled(cfg, "bare")).toBe(false);
    expect(lazyMountOnConnect(cfg, "work")).toBe(true);
    expect(lazyMountOnConnect(cfg, "bare")).toBe(false);
  });
});

describe("normalizePath", () => {
  test("expands ~ and strips trailing slash", () => {
    expect(normalizePath("~/Desktop/")).toBe(`${homedir()}/Desktop`);
  });
  test("leaves absolute paths, collapses '.' and '..'", () => {
    expect(normalizePath("/a/b/../c")).toBe("/a/c");
  });
  test("root stays '/'", () => {
    expect(normalizePath("/")).toBe("/");
  });
});

describe("pathsOverlap", () => {
  test("equal paths overlap", () => {
    expect(pathsOverlap("~/Desktop", "~/Desktop/")).toBe(true);
  });
  test("ancestor/descendant overlap", () => {
    expect(pathsOverlap("/a/b", "/a/b/c")).toBe(true);
    expect(pathsOverlap("/a/b/c", "/a/b")).toBe(true);
  });
  test("siblings and prefix-but-not-path-boundary do NOT overlap", () => {
    expect(pathsOverlap("/a/b", "/a/c")).toBe(false);
    expect(pathsOverlap("/a/bc", "/a/b")).toBe(false);
  });
});

const sampleMount = (over: Partial<LiveMount> = {}): LiveMount => ({
  profile: "work", label: "desktop", tunnelPort: 5001, rclonePid: 1, sshPid: 1,
  remotePath: "/home/work/mnt/desktop", localPath: "/Users/me/Desktop",
  createdAt: "2026-06-16T00:00:00Z", ...over,
});

describe("bridges state", () => {
  test("write then read round-trips", () => {
    const p = pjoin(mkdtempSync(pjoin(tmpdir(), "br-")), "bridges.json");
    writeBridges([sampleMount()], p);
    expect(readBridges(p)).toEqual([sampleMount()]);
  });
  test("read of a missing file is []", () => {
    expect(readBridges(pjoin(tmpdir(), "does-not-exist-xyz.json"))).toEqual([]);
  });
  test("reconcile drops entries whose pids are dead", () => {
    const p = pjoin(mkdtempSync(pjoin(tmpdir(), "br-")), "bridges.json");
    writeBridges([sampleMount({ label: "live", rclonePid: process.pid, sshPid: process.pid }),
                  sampleMount({ label: "dead", rclonePid: 2_000_000_000, sshPid: 2_000_000_000 })], p);
    const kept = reconcileBridges(p);
    expect(kept.map((m) => m.label)).toEqual(["live"]);
    expect(readBridges(p).map((m) => m.label)).toEqual(["live"]);
  });
});

describe("syncDiskRoot", () => {
  test("is ~/devbox/<profile>", () => {
    expect(syncDiskRoot("work")).toBe(`${homedir()}/devbox/work`);
  });
});

describe("freePort", () => {
  test("returns a usable TCP port number", () => {
    const p = freePort();
    expect(p).toBeGreaterThan(1024);
    expect(p).toBeLessThan(65536);
  });
});
