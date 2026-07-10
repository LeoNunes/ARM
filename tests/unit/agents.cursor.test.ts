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
    expect(cursorAdapter.mapFileName("CLAUDE.md", "skills")).toBe("AGENTS.md");
    expect(cursorAdapter.mapFileName("SKILL.md", "skills")).toBe("SKILL.md");
    expect(cursorAdapter.mapFileName("examples/CLAUDE.md", "skills")).toBe("examples/AGENTS.md");
  });

  it("supports rules only at working-repo scope", () => {
    expect(cursorAdapter.supports("rules", "working-repo")).toBe(true);
    expect(cursorAdapter.supports("rules", "global")).toBe(false);
  });

  it("rules targetRoot is the shared .cursor/rules directory", () => {
    const root = cursorAdapter.targetRoot({
      scope: "working-repo",
      workingRepoPath: "/r/a",
      type: "rules",
      name: "style",
    });
    expect(root.replace(/\\/g, "/")).toBe("/r/a/.cursor/rules");
  });

  it("mapFileName renames rule .md to .mdc, leaves .mdc alone, and leaves skills extensions alone", () => {
    expect(cursorAdapter.mapFileName("style.md", "rules")).toBe("style.mdc");
    expect(cursorAdapter.mapFileName("security.mdc", "rules")).toBe("security.mdc");
    expect(cursorAdapter.mapFileName("SKILL.md", "skills")).toBe("SKILL.md");
  });
});
