import { describe, it, expect } from "vitest";
import { computeExcludePatterns } from "../../src/engine/install.ts";

describe("computeExcludePatterns", () => {
  it("emits the parent directory for skills installs", () => {
    const patterns = computeExcludePatterns([
      {
        artifactType: "skills",
        installedFiles: [
          { sourcePath: "ai/skills/foo/SKILL.md", targetPath: ".claude/skills/foo/SKILL.md" },
          { sourcePath: "ai/skills/foo/extra.md", targetPath: ".claude/skills/foo/extra.md" },
        ],
      },
    ]);
    expect(patterns).toEqual([".claude/skills/foo/"]);
  });

  it("emits the exact file path for rules installs", () => {
    const patterns = computeExcludePatterns([
      {
        artifactType: "rules",
        installedFiles: [{ sourcePath: "ai/rules/style.md", targetPath: ".claude/rules/style.md" }],
      },
    ]);
    expect(patterns).toEqual([".claude/rules/style.md"]);
  });

  it("mixes both, sorted and de-duplicated", () => {
    const patterns = computeExcludePatterns([
      {
        artifactType: "rules",
        installedFiles: [{ sourcePath: "ai/rules/style.md", targetPath: ".cursor/rules/style.mdc" }],
      },
      {
        artifactType: "rules",
        installedFiles: [{ sourcePath: "ai/rules/sec.mdc", targetPath: ".cursor/rules/sec.mdc" }],
      },
      {
        artifactType: "skills",
        installedFiles: [{ sourcePath: "ai/skills/foo/SKILL.md", targetPath: ".cursor/skills/foo/SKILL.md" }],
      },
    ]);
    expect(patterns).toEqual([".cursor/rules/sec.mdc", ".cursor/rules/style.mdc", ".cursor/skills/foo/"]);
  });
});
