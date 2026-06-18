import { expect, test } from "bun:test";
import { parseWorktrees } from "./worktrees";

const fixture = await Bun.file(
  new URL("../../test/fixtures/worktrees.txt", import.meta.url),
).text();

test("parseWorktrees extracts bridge worktrees with cse + locked", () => {
  const wts = parseWorktrees(fixture);
  const bridges = wts.filter((w) => w.cse !== null);
  expect(bridges).toHaveLength(2);
  expect(bridges[0].cse).toBe("cse_01CVdoCPw3jAccG5ffsXHvs3");
  expect(bridges[0].locked).toBe(true);
  expect(bridges[0].path).toContain("bridge-cse_01CVdoCP");
});

test("parseWorktrees treats `locked <reason>` as locked", () => {
  const wts = parseWorktrees(
    "worktree /home/u/projects/p/.claude/worktrees/bridge-cse_x\nbranch refs/heads/b\nlocked held by build\n",
  );
  expect(wts[0].locked).toBe(true);
  expect(wts[0].cse).toBe("cse_x");
});
