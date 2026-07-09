import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FavoritesStore } from "../../src/state/favorites.ts";

describe("FavoritesStore", () => {
  let dir: string;
  let store: FavoritesStore;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "favorites-test-"));
    store = new FavoritesStore(dir);
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("isFavorite returns false for unknown artifact", async () => {
    expect(await store.isFavorite("r1:skills/foo")).toBe(false);
  });

  it("setFavorite(true) marks an artifact favorited", async () => {
    await store.setFavorite("r1:skills/foo", true);
    expect(await store.isFavorite("r1:skills/foo")).toBe(true);
  });

  it("setFavorite(false) unmarks a favorited artifact", async () => {
    await store.setFavorite("r1:skills/foo", true);
    await store.setFavorite("r1:skills/foo", false);
    expect(await store.isFavorite("r1:skills/foo")).toBe(false);
  });

  it("setFavorite(true) is idempotent", async () => {
    await store.setFavorite("r1:skills/foo", true);
    await store.setFavorite("r1:skills/foo", true);
    const set = await store.listFavorites();
    expect(set.size).toBe(1);
  });

  it("setFavorite(false) on a never-favorited key is a no-op", async () => {
    await store.setFavorite("r1:skills/foo", false);
    expect(await store.isFavorite("r1:skills/foo")).toBe(false);
    expect((await store.listFavorites()).size).toBe(0);
  });

  it("listFavorites returns all favorited keys", async () => {
    await store.setFavorite("r1:skills/foo", true);
    await store.setFavorite("r1:skills/bar", true);
    const set = await store.listFavorites();
    expect(set.has("r1:skills/foo")).toBe(true);
    expect(set.has("r1:skills/bar")).toBe(true);
    expect(set.size).toBe(2);
  });

  it("persists across store instances backed by the same directory", async () => {
    await store.setFavorite("r1:skills/foo", true);
    const reopened = new FavoritesStore(dir);
    expect(await reopened.isFavorite("r1:skills/foo")).toBe(true);
  });
});
