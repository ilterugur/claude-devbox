import { describe, expect, test } from "bun:test";
import { buildCreateArgs, buildStatusArgs, sessionName } from "./mutagen";

const opts = {
  profile: "work", host: "devbox-work",
  localRoot: "/Users/me/devbox/work", remoteRoot: "/home/work/sync",
  ignores: ["node_modules", "dist"],
};

describe("mutagen argv", () => {
  test("sessionName is devbox-<profile>", () => {
    expect(sessionName("work")).toBe("devbox-work");
  });
  test("create uses two-way-safe, labels, vcs+dir ignores, never two-way-resolved", () => {
    const a = buildCreateArgs(opts);
    expect(a.slice(0, 2)).toEqual(["sync", "create"]);
    expect(a).toContain("--name=devbox-work");
    expect(a).toContain("--label=devbox=true");
    expect(a).toContain("--sync-mode=two-way-safe");
    expect(a).toContain("--ignore-vcs");
    expect(a).toContain("--ignore=node_modules");
    expect(a).toContain("--ignore=dist");
    expect(a).not.toContain("--sync-mode=two-way-resolved");
    expect(a[a.length - 2]).toBe("/Users/me/devbox/work");
    expect(a[a.length - 1]).toBe("devbox-work:/home/work/sync");
  });
  test("status filters by the devbox label and uses a machine template", () => {
    const a = buildStatusArgs();
    expect(a).toEqual([
      "sync", "list", "--label-selector=devbox=true",
      "--template", '{{range .}}{{.Name}}\t{{.Status}}\t{{len .Conflicts}}{{"\\n"}}{{end}}',
    ]);
  });
});
