import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeCwd, firstHumanPrompt } from "./config";
import { applyMappings, buildMappings, rewriteJsonl } from "./push";

describe("encodeCwd", () => {
  test("project root: / and . both become -", () => {
    expect(encodeCwd("/Users/alnzy/Documents/Projects/ilterugur/claude-devbox")).toBe(
      "-Users-alnzy-Documents-Projects-ilterugur-claude-devbox",
    );
  });

  test("worktree '/.claude-worktrees/' collapses to a double dash", () => {
    expect(
      encodeCwd("/Users/alnzy/Documents/Projects/onlyjs/insurai/insurchat/.claude-worktrees/koalay-fixes"),
    ).toBe("-Users-alnzy-Documents-Projects-onlyjs-insurai-insurchat--claude-worktrees-koalay-fixes");
  });

  test("remote root", () => {
    expect(encodeCwd("/home/devbox/projects/claude-devbox")).toBe("-home-devbox-projects-claude-devbox");
  });
});

describe("buildMappings", () => {
  const src = "/Users/alnzy/Documents/Projects/ilterugur/claude-devbox";
  const remote = "/home/devbox/projects/claude-devbox";

  test("includes the project root and its dash-encoded variant, longest-first", () => {
    const m = buildMappings(src, remote, { profile: "devbox" });
    // slash form + encoded form
    expect(m.some((x) => x.from === src && x.to === remote)).toBe(true);
    expect(m.some((x) => x.from === encodeCwd(src) && x.to === encodeCwd(remote))).toBe(true);
    // sorted by from-length descending
    for (let i = 1; i < m.length; i++) expect(m[i - 1].from.length >= m[i].from.length).toBe(true);
  });

  test("--map entries are honored", () => {
    const m = buildMappings(src, remote, { profile: "devbox", map: ["/opt/homebrew=/usr/local"] });
    expect(m.some((x) => x.from === "/opt/homebrew" && x.to === "/usr/local")).toBe(true);
  });

  test("--remap-home adds the home mapping but the project root still sorts first", () => {
    const m = buildMappings(src, remote, { profile: "devbox", remapHome: true });
    const home = m.find((x) => x.from === "/Users/alnzy");
    expect(home?.to).toBe("/home/devbox");
    // project root is longer than the home prefix, so it appears earlier in the list
    expect(m.findIndex((x) => x.from === src)).toBeLessThan(m.findIndex((x) => x.from === "/Users/alnzy"));
  });
});

describe("applyMappings / rewriteJsonl", () => {
  const src = "/Users/alnzy/Documents/Projects/ilterugur/claude-devbox";
  const remote = "/home/devbox/projects/claude-devbox";

  test("rewrites the cwd field and the dash-encoded reference, keeps valid JSON", () => {
    const mappings = buildMappings(src, remote, { profile: "devbox" });
    const line = JSON.stringify({
      type: "user",
      cwd: src,
      message: { content: `see ~/.claude/projects/${encodeCwd(src)}/x.jsonl` },
    });
    const out = rewriteJsonl(line + "\n", mappings);
    const rec = JSON.parse(out.trim());
    expect(rec.cwd).toBe(remote);
    expect(rec.message.content).toContain(encodeCwd(remote));
    expect(rec.message.content).not.toContain(encodeCwd(src));
  });

  test("home remap does not clobber the more specific project-root rewrite", () => {
    const mappings = buildMappings(src, remote, { profile: "devbox", remapHome: true });
    const text = `${src}/src/x.ts and /Users/alnzy/.claude/hooks/h.sh`;
    const out = applyMappings(text, mappings);
    expect(out).toBe(`${remote}/src/x.ts and /home/devbox/.claude/hooks/h.sh`);
  });

  test("single pass: a later mapping never clobbers an earlier mapping's output", () => {
    // remoteRoot deliberately contains the client-home substring; with a sequential
    // re-scanning replace, the home mapping would corrupt the project-root output.
    const mappings = buildMappings("/Users/alnzy/proj", "/tmp/X-Users-alnzy-Y", { profile: "work", remapHome: true });
    expect(applyMappings("/Users/alnzy/proj/src/file.ts", mappings)).toBe("/tmp/X-Users-alnzy-Y/src/file.ts");
    // and the dash-encoded form
    expect(applyMappings("-Users-alnzy-proj", mappings)).toBe("-tmp-X-Users-alnzy-Y");
  });

  test("longest-prefix wins at a position (overlapping --map prefixes)", () => {
    const mappings = buildMappings("/x", "/y", { profile: "work", map: ["/data=/srv/data", "/srv=/mnt/srv"] });
    expect(applyMappings("/data/a /srv/b", mappings)).toBe("/srv/data/a /mnt/srv/b");
  });

  test("drops blank/partial trailing lines", () => {
    const mappings = buildMappings(src, remote, { profile: "devbox" });
    const out = rewriteJsonl(`${JSON.stringify({ type: "user", cwd: src })}\n\n`, mappings);
    expect(out.trim().split("\n").length).toBe(1);
  });

  test("throws if a mapping breaks JSON validity", () => {
    const bad = [{ from: "X", to: '"' }];
    expect(() => rewriteJsonl(JSON.stringify({ a: "X" }) + "\n", bad)).toThrow(/invalid JSON/);
  });
});

describe("firstHumanPrompt", () => {
  test("skips SDK / meta / command-injection records", () => {
    const dir = mkdtempSync(join(tmpdir(), "devbox-test-"));
    const file = join(dir, "s.jsonl");
    writeFileSync(
      file,
      [
        JSON.stringify({ type: "queue-operation", operation: "x" }),
        JSON.stringify({ type: "user", promptSource: "sdk", message: { content: "sdk boot" } }),
        JSON.stringify({ type: "user", isMeta: true, message: { content: [{ type: "text", text: "Base directory…" }] } }),
        JSON.stringify({ type: "user", message: { content: "<command-name>foo</command-name>" } }),
        JSON.stringify({ type: "user", message: { content: "the real first question" } }),
      ].join("\n") + "\n",
    );
    expect(firstHumanPrompt(file)).toBe("the real first question");
  });

  test("handles array text-block content", () => {
    const dir = mkdtempSync(join(tmpdir(), "devbox-test-"));
    const file = join(dir, "s.jsonl");
    writeFileSync(
      file,
      JSON.stringify({ type: "user", message: { content: [{ type: "text", text: "hello there" }] } }) + "\n",
    );
    expect(firstHumanPrompt(file)).toBe("hello there");
  });
});
