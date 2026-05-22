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
    expect(claudeCodeAdapter.mapFileName("CLAUDE.md")).toBe("CLAUDE.md");
    expect(claudeCodeAdapter.mapFileName("anything.txt")).toBe("anything.txt");
  });
});
