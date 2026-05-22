import { describe, it, expect } from "vitest";
import { buildFixtureRepo } from "../helpers/build-fixture-repo.ts";
import { tmpDir } from "../helpers/tmp-dir.ts";
import { GitClient } from "../../src/git/client.ts";
import { buildRegistries } from "../../src/adapters/index.ts";
import { discoverArtifacts } from "../../src/discovery/discover.ts";
import { installArtifact } from "../../src/engine/install.ts";
import { checkForUpdates } from "../../src/engine/update-check.ts";
import { simpleGit } from "simple-git";
import path from "node:path";
import type { SkillsRepo, WorkingRepo, Install } from "../../src/state/schema.ts";

async function makeWorkingRepo(): Promise<WorkingRepo> {
  const dir = await tmpDir("skillmgr-wr-");
  const sg = simpleGit(dir);
  await sg.init();
  await sg.addConfig("user.email", "a@b");
  await sg.addConfig("user.name", "t");
  await sg.addConfig("commit.gpgsign", "false");
  await sg.commit("seed", [], { "--allow-empty": null });
  return { id: "w1", name: "alpha", path: dir, addedAt: new Date().toISOString() };
}

async function makeInstall(
  fx: Awaited<ReturnType<typeof buildFixtureRepo>>,
  cloneDest: string,
  workingRepo: WorkingRepo,
  sha: string,
  autoUpdate = false,
): Promise<Install> {
  const { agents, types } = buildRegistries();
  const skillsRepo: SkillsRepo = {
    id: "src1", name: "src", gitUrl: fx.fileUrl, branch: "main",
    artifactPaths: { skills: ["ai/skills"] },
    presetId: null, localClonePath: cloneDest, lastFetchedAt: null,
  };
  const artifacts = await discoverArtifacts(skillsRepo, types);
  const foo = artifacts.find((a) => a.name === "foo")!;
  const draft = await installArtifact({
    artifact: foo, skillsRepo,
    target: { type: "working-repo", workingRepoId: workingRepo.id }, workingRepo,
    agent: agents.get("claude-code"), sha,
    autoUpdate,
    existingInstallsInTarget: [],
  });
  return { id: "i1", ...draft };
}

describe("checkForUpdates", () => {
  it("returns hasUpdate=false when no new commits touch the artifact", async () => {
    const fx = await buildFixtureRepo([
      { message: "v1", files: { "ai/skills/foo/SKILL.md": "# Foo\nv1\n" } },
      { message: "unrelated", files: { "other.md": "x\n" } },
    ]);
    const dest = path.join(await tmpDir(), "clone");
    await new GitClient().clone(fx.fileUrl, dest, "main");
    const wr = await makeWorkingRepo();
    const install = await makeInstall(fx, dest, wr, fx.shas[0]!);
    const sr: SkillsRepo = {
      id: "src1", name: "src", gitUrl: fx.fileUrl, branch: "main",
      artifactPaths: { skills: ["ai/skills"] },
      presetId: null, localClonePath: dest, lastFetchedAt: null,
    };
    const result = await checkForUpdates(install, sr);
    expect(result.hasUpdate).toBe(false);
    expect(result.availableSha).toBeNull();
  });

  it("returns hasUpdate=true with new SHA when upstream commits touch the artifact", async () => {
    const fx = await buildFixtureRepo([
      { message: "v1", files: { "ai/skills/foo/SKILL.md": "# Foo\nv1\n" } },
      { message: "v2", files: { "ai/skills/foo/SKILL.md": "# Foo\nv2\n" } },
    ]);
    const dest = path.join(await tmpDir(), "clone");
    await new GitClient().clone(fx.fileUrl, dest, "main");
    const wr = await makeWorkingRepo();
    const install = await makeInstall(fx, dest, wr, fx.shas[0]!);
    const sr: SkillsRepo = {
      id: "src1", name: "src", gitUrl: fx.fileUrl, branch: "main",
      artifactPaths: { skills: ["ai/skills"] },
      presetId: null, localClonePath: dest, lastFetchedAt: null,
    };
    const result = await checkForUpdates(install, sr);
    expect(result.hasUpdate).toBe(true);
    expect(result.availableSha).toBe(fx.shas[1]);
  });

  it("returns hasUpdate=false when installedCommitSha is already the latest that touched the artifact", async () => {
    const fx = await buildFixtureRepo([
      { message: "v1", files: { "ai/skills/foo/SKILL.md": "# Foo\nv1\n" } },
    ]);
    const dest = path.join(await tmpDir(), "clone");
    await new GitClient().clone(fx.fileUrl, dest, "main");
    const wr = await makeWorkingRepo();
    // Install at HEAD (shas[0] is already HEAD)
    const install = await makeInstall(fx, dest, wr, fx.shas[0]!);
    const sr: SkillsRepo = {
      id: "src1", name: "src", gitUrl: fx.fileUrl, branch: "main",
      artifactPaths: { skills: ["ai/skills"] },
      presetId: null, localClonePath: dest, lastFetchedAt: null,
    };
    const result = await checkForUpdates(install, sr);
    expect(result.hasUpdate).toBe(false);
    expect(result.availableSha).toBeNull();
  });
});
