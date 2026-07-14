import { describe, it, expect } from "vitest";
import { artifactRootRelativePath, artifactDisplayName } from "../../src/util/artifact-key.ts";

describe("artifactRootRelativePath", () => {
  it("strips the sourceRepoId prefix", () => {
    expect(artifactRootRelativePath("abc-123:ai/skills/foo")).toBe("ai/skills/foo");
  });
  it("keeps colons that appear after the first one", () => {
    expect(artifactRootRelativePath("abc:ai/rules/a:b.md")).toBe("ai/rules/a:b.md");
  });
});

describe("artifactDisplayName", () => {
  it("returns the last path segment", () => {
    expect(artifactDisplayName("abc-123:ai/skills/foo")).toBe("foo");
  });
  it("returns a rules filename as the display name", () => {
    expect(artifactDisplayName("abc-123:ai/rules/style.md")).toBe("style.md");
  });
  it("falls back to the whole key when there is no path", () => {
    expect(artifactDisplayName("weird-no-colon")).toBe("weird-no-colon");
  });
});
