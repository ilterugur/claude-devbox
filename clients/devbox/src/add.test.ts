import { describe, expect, test } from "bun:test";
import { addProjectToYaml, projectEntry, toSshUrl } from "./add";

describe("toSshUrl", () => {
  test("https → git@host:owner/repo.git", () => {
    expect(toSshUrl("https://github.com/org/myproj.git")).toBe("git@github.com:org/myproj.git");
  });
  test("https without .git", () => {
    expect(toSshUrl("https://github.com/org/myproj")).toBe("git@github.com:org/myproj.git");
  });
  test("scp-like git@ passes through canonical", () => {
    expect(toSshUrl("git@github.com:org/myproj.git")).toBe("git@github.com:org/myproj.git");
  });
  test("ssh:// url", () => {
    expect(toSshUrl("ssh://git@github.com/org/myproj.git")).toBe("git@github.com:org/myproj.git");
  });
  test("trailing slash and whitespace", () => {
    expect(toSshUrl("  https://github.com/org/myproj/  ")).toBe("git@github.com:org/myproj.git");
  });
  test("non-github host preserved", () => {
    expect(toSshUrl("https://gitlab.example.com/team/app.git")).toBe("git@gitlab.example.com:team/app.git");
  });
});

describe("projectEntry", () => {
  test("6-space indented block matching group_vars, with full schema", () => {
    expect(projectEntry({ name: "myproj", repo: "git@github.com:org/myproj.git", branch: "main" })).toBe(
      "      - name: myproj\n" +
        '        repo: "git@github.com:org/myproj.git"\n' +
        "        branch: main\n" +
        "        install: true # run `bun install` after clone\n" +
        "        update: false # don't git-pull over Claude's local edits\n" +
        "        ports: []\n",
    );
  });
});

const YML = `---
# header comment
profiles:
  - user: ilterugur
    git_name: "Uğur"
    projects:
      - name: insurchat
        repo: "git@github.com:InsurUp/insurchat.git"
        branch: main
        ports: [3000, 5173]
    servers:
      - project: insurchat
        name: "InsurChat"
  - user: other
    projects:
      - name: alpha
        repo: "git@github.com:org/alpha.git"
        branch: main
`;

const snippet = projectEntry({ name: "myproj", repo: "git@github.com:org/myproj.git", branch: "main" });

describe("addProjectToYaml", () => {
  test("inserts at the end of the correct profile's projects, before servers:", () => {
    const out = addProjectToYaml(YML, "ilterugur", snippet, "myproj");
    const lines = out.split("\n");
    const newIdx = lines.findIndex((l) => l.includes("name: myproj"));
    const serversIdx = lines.findIndex((l) => l.trim() === "servers:");
    const portsIdx = lines.findIndex((l) => l.includes("ports:"));
    expect(newIdx).toBeGreaterThan(portsIdx); // after the last existing project
    expect(newIdx).toBeLessThan(serversIdx); // still inside projects:, before servers:
  });

  test("preserves comments and every original line", () => {
    const out = addProjectToYaml(YML, "ilterugur", snippet, "myproj");
    expect(out).toContain("# header comment");
    for (const orig of YML.split("\n").filter((l) => l.trim())) expect(out).toContain(orig);
  });

  test("targets the right profile when multiple exist", () => {
    const out = addProjectToYaml(YML, "other", snippet, "myproj");
    const lines = out.split("\n");
    // myproj should land after alpha (in 'other'), i.e. after the first profile's whole block
    const alphaIdx = lines.findIndex((l) => l.includes("name: alpha"));
    const newIdx = lines.findIndex((l) => l.includes("name: myproj"));
    expect(newIdx).toBeGreaterThan(alphaIdx);
    // and NOT inside ilterugur's block (before servers:)
    const serversIdx = lines.findIndex((l) => l.trim() === "servers:");
    expect(newIdx).toBeGreaterThan(serversIdx);
  });

  test("refuses a duplicate project name", () => {
    expect(() => addProjectToYaml(YML, "ilterugur", snippet, "insurchat")).toThrow(/already has a project named/);
  });

  test("refuses an unknown profile", () => {
    expect(() => addProjectToYaml(YML, "nope", snippet, "myproj")).toThrow(/not found/);
  });
});
