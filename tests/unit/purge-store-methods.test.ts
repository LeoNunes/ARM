import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FavoritesStore } from "../../src/state/favorites.ts";
import { ArtifactSnapshotsStore } from "../../src/state/artifact-snapshots.ts";
import { ArtifactShaBaselineStore } from "../../src/state/artifact-sha-baseline.ts";
import { DismissedNotificationsStore } from "../../src/state/notifications.ts";

let dir: string;
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), "purge-test-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("FavoritesStore.removeByKeyPrefix", () => {
  it("drops only keys starting with the prefix", async () => {
    const s = new FavoritesStore(dir);
    await s.setFavorite("r1:ai/skills/foo", true);
    await s.setFavorite("r1:ai/rules/bar.md", true);
    await s.setFavorite("r2:ai/skills/baz", true);
    await s.removeByKeyPrefix("r1:ai/skills/");
    const keys = await s.listFavorites();
    expect([...keys].sort()).toEqual(["r1:ai/rules/bar.md", "r2:ai/skills/baz"]);
  });
});

describe("ArtifactSnapshotsStore", () => {
  it("removeRepo deletes the whole repo entry", async () => {
    const s = new ArtifactSnapshotsStore(dir);
    await s.initSnapshot("r1", ["r1:ai/skills/foo"]);
    await s.removeRepo("r1");
    expect((await s.getSnapshot("r1")).size).toBe(0);
  });
  it("removeByKeyPrefix drops matching keys from the array", async () => {
    const s = new ArtifactSnapshotsStore(dir);
    await s.initSnapshot("r1", ["r1:ai/skills/foo", "r1:ai/rules/bar.md"]);
    await s.removeByKeyPrefix("r1", "r1:ai/skills/");
    expect([...(await s.getSnapshot("r1"))]).toEqual(["r1:ai/rules/bar.md"]);
  });
});

describe("ArtifactShaBaselineStore.removeByKeyPrefix", () => {
  it("drops only baseline keys starting with the prefix", async () => {
    const s = new ArtifactShaBaselineStore(dir);
    await s.setBaseline("r1", "r1:ai/skills/foo", "sha1");
    await s.setBaseline("r1", "r1:ai/rules/bar.md", "sha2");
    await s.removeByKeyPrefix("r1:r1:ai/skills/");
    expect(await s.getBaseline("r1", "r1:ai/skills/foo")).toBeNull();
    expect(await s.getBaseline("r1", "r1:ai/rules/bar.md")).toBe("sha2");
  });
});

describe("DismissedNotificationsStore.removeBySubstring", () => {
  it("drops only keys containing the substring", async () => {
    const s = new DismissedNotificationsStore(dir);
    await s.dismiss("newArtifact:r1:r1:ai/skills/foo:sha1");
    await s.dismiss("updatedArtifact:r2:r2:ai/skills/foo:sha2");
    await s.removeBySubstring(":r1:");
    const left = await s.listDismissed();
    expect([...left]).toEqual(["updatedArtifact:r2:r2:ai/skills/foo:sha2"]);
  });
});
