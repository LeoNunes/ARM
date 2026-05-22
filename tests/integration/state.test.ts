import { describe, it, expect } from "vitest";
import { resolveStateDir } from "../../src/state/paths.ts";

describe("resolveStateDir", () => {
  it("returns an absolute path under the OS user-data dir for 'skillmanager'", () => {
    const dir = resolveStateDir();
    expect(dir).toBeTypeOf("string");
    expect(dir.length).toBeGreaterThan(0);
    expect(dir).toMatch(/skillmanager/i);
  });
});
