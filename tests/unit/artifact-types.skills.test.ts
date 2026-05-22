import { describe, it, expect } from "vitest";
import { buildFixtureRepo } from "../helpers/build-fixture-repo.ts";
import { tmpDir } from "../helpers/tmp-dir.ts";
import { GitClient } from "../../src/git/client.ts";
import { skillsAdapter } from "../../src/adapters/artifact-types/skills.ts";
import path from "node:path";

describe("skillsAdapter.discoverAt", () => {
  it("discovers each immediate subdir under configured path, reads SKILL.md heading", async () => {
    const fx = await buildFixtureRepo([
      {
        message: "init",
        files: {
          "ai/skills/alpha/SKILL.md": "# Alpha\nDoes alpha.\n",
          "ai/skills/alpha/notes.md": "notes\n",
          "ai/skills/beta/SKILL.md": "# Beta\n",
          "ai/skills/README.md": "ignored",
        },
      },
    ]);
    const dest = path.join(await tmpDir(), "clone");
    await new GitClient().clone(fx.fileUrl, dest, "main");
    const out = await skillsAdapter.discoverAt({
      sourceRepoId: "src1",
      sourceRepoPath: dest,
      configuredPath: "ai/skills",
      ref: "main",
    });
    const names = out.map((a) => a.name).sort();
    expect(names).toEqual(["alpha", "beta"]);
    const alpha = out.find((a) => a.name === "alpha")!;
    expect(alpha.description).toBe("Alpha");
    expect(alpha.files.sort()).toEqual(["ai/skills/alpha/SKILL.md", "ai/skills/alpha/notes.md"]);
    expect(alpha.artifactKey).toBe("src1:ai/skills/alpha");
  });

  it("returns empty when configured path does not exist", async () => {
    const fx = await buildFixtureRepo([{ message: "init", files: { "README.md": "x\n" } }]);
    const dest = path.join(await tmpDir(), "clone");
    await new GitClient().clone(fx.fileUrl, dest, "main");
    const out = await skillsAdapter.discoverAt({
      sourceRepoId: "src1",
      sourceRepoPath: dest,
      configuredPath: "ai/skills",
      ref: "main",
    });
    expect(out).toEqual([]);
  });
});
