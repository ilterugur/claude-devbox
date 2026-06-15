import { describe, expect, test } from "bun:test";
import { DEFAULT_IGNORES, engineFor } from "./engine";

describe("engine factory", () => {
  test("mutagen returns the Mutagen engine", () => {
    expect(engineFor("mutagen").id).toBe("mutagen");
  });
  test("default ignores cover the heavy dirs", () => {
    expect(DEFAULT_IGNORES).toEqual(["node_modules", "dist", "build", ".next", "target"]);
  });
});
