import { describe, it, expect } from "vitest";
import { sortByFavorite } from "../../src/discovery/sort.ts";

interface Item { artifactKey: string; name: string; }

describe("sortByFavorite", () => {
  it("puts favorited artifacts before non-favorited ones", () => {
    const items: Item[] = [
      { artifactKey: "r1:a", name: "alpha" },
      { artifactKey: "r1:b", name: "bravo" },
      { artifactKey: "r1:c", name: "charlie" },
    ];
    const favorites = new Set(["r1:c"]);
    const sorted = sortByFavorite(items, favorites);
    expect(sorted.map((i) => i.artifactKey)).toEqual(["r1:c", "r1:a", "r1:b"]);
  });

  it("sorts alphabetically by name within the favorited group", () => {
    const items: Item[] = [
      { artifactKey: "r1:z", name: "zulu" },
      { artifactKey: "r1:a", name: "alpha" },
    ];
    const favorites = new Set(["r1:z", "r1:a"]);
    const sorted = sortByFavorite(items, favorites);
    expect(sorted.map((i) => i.name)).toEqual(["alpha", "zulu"]);
  });

  it("sorts alphabetically by name within the non-favorited group", () => {
    const items: Item[] = [
      { artifactKey: "r1:z", name: "zulu" },
      { artifactKey: "r1:a", name: "alpha" },
    ];
    const sorted = sortByFavorite(items, new Set());
    expect(sorted.map((i) => i.name)).toEqual(["alpha", "zulu"]);
  });

  it("sorts alphabetically when the favorites set is empty", () => {
    const items: Item[] = [
      { artifactKey: "r1:b", name: "bravo" },
      { artifactKey: "r1:a", name: "alpha" },
    ];
    const sorted = sortByFavorite(items, new Set());
    expect(sorted.map((i) => i.name)).toEqual(["alpha", "bravo"]);
  });

  it("ignores a favorite key that doesn't match any artifact (orphaned entry)", () => {
    const items: Item[] = [{ artifactKey: "r1:a", name: "alpha" }];
    const favorites = new Set(["r1:gone"]);
    const sorted = sortByFavorite(items, favorites);
    expect(sorted.map((i) => i.artifactKey)).toEqual(["r1:a"]);
  });

  it("does not mutate the input array", () => {
    const items: Item[] = [
      { artifactKey: "r1:b", name: "bravo" },
      { artifactKey: "r1:a", name: "alpha" },
    ];
    const original = [...items];
    sortByFavorite(items, new Set(["r1:b"]));
    expect(items).toEqual(original);
  });
});
