import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ActivityLogStore } from "../../src/state/activity-log.ts";

describe("ActivityLogStore", () => {
  let dir: string;
  let store: ActivityLogStore;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "actlog-test-"));
    store = new ActivityLogStore(dir);
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("list returns empty array initially", async () => {
    expect(await store.list()).toEqual([]);
  });

  it("add persists an entry with generated id, newest first", async () => {
    const e1 = await store.add({ ts: "2026-01-01T00:00:00Z", category: "install", summary: "first" });
    const e2 = await store.add({ ts: "2026-01-02T00:00:00Z", category: "refresh", summary: "second" });
    expect(e1.id).toMatch(/[0-9a-f-]{36}/);
    expect(e2.id).toMatch(/[0-9a-f-]{36}/);
    const entries = await store.list();
    expect(entries[0]!.summary).toBe("second");
    expect(entries[1]!.summary).toBe("first");
  });

  it("list filters by category", async () => {
    await store.add({ ts: "2026-01-01T00:00:00Z", category: "install", summary: "install one" });
    await store.add({ ts: "2026-01-02T00:00:00Z", category: "refresh", summary: "refresh one" });
    const installs = await store.list({ category: "install" });
    expect(installs).toHaveLength(1);
    expect(installs[0]!.category).toBe("install");
  });

  it("list respects limit", async () => {
    for (let i = 0; i < 5; i++) {
      await store.add({ ts: "2026-01-01T00:00:00Z", category: "install", summary: `entry ${i}` });
    }
    const limited = await store.list({ limit: 3 });
    expect(limited).toHaveLength(3);
  });

  it("delete removes an entry by id", async () => {
    const e = await store.add({ ts: "2026-01-01T00:00:00Z", category: "install", summary: "to delete" });
    await store.delete(e.id);
    expect(await store.list()).toHaveLength(0);
  });

  it("caps at 500 entries, discarding oldest", async () => {
    for (let i = 0; i < 502; i++) {
      await store.add({ ts: "2026-01-01T00:00:00Z", category: "install", summary: `entry ${i}` });
    }
    const all = await store.list();
    expect(all).toHaveLength(500);
    expect(all[0]!.summary).toBe("entry 501");
    expect(all[499]!.summary).toBe("entry 2");
  });
});
