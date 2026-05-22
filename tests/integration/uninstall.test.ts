import { describe, it, expect } from "vitest";
import { buildFixtureRepo } from "../helpers/build-fixture-repo.ts";
import { tmpDir } from "../helpers/tmp-dir.ts";
import { GitClient } from "../../src/git/client.ts";
import { buildRegistries } from "../../src/adapters/index.ts";
import { discoverArtifacts } from "../../src/discovery/discover.ts";
import { installArtifact } from "../../src/engine/install.ts";
import { uninstallArtifact } from "../../src/engine/uninstall.ts";
import { simpleGit } from "simple-git";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { SkillsRepo, WorkingRepo } from "../../src/state/schema.ts";

async function makeWorkingRepo(): Promise<WorkingRepo> {
  const dir = await tmpDir("skillmgr-wr-");
  const g = simpleGit(dir);
  await g.init();
  await g.addConfig("user.email", "a@b");
  await g.addConfig("user.name", "t");
  await g.addConfig("commit.gpgsign", "false");
  await g.commit("seed", [], { "--allow-empty": null });
  return { id: "w1", name: "alpha", path: dir, addedAt: new Date().toISOString() };
}

describe("uninstallArtifact", () => {
  it("removes files and updates the exclude block (leaving block for remaining installs)", async () => {
    const fx = await buildFixtureRepo([
      {
        message: "init",
        files: {
          "ai/skills/foo/SKILL.md": "# F\n",
          "ai/skills/bar/SKILL.md": "# B\n",
        },
      },
    ]);
    const dest = path.join(await tmpDir(), "clone");
    await new GitClient().clone(fx.fileUrl, dest, "main");
    const { agents, types } = buildRegistries();
    const skillsRepo: SkillsRepo = {
      id: "src1", name: "s", gitUrl: fx.fileUrl, branch: "main",
      artifactPaths: { skills: ["ai/skills"] },
      presetId: null, localClonePath: dest, lastFetchedAt: null,
    };
    const arts = await discoverArtifacts(skillsRepo, types);
    const foo = arts.find((a) => a.name === "foo")!;
    const bar = arts.find((a) => a.name === "bar")!;
    const wr = await makeWorkingRepo();

    const recFoo = await installArtifact({
      artifact: foo, skillsRepo, target: { type: "working-repo", workingRepoId: wr.id },
      workingRepo: wr, agent: agents.get("claude-code"), sha: fx.shas[0]!, autoUpdate: false,
      existingInstallsInTarget: [],
    });
    const recBar = await installArtifact({
      artifact: bar, skillsRepo, target: { type: "working-repo", workingRepoId: wr.id },
      workingRepo: wr, agent: agents.get("claude-code"), sha: fx.shas[0]!, autoUpdate: false,
      existingInstallsInTarget: [recFoo],
    });

    await uninstallArtifact({
      install: recFoo,
      workingRepo: wr,
      remainingInstallsInTarget: [recBar],
    });

    expect(existsSync(path.join(wr.path, ".claude/skills/foo/SKILL.md"))).toBe(false);
    expect(existsSync(path.join(wr.path, ".claude/skills/bar/SKILL.md"))).toBe(true);
    const excl = await readFile(path.join(wr.path, ".git/info/exclude"), "utf8");
    expect(excl).not.toContain(".claude/skills/foo/");
    expect(excl).toContain(".claude/skills/bar/");
  });
});
