import { expect, test } from "bun:test";
import { parseRcUnits } from "./rc";

const fixture = await Bun.file(
  new URL("../../test/fixtures/systemctl-units.txt", import.meta.url),
).text();

test("parseRcUnits reads unit/load/active/sub", () => {
  const units = parseRcUnits(fixture);
  expect(units).toHaveLength(2);
  expect(units[0]).toEqual({
    unit: "claude-rc-ilterugur-insurchat.service",
    loaded: true,
    active: "active",
    sub: "exited",
  });
  expect(units[1].active).toBe("failed");
  expect(units[1].sub).toBe("failed");
});
