import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FavoritesStore } from "../../src/state/favorites.ts";
import { ArtifactSnapshotsStore } from "../../src/state/artifact-snapshots.ts";
import { ArtifactShaBaselineStore } from "../../src/state/artifact-sha-baseline.ts";
import { DismissedNotificationsStore } from "../../src/state/notifications.ts";
import { purgeRepoState, purgePathState } from "../../src/engine/purge.ts";

let dir: string;
function stores() {
  return {
    favorites: new FavoritesStore(dir),
    snapshots: new ArtifactSnapshotsStore(dir),
    shaBaseline: new ArtifactShaBaselineStore(dir),
    dismissed: new DismissedNotificationsStore(dir),
  };
}
async function seed(s: ReturnType<typeof stores>) {
  await s.favorites.setFavorite("r1:ai/skills/foo", true);
  await s.favorites.setFavorite("r1:ai/rules/bar.md", true);
  await s.favorites.setFavorite("r2:ai/skills/keep", true);
  await s.snapshots.initSnapshot("r1", ["r1:ai/skills/foo", "r1:ai/rules/bar.md"]);
  await s.snapshots.initSnapshot("r2", ["r2:ai/skills/keep"]);
  await s.shaBaseline.setBaseline("r1", "r1:ai/skills/foo", "sha1");
  await s.shaBaseline.setBaseline("r1", "r1:ai/rules/bar.md", "sha2");
  await s.dismissed.dismiss("newArtifact:r1:r1:ai/skills/foo:sha1");
  await s.dismissed.dismiss("updatedArtifact:r2:r2:ai/skills/keep:sha9");
}

beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), "purge-orch-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("purgeRepoState", () => {
  it("removes all state for the repo and leaves other repos intact", async () => {
    const s = stores();
    await seed(s);
    await purgeRepoState(s, "r1");
    expect([...(await s.favorites.listFavorites())]).toEqual(["r2:ai/skills/keep"]);
    expect((await s.snapshots.getSnapshot("r1")).size).toBe(0);
    expect((await s.snapshots.getSnapshot("r2")).size).toBe(1);
    expect(await s.shaBaseline.getBaseline("r1", "r1:ai/skills/foo")).toBeNull();
    expect([...(await s.dismissed.listDismissed())]).toEqual(["updatedArtifact:r2:r2:ai/skills/keep:sha9"]);
  });
});

describe("purgePathState", () => {
  it("removes only state under the given path", async () => {
    const s = stores();
    await seed(s);
    await purgePathState(s, "r1", "ai/skills");
    const favs = [...(await s.favorites.listFavorites())].sort();
    expect(favs).toEqual(["r1:ai/rules/bar.md", "r2:ai/skills/keep"]);
    expect([...(await s.snapshots.getSnapshot("r1"))]).toEqual(["r1:ai/rules/bar.md"]);
    expect(await s.shaBaseline.getBaseline("r1", "r1:ai/skills/foo")).toBeNull();
    expect(await s.shaBaseline.getBaseline("r1", "r1:ai/rules/bar.md")).toBe("sha2");
    expect(await s.dismissed.isDismissed("newArtifact:r1:r1:ai/skills/foo:sha1")).toBe(false);
  });
});
