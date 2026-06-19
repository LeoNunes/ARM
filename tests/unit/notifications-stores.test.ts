import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DismissedNotificationsStore } from "../../src/state/notifications.ts";
import { ArtifactSnapshotsStore } from "../../src/state/artifact-snapshots.ts";
import { ArtifactShaBaselineStore } from "../../src/state/artifact-sha-baseline.ts";

describe("DismissedNotificationsStore", () => {
  let dir: string;
  let store: DismissedNotificationsStore;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "notif-test-"));
    store = new DismissedNotificationsStore(dir);
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("isDismissed returns false for unknown key", async () => {
    expect(await store.isDismissed("newArtifact:r1:k1:sha1")).toBe(false);
  });

  it("dismiss persists a key", async () => {
    await store.dismiss("newArtifact:r1:k1:sha1");
    expect(await store.isDismissed("newArtifact:r1:k1:sha1")).toBe(true);
  });

  it("listDismissed returns all dismissed keys", async () => {
    await store.dismiss("key1");
    await store.dismiss("key2");
    const set = await store.listDismissed();
    expect(set.has("key1")).toBe(true);
    expect(set.has("key2")).toBe(true);
    expect(set.size).toBe(2);
  });

  it("dismiss is idempotent", async () => {
    await store.dismiss("key1");
    await store.dismiss("key1");
    const set = await store.listDismissed();
    expect(set.size).toBe(1);
  });
});

describe("ArtifactSnapshotsStore", () => {
  let dir: string;
  let store: ArtifactSnapshotsStore;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "snap-test-"));
    store = new ArtifactSnapshotsStore(dir);
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("getSnapshot returns empty set for unknown repo", async () => {
    const snap = await store.getSnapshot("r1");
    expect(snap.size).toBe(0);
  });

  it("initSnapshot seeds the snapshot if not present", async () => {
    await store.initSnapshot("r1", ["r1:foo", "r1:bar"]);
    const snap = await store.getSnapshot("r1");
    expect(snap.has("r1:foo")).toBe(true);
    expect(snap.has("r1:bar")).toBe(true);
  });

  it("initSnapshot does not overwrite existing snapshot", async () => {
    await store.initSnapshot("r1", ["r1:foo"]);
    await store.initSnapshot("r1", ["r1:bar"]);
    const snap = await store.getSnapshot("r1");
    expect(snap.has("r1:foo")).toBe(true);
    expect(snap.has("r1:bar")).toBe(false);
  });

  it("addToSnapshot adds keys to existing snapshot", async () => {
    await store.initSnapshot("r1", ["r1:foo"]);
    await store.addToSnapshot("r1", ["r1:bar"]);
    const snap = await store.getSnapshot("r1");
    expect(snap.has("r1:foo")).toBe(true);
    expect(snap.has("r1:bar")).toBe(true);
  });

  it("addToSnapshot creates snapshot if none exists", async () => {
    await store.addToSnapshot("r1", ["r1:baz"]);
    const snap = await store.getSnapshot("r1");
    expect(snap.has("r1:baz")).toBe(true);
  });

  it("getSnapshotOrInit seeds and returns wasInitialized=true on first call", async () => {
    const result = await store.getSnapshotOrInit("r1", ["r1:foo", "r1:bar"]);
    expect(result.wasInitialized).toBe(true);
    expect(result.snapshot.has("r1:foo")).toBe(true);
  });

  it("getSnapshotOrInit returns wasInitialized=false when snapshot exists", async () => {
    await store.initSnapshot("r1", ["r1:foo"]);
    const result = await store.getSnapshotOrInit("r1", ["r1:foo", "r1:bar"]);
    expect(result.wasInitialized).toBe(false);
    expect(result.snapshot.has("r1:foo")).toBe(true);
    expect(result.snapshot.has("r1:bar")).toBe(false);
  });
});

describe("ArtifactShaBaselineStore", () => {
  let dir: string;
  let store: ArtifactShaBaselineStore;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "sha-baseline-test-"));
    store = new ArtifactShaBaselineStore(dir);
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("getBaseline returns null for unknown artifact", async () => {
    expect(await store.getBaseline("r1", "r1:skills/foo")).toBeNull();
  });

  it("setBaseline persists a SHA", async () => {
    await store.setBaseline("r1", "r1:skills/foo", "abc123");
    expect(await store.getBaseline("r1", "r1:skills/foo")).toBe("abc123");
  });

  it("setBaseline overwrites existing SHA", async () => {
    await store.setBaseline("r1", "r1:skills/foo", "abc123");
    await store.setBaseline("r1", "r1:skills/foo", "def456");
    expect(await store.getBaseline("r1", "r1:skills/foo")).toBe("def456");
  });

  it("setBulkBaseline writes multiple entries at once", async () => {
    await store.setBulkBaseline("r1", [
      { artifactKey: "r1:skills/foo", sha: "sha-foo" },
      { artifactKey: "r1:skills/bar", sha: "sha-bar" },
    ]);
    expect(await store.getBaseline("r1", "r1:skills/foo")).toBe("sha-foo");
    expect(await store.getBaseline("r1", "r1:skills/bar")).toBe("sha-bar");
  });

  it("different sourceRepoIds are stored independently", async () => {
    await store.setBaseline("r1", "r1:skills/foo", "sha-1");
    await store.setBaseline("r2", "r2:skills/foo", "sha-2");
    expect(await store.getBaseline("r1", "r1:skills/foo")).toBe("sha-1");
    expect(await store.getBaseline("r2", "r2:skills/foo")).toBe("sha-2");
  });
});
