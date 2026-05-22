import { describe, it, expect } from "vitest";
import { buildFixtureRepo } from "../helpers/build-fixture-repo.ts";
import { tmpDir } from "../helpers/tmp-dir.ts";
import { GitClient } from "../../src/git/client.ts";
import { buildRegistries } from "../../src/adapters/index.ts";
import { discoverArtifacts } from "../../src/discovery/discover.ts";
import { installArtifact } from "../../src/engine/install.ts";
import { checkForUpdates } from "../../src/engine/update-check.ts";
import { checkForDrift } from "../../src/engine/drift-check.ts";
import { simpleGit } from "simple-git";
import path from "node:path";
import { writeFile } from "node:fs/promises";
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

describe("checkForDrift", () => {
  it("returns isDrifted=false when installed files match the source at installedCommitSha", async () => {
    const fx = await buildFixtureRepo([
      { message: "v1", files: { "ai/skills/foo/SKILL.md": "# Foo\nv1\n" } },
    ]);
    const dest = path.join(await tmpDir(), "clone");
    await new GitClient().clone(fx.fileUrl, dest, "main");
    const wr = await makeWorkingRepo();
    const install = await makeInstall(fx, dest, wr, fx.shas[0]!);
    const sr: SkillsRepo = {
      id: "src1", name: "src", gitUrl: fx.fileUrl, branch: "main",
      artifactPaths: { skills: ["ai/skills"] }, presetId: null,
      localClonePath: dest, lastFetchedAt: null,
    };
    const result = await checkForDrift(install, sr, wr.path);
    expect(result.isDrifted).toBe(false);
    expect(result.driftedFiles).toHaveLength(0);
  });

  it("returns isDrifted=true with drifted file listed when working-repo file is modified", async () => {
    const fx = await buildFixtureRepo([
      { message: "v1", files: { "ai/skills/foo/SKILL.md": "# Foo\nv1\n" } },
    ]);
    const dest = path.join(await tmpDir(), "clone");
    await new GitClient().clone(fx.fileUrl, dest, "main");
    const wr = await makeWorkingRepo();
    const install = await makeInstall(fx, dest, wr, fx.shas[0]!);
    // Mutate the installed file
    const targetAbs = path.join(wr.path, ".claude/skills/foo/SKILL.md");
    await writeFile(targetAbs, "# Foo\nmodified!\n", "utf8");
    const sr: SkillsRepo = {
      id: "src1", name: "src", gitUrl: fx.fileUrl, branch: "main",
      artifactPaths: { skills: ["ai/skills"] }, presetId: null,
      localClonePath: dest, lastFetchedAt: null,
    };
    const result = await checkForDrift(install, sr, wr.path);
    expect(result.isDrifted).toBe(true);
    expect(result.driftedFiles).toHaveLength(1);
    expect(result.driftedFiles[0]!.sourcePath).toBe("ai/skills/foo/SKILL.md");
  });

  it("returns isDrifted=true when an installed file is deleted from the working repo", async () => {
    const fx = await buildFixtureRepo([
      { message: "v1", files: { "ai/skills/foo/SKILL.md": "# Foo\nv1\n" } },
    ]);
    const dest = path.join(await tmpDir(), "clone");
    await new GitClient().clone(fx.fileUrl, dest, "main");
    const wr = await makeWorkingRepo();
    const install = await makeInstall(fx, dest, wr, fx.shas[0]!);
    const { rm } = await import("node:fs/promises");
    await rm(path.join(wr.path, ".claude/skills/foo/SKILL.md"), { force: true });
    const sr: SkillsRepo = {
      id: "src1", name: "src", gitUrl: fx.fileUrl, branch: "main",
      artifactPaths: { skills: ["ai/skills"] }, presetId: null,
      localClonePath: dest, lastFetchedAt: null,
    };
    const result = await checkForDrift(install, sr, wr.path);
    expect(result.isDrifted).toBe(true);
  });
});
