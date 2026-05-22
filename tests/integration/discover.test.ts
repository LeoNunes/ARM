import { describe, it, expect } from "vitest";
import { buildFixtureRepo } from "../helpers/build-fixture-repo.ts";
import { tmpDir } from "../helpers/tmp-dir.ts";
import { GitClient } from "../../src/git/client.ts";
import { buildRegistries } from "../../src/adapters/index.ts";
import { discoverArtifacts } from "../../src/discovery/discover.ts";
import path from "node:path";
import type { SkillsRepo } from "../../src/state/schema.ts";

describe("discoverArtifacts", () => {
  it("merges discoveries across all configured per-type paths", async () => {
    const fx = await buildFixtureRepo([
      {
        message: "init",
        files: {
          "ai/skills/alpha/SKILL.md": "# Alpha\n",
          "ai/skills/beta/SKILL.md": "# Beta\n",
          "other-skills/gamma/SKILL.md": "# Gamma\n",
        },
      },
    ]);
    const dest = path.join(await tmpDir(), "clone");
    await new GitClient().clone(fx.fileUrl, dest, "main");
    const { types } = buildRegistries();
    const repo: SkillsRepo = {
      id: "src1",
      name: "test",
      gitUrl: fx.fileUrl,
      branch: "main",
      artifactPaths: { skills: ["ai/skills", "other-skills"] },
      presetId: null,
      localClonePath: dest,
      lastFetchedAt: null,
    };
    const result = await discoverArtifacts(repo, types);
    expect(result.map((a) => a.name).sort()).toEqual(["alpha", "beta", "gamma"]);
  });

  it("ignores undeclared artifact type keys", async () => {
    const fx = await buildFixtureRepo([
      { message: "init", files: { "ai/skills/alpha/SKILL.md": "# Alpha\n" } },
    ]);
    const dest = path.join(await tmpDir(), "clone");
    await new GitClient().clone(fx.fileUrl, dest, "main");
    const { types } = buildRegistries();
    const repo: SkillsRepo = {
      id: "src1", name: "t", gitUrl: fx.fileUrl, branch: "main",
      artifactPaths: { skills: ["ai/skills"] },
      presetId: null, localClonePath: dest, lastFetchedAt: null,
    };
    const result = await discoverArtifacts(repo, types);
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe("skills");
  });
});
