import { describe, it, expect } from "vitest";
import { resolveStateDir } from "../../src/state/paths.ts";
import { JsonStore } from "../../src/state/store.ts";
import { tmpDir } from "../helpers/tmp-dir.ts";
import path from "node:path";

describe("resolveStateDir", () => {
  it("returns an absolute path under the OS user-data dir for 'skillmanager'", () => {
    const dir = resolveStateDir();
    expect(dir).toBeTypeOf("string");
    expect(dir.length).toBeGreaterThan(0);
    expect(dir).toMatch(/skillmanager/i);
  });
});

describe("JsonStore", () => {
  it("returns the default when file is missing, then persists writes", async () => {
    const dir = await tmpDir();
    const store = new JsonStore<{ count: number }>(path.join(dir, "x.json"), { count: 0 });
    expect(await store.read()).toEqual({ count: 0 });
    await store.write({ count: 7 });
    expect(await store.read()).toEqual({ count: 7 });
    const fresh = new JsonStore<{ count: number }>(path.join(dir, "x.json"), { count: 0 });
    expect(await fresh.read()).toEqual({ count: 7 });
  });
});
