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

describe("exclude-block coherence across install/uninstall cycles", () => {
  it("install A + install B + uninstall A + install C → block contains only B and C", async () => {
    const fx = await buildFixtureRepo([
      { message: "init", files: {
        "ai/skills/a/SKILL.md": "# A\n",
        "ai/skills/b/SKILL.md": "# B\n",
        "ai/skills/c/SKILL.md": "# C\n",
      } },
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
    const a = arts.find(x => x.name === "a")!;
    const b = arts.find(x => x.name === "b")!;
    const c = arts.find(x => x.name === "c")!;
    const wr = await makeWorkingRepo();
    const cc = agents.get("claude-code");

    const rA = await installArtifact({ artifact: a, skillsRepo, target: { type: "working-repo", workingRepoId: wr.id }, workingRepo: wr, agent: cc, sha: fx.shas[0]!, autoUpdate: false, existingInstallsInTarget: [] });
    const rB = await installArtifact({ artifact: b, skillsRepo, target: { type: "working-repo", workingRepoId: wr.id }, workingRepo: wr, agent: cc, sha: fx.shas[0]!, autoUpdate: false, existingInstallsInTarget: [rA] });
    await uninstallArtifact({ install: rA, workingRepo: wr, remainingInstallsInTarget: [rB] });
    const rC = await installArtifact({ artifact: c, skillsRepo, target: { type: "working-repo", workingRepoId: wr.id }, workingRepo: wr, agent: cc, sha: fx.shas[0]!, autoUpdate: false, existingInstallsInTarget: [rB] });

    const excl = await readFile(path.join(wr.path, ".git/info/exclude"), "utf8");
    expect(excl).not.toContain(".claude/skills/a/");
    expect(excl).toContain(".claude/skills/b/");
    expect(excl).toContain(".claude/skills/c/");
  });
});
