import { describe, it, expect } from "vitest";
import { claudeCodeAdapter } from "../../src/adapters/agents/claude-code.ts";
import os from "node:os";
import path from "node:path";

describe("claudeCodeAdapter", () => {
  it("supports skills at working-repo and global", () => {
    expect(claudeCodeAdapter.supports("skills", "working-repo")).toBe(true);
    expect(claudeCodeAdapter.supports("skills", "global")).toBe(true);
  });

  it("targetRoot resolves working-repo skills under .claude/skills/<name>/", () => {
    const root = claudeCodeAdapter.targetRoot({
      scope: "working-repo",
      workingRepoPath: "/repos/alpha",
      type: "skills",
      name: "foo",
    });
    expect(root.replace(/\\/g, "/")).toBe("/repos/alpha/.claude/skills/foo");
  });

  it("targetRoot resolves global skills under <home>/.claude/skills/<name>/", () => {
    const root = claudeCodeAdapter.targetRoot({
      scope: "global",
      type: "skills",
      name: "foo",
    });
    expect(root).toBe(path.join(os.homedir(), ".claude", "skills", "foo"));
  });

  it("mapFileName is identity", () => {
    expect(claudeCodeAdapter.mapFileName("CLAUDE.md", "skills")).toBe("CLAUDE.md");
    expect(claudeCodeAdapter.mapFileName("anything.txt", "skills")).toBe("anything.txt");
  });

  it("supports rules at both scopes", () => {
    expect(claudeCodeAdapter.supports("rules", "working-repo")).toBe(true);
    expect(claudeCodeAdapter.supports("rules", "global")).toBe(true);
  });

  it("rules targetRoot is the shared rules directory", () => {
    const root = claudeCodeAdapter.targetRoot({
      scope: "working-repo",
      workingRepoPath: "/r/a",
      type: "rules",
      name: "style",
    });
    expect(root.replace(/\\/g, "/")).toBe("/r/a/.claude/rules");
    const globalRoot = claudeCodeAdapter.targetRoot({ scope: "global", type: "rules", name: "style" });
    expect(globalRoot).toBe(path.join(os.homedir(), ".claude", "rules"));
  });

  it("mapFileName renames rule .mdc to .md, otherwise identity", () => {
    expect(claudeCodeAdapter.mapFileName("security.mdc", "rules")).toBe("security.md");
    expect(claudeCodeAdapter.mapFileName("style.md", "rules")).toBe("style.md");
    expect(claudeCodeAdapter.mapFileName("SKILL.md", "skills")).toBe("SKILL.md");
  });
});
