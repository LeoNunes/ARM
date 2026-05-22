import { describe, it, expect } from "vitest";
import { buildFixtureRepo } from "../helpers/build-fixture-repo.ts";
import { tmpDir } from "../helpers/tmp-dir.ts";
import { GitClient } from "../../src/git/client.ts";
import { buildRegistries } from "../../src/adapters/index.ts";
import { discoverArtifacts } from "../../src/discovery/discover.ts";
import { installArtifact } from "../../src/engine/install.ts";
import { simpleGit } from "simple-git";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { SkillsRepo, WorkingRepo } from "../../src/state/schema.ts";

async function makeWorkingRepo(): Promise<WorkingRepo> {
  const dir = await tmpDir("skillmgr-wr-");
  await simpleGit(dir).init();
  await simpleGit(dir).addConfig("user.email", "a@b").addConfig("user.name", "t");
  await simpleGit(dir).commit("seed", [], { "--allow-empty": null });
  return { id: "w1", name: "alpha", path: dir, addedAt: new Date().toISOString() };
}

describe("installArtifact (working-repo, Claude Code)", () => {
  it("writes files to .claude/skills/<name>/ and updates .git/info/exclude", async () => {
    const fx = await buildFixtureRepo([
      {
        message: "init",
        files: {
          "ai/skills/foo/SKILL.md": "# Foo\nbody\n",
          "ai/skills/foo/extra.md": "extra\n",
        },
      },
    ]);
    const cloneDest = path.join(await tmpDir(), "clone");
    await new GitClient().clone(fx.fileUrl, cloneDest, "main");
    const { agents, types } = buildRegistries();
    const skillsRepo: SkillsRepo = {
      id: "src1", name: "src", gitUrl: fx.fileUrl, branch: "main",
      artifactPaths: { skills: ["ai/skills"] },
      presetId: null, localClonePath: cloneDest, lastFetchedAt: null,
    };
    const artifacts = await discoverArtifacts(skillsRepo, types);
    const foo = artifacts.find((a) => a.name === "foo")!;
    const workingRepo = await makeWorkingRepo();

    const result = await installArtifact({
      artifact: foo,
      skillsRepo,
      target: { type: "working-repo", workingRepoId: workingRepo.id },
      workingRepo,
      agent: agents.get("claude-code"),
      sha: fx.shas[0]!,
      autoUpdate: false,
      existingInstallsInTarget: [],
    });

    expect(existsSync(path.join(workingRepo.path, ".claude/skills/foo/SKILL.md"))).toBe(true);
    expect(existsSync(path.join(workingRepo.path, ".claude/skills/foo/extra.md"))).toBe(true);
    expect(await readFile(path.join(workingRepo.path, ".claude/skills/foo/SKILL.md"), "utf8"))
      .toBe("# Foo\nbody\n");
    const excl = await readFile(path.join(workingRepo.path, ".git/info/exclude"), "utf8");
    expect(excl).toContain(".claude/skills/foo/");
    expect(result.installedFiles.length).toBe(2);
    expect(result.installedCommitSha).toBe(fx.shas[0]);
  });

  it("Cursor target applies CLAUDE.md→AGENTS.md", async () => {
    const fx = await buildFixtureRepo([
      { message: "init", files: { "ai/skills/foo/CLAUDE.md": "x\n", "ai/skills/foo/SKILL.md": "# F\n" } },
    ]);
    const cloneDest = path.join(await tmpDir(), "clone");
    await new GitClient().clone(fx.fileUrl, cloneDest, "main");
    const { agents, types } = buildRegistries();
    const skillsRepo: SkillsRepo = {
      id: "src1", name: "s", gitUrl: fx.fileUrl, branch: "main",
      artifactPaths: { skills: ["ai/skills"] },
      presetId: null, localClonePath: cloneDest, lastFetchedAt: null,
    };
    const foo = (await discoverArtifacts(skillsRepo, types)).find((a) => a.name === "foo")!;
    const wr = await makeWorkingRepo();
    await installArtifact({
      artifact: foo, skillsRepo,
      target: { type: "working-repo", workingRepoId: wr.id }, workingRepo: wr,
      agent: agents.get("cursor"), sha: fx.shas[0]!, autoUpdate: false,
      existingInstallsInTarget: [],
    });
    expect(existsSync(path.join(wr.path, ".cursor/skills/foo/AGENTS.md"))).toBe(true);
    expect(existsSync(path.join(wr.path, ".cursor/skills/foo/CLAUDE.md"))).toBe(false);
  });
});
