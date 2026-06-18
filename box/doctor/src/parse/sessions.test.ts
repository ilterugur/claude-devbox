import { expect, test } from "bun:test";
import { parseProcs, sessionPidsByCse } from "./sessions";

const fixture = await Bun.file(
  new URL("../../test/fixtures/ps.txt", import.meta.url),
).text();

test("parseProcs returns pid + full command for every line", () => {
  const procs = parseProcs(fixture);
  expect(procs).toHaveLength(3);
  expect(procs[0].pid).toBe(276320);
  expect(procs[2].cmd).toContain("bridge-cse_01XYmhZX");
});

test("sessionPidsByCse maps a --session-id claude proc to its cse", () => {
  const procs = parseProcs(fixture);
  const map = sessionPidsByCse(procs);
  expect(map.get("cse_01CVdoCPw3jAccG5ffsXHvs3")).toBe(279938);
  expect(map.has("cse_01XYmhZXmWvZ8hXg9nj2dQXZ")).toBe(false);
});
