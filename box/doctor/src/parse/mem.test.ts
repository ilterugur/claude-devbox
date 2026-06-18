import { expect, test } from "bun:test";
import { parseMem } from "./mem";

const fixture = await Bun.file(
  new URL("../../test/fixtures/free.txt", import.meta.url),
).text();

test("parseMem reads the Mem: row of `free -b`", () => {
  const m = parseMem(fixture);
  expect(m.totalBytes).toBe(8131299328);
  expect(m.usedBytes).toBe(6979321856);
  expect(m.freeBytes).toBe(811597824);
  expect(m.availableBytes).toBe(1073741824);
});
