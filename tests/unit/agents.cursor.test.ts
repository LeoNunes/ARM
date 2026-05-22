import { describe, it, expect } from "vitest";
import { cursorAdapter } from "../../src/adapters/agents/cursor.ts";
import os from "node:os";
import path from "node:path";

describe("cursorAdapter", () => {
  it("supports skills at both scopes", () => {
    expect(cursorAdapter.supports("skills", "working-repo")).toBe(true);
    expect(cursorAdapter.supports("skills", "global")).toBe(true);
  });

  it("targetRoot under .cursor/skills/<name>/", () => {
    const root = cursorAdapter.targetRoot({
      scope: "working-repo",
      workingRepoPath: "/r/a",
      type: "skills",
      name: "foo",
    });
    expect(root.replace(/\\/g, "/")).toBe("/r/a/.cursor/skills/foo");
  });

  it("global targetRoot under <home>/.cursor/skills/<name>/", () => {
    const root = cursorAdapter.targetRoot({ scope: "global", type: "skills", name: "foo" });
    expect(root).toBe(path.join(os.homedir(), ".cursor", "skills", "foo"));
  });

  it("mapFileName rewrites CLAUDE.md to AGENTS.md, otherwise identity", () => {
    expect(cursorAdapter.mapFileName("CLAUDE.md")).toBe("AGENTS.md");
    expect(cursorAdapter.mapFileName("SKILL.md")).toBe("SKILL.md");
    expect(cursorAdapter.mapFileName("examples/CLAUDE.md")).toBe("examples/AGENTS.md");
  });
});
