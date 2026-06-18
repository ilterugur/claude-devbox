import { expect, test } from "bun:test";
import { parseOomEvents } from "./oom";

const fixture = await Bun.file(
  new URL("../../test/fixtures/dmesg-oom.txt", import.meta.url),
).text();

test("parseOomEvents extracts killed-process events", () => {
  const events = parseOomEvents(fixture);
  expect(events).toHaveLength(1);
  const e = events[0];
  expect(e.process).toBe("bun");
  expect(e.pid).toBe(273394);
  expect(e.uid).toBe(1001);
  expect(e.atText).toBe("Thu Jun 18 07:53:25 2026");
  expect(e.at).toBe(Math.floor(Date.parse("2026-06-18T07:53:25Z") / 1000));
});

test("parseOomEvents ignores non-OOM lines", () => {
  expect(parseOomEvents("[Thu Jun 18 07:50:01 2026] nothing here")).toEqual([]);
});
