import { expect, test } from "bun:test";
import { parseSwap } from "./swap";

const fixture = await Bun.file(
  new URL("../../test/fixtures/swapon.txt", import.meta.url),
).text();

test("parseSwap reads each swap device with bytes + priority", () => {
  const s = parseSwap(fixture);
  expect(s).toHaveLength(2);
  expect(s[0]).toEqual({
    name: "/swapfile",
    type: "file",
    sizeBytes: 8589934592,
    usedBytes: 0,
    priority: -1,
  });
  expect(s[1].name).toBe("/dev/zram0");
  expect(s[1].priority).toBe(100);
  expect(s[1].usedBytes).toBe(3037822976);
});

test("parseSwap returns [] for empty input", () => {
  expect(parseSwap("")).toEqual([]);
});
