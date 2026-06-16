import { describe, expect, test } from "bun:test";
import { DEFAULT_IGNORES, engineFor } from "./engine";

describe("engine factory", () => {
  test("mutagen returns the Mutagen engine", () => {
    expect(engineFor("mutagen").id).toBe("mutagen");
  });
  test("default ignores cover heavy dirs and OS/editor cruft", () => {
    expect(DEFAULT_IGNORES).toContain("node_modules");
    expect(DEFAULT_IGNORES).toContain("target");
    expect(DEFAULT_IGNORES).toContain(".DS_Store");
    expect(DEFAULT_IGNORES).toContain("._*");
    expect(DEFAULT_IGNORES).toContain("Thumbs.db");
  });
  test("syncthing returns the Syncthing engine", () => {
    expect(engineFor("syncthing").id).toBe("syncthing");
  });
});
