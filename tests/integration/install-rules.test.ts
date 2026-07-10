import { describe, it, expect } from "vitest";
import { buildFixtureRepo } from "../helpers/build-fixture-repo.ts";
import { tmpDir } from "../helpers/tmp-dir.ts";
import { GitClient } from "../../src/git/client.ts";
import { buildRegistries } from "../../src/adapters/index.ts";
import { discoverArtifacts } from "../../src/discovery/discover.ts";
import { installArtifact } from "../../src/engine/install.ts";
import { uninstallArtifact } from "../../src/engine/uninstall.ts";
import { applyUpdate } from "../../src/engine/apply-update.ts";
import { checkForDrift } from "../../src/engine/drift-check.ts";
import { simpleGit } from "simple-git";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Install, SkillsRepo, WorkingRepo } from "../../src/state/schema.ts";

async function makeWorkingRepo(): Promise<WorkingRepo> {
  const dir = await tmpDir("arm-wr-");
  const sg = simpleGit(dir);
  await sg.init();
  await sg.addConfig("user.email", "a@b");
  await sg.addConfig("user.name", "t");
  await sg.addConfig("commit.gpgsign", "false");
  await sg.commit("seed", [], { "--allow-empty": null });
  return { id: "w1", name: "alpha", path: dir, addedAt: new Date().toISOString() };
}

async function makeRulesFixture() {
  const fx = await buildFixtureRepo([
    {
      message: "init",
      files: {
        "ai/rules/style.md": "---\ndescription: Style.\n---\nUse tabs.\n",
        "ai/rules/security.mdc": "No secrets.\n",
      },
    },
    { message: "update style", files: { "ai/rules/style.md": "---\ndescription: Style.\n---\nUse spaces.\n" } },
  ]);
  const cloneDest = path.join(await tmpDir(), "clone");
  await new GitClient().clone(fx.fileUrl, cloneDest, "main");
  const skillsRepo: SkillsRepo = {
    id: "src1", name: "src", gitUrl: fx.fileUrl, branch: "main",
    artifactPaths: { rules: ["ai/rules"] },
    presetId: null, localClonePath: cloneDest, lastFetchedAt: null,
  };
  return { fx, skillsRepo };
}

describe("rules install (working repo)", () => {
  it("Claude Code: installs into .claude/rules/ and excludes only the exact file", async () => {
    const { fx, skillsRepo } = await makeRulesFixture();
    const { agents, types } = buildRegistries();
    const artifacts = await discoverArtifacts(skillsRepo, types);
    const style = artifacts.find((a) => a.name === "style")!;
    const workingRepo = await makeWorkingRepo();

    const result = await installArtifact({
      artifact: style, skillsRepo,
      target: { type: "working-repo", workingRepoId: workingRepo.id },
      workingRepo, agent: agents.get("claude-code"),
      sha: fx.shas[1]!, autoUpdate: false, existingInstallsInTarget: [],
    });

    const installedPath = path.join(workingRepo.path, ".claude/rules/style.md");
    expect(existsSync(installedPath)).toBe(true);
    expect(await readFile(installedPath, "utf8")).toContain("Use spaces.");
    expect(result.installedFiles).toEqual([
      { sourcePath: "ai/rules/style.md", targetPath: ".claude/rules/style.md" },
    ]);
    const excl = await readFile(path.join(workingRepo.path, ".git/info/exclude"), "utf8");
    expect(excl).toContain(".claude/rules/style.md");
    expect(excl).not.toContain(".claude/rules/\n");
  });

  it("Claude Code: renames .mdc rules to .md", async () => {
    const { fx, skillsRepo } = await makeRulesFixture();
    const { agents, types } = buildRegistries();
    const security = (await discoverArtifacts(skillsRepo, types)).find((a) => a.name === "security")!;
    const workingRepo = await makeWorkingRepo();
    await installArtifact({
      artifact: security, skillsRepo,
      target: { type: "working-repo", workingRepoId: workingRepo.id },
      workingRepo, agent: agents.get("claude-code"),
      sha: fx.shas[1]!, autoUpdate: false, existingInstallsInTarget: [],
    });
    expect(existsSync(path.join(workingRepo.path, ".claude/rules/security.md"))).toBe(true);
    expect(existsSync(path.join(workingRepo.path, ".claude/rules/security.mdc"))).toBe(false);
  });

  it("Cursor: installs into .cursor/rules/ renaming .md to .mdc", async () => {
    const { fx, skillsRepo } = await makeRulesFixture();
    const { agents, types } = buildRegistries();
    const style = (await discoverArtifacts(skillsRepo, types)).find((a) => a.name === "style")!;
    const workingRepo = await makeWorkingRepo();
    const result = await installArtifact({
      artifact: style, skillsRepo,
      target: { type: "working-repo", workingRepoId: workingRepo.id },
      workingRepo, agent: agents.get("cursor"),
      sha: fx.shas[1]!, autoUpdate: false, existingInstallsInTarget: [],
    });
    expect(existsSync(path.join(workingRepo.path, ".cursor/rules/style.mdc"))).toBe(true);
    expect(result.installedFiles[0]!.targetPath).toBe(".cursor/rules/style.mdc");
  });

  it("Cursor: rejects global installs of rules", async () => {
    const { fx, skillsRepo } = await makeRulesFixture();
    const { agents, types } = buildRegistries();
    const style = (await discoverArtifacts(skillsRepo, types)).find((a) => a.name === "style")!;
    await expect(installArtifact({
      artifact: style, skillsRepo,
      target: { type: "global" },
      agent: agents.get("cursor"),
      sha: fx.shas[1]!, autoUpdate: false, existingInstallsInTarget: [],
    })).rejects.toMatchObject({ code: "unsupported_combination" });
  });

  it("uninstalling one rule leaves sibling rules and their exclude entries intact", async () => {
    const { fx, skillsRepo } = await makeRulesFixture();
    const { agents, types } = buildRegistries();
    const artifacts = await discoverArtifacts(skillsRepo, types);
    const style = artifacts.find((a) => a.name === "style")!;
    const security = artifacts.find((a) => a.name === "security")!;
    const workingRepo = await makeWorkingRepo();
    const agent = agents.get("claude-code");

    const styleInstall = await installArtifact({
      artifact: style, skillsRepo,
      target: { type: "working-repo", workingRepoId: workingRepo.id },
      workingRepo, agent, sha: fx.shas[1]!, autoUpdate: false, existingInstallsInTarget: [],
    });
    const securityInstall = await installArtifact({
      artifact: security, skillsRepo,
      target: { type: "working-repo", workingRepoId: workingRepo.id },
      workingRepo, agent, sha: fx.shas[1]!, autoUpdate: false,
      existingInstallsInTarget: [styleInstall],
    });

    await uninstallArtifact({
      install: styleInstall, workingRepo,
      remainingInstallsInTarget: [securityInstall],
    });

    expect(existsSync(path.join(workingRepo.path, ".claude/rules/style.md"))).toBe(false);
    expect(existsSync(path.join(workingRepo.path, ".claude/rules/security.md"))).toBe(true);
    const excl = await readFile(path.join(workingRepo.path, ".git/info/exclude"), "utf8");
    expect(excl).toContain(".claude/rules/security.md");
    expect(excl).not.toContain(".claude/rules/style.md");
  });

  it("detects drift when the installed rule file is edited locally", async () => {
    const { fx, skillsRepo } = await makeRulesFixture();
    const { agents, types } = buildRegistries();
    const style = (await discoverArtifacts(skillsRepo, types)).find((a) => a.name === "style")!;
    const workingRepo = await makeWorkingRepo();
    const draft = await installArtifact({
      artifact: style, skillsRepo,
      target: { type: "working-repo", workingRepoId: workingRepo.id },
      workingRepo, agent: agents.get("claude-code"),
      sha: fx.shas[1]!, autoUpdate: false, existingInstallsInTarget: [],
    });
    const install: Install = { id: "i1", ...draft };

    const clean = await checkForDrift(install, skillsRepo, workingRepo.path);
    expect(clean.isDrifted).toBe(false);

    await writeFile(path.join(workingRepo.path, ".claude/rules/style.md"), "edited locally\n", "utf8");
    const drifted = await checkForDrift(install, skillsRepo, workingRepo.path);
    expect(drifted.isDrifted).toBe(true);
    expect(drifted.driftedFiles).toEqual([
      { sourcePath: "ai/rules/style.md", targetPath: ".claude/rules/style.md" },
    ]);
  });

  it("applyUpdate moves a rule install to a new SHA", async () => {
    const { fx, skillsRepo } = await makeRulesFixture();
    const { agents, types } = buildRegistries();
    const style = (await discoverArtifacts(skillsRepo, types)).find((a) => a.name === "style")!;
    const workingRepo = await makeWorkingRepo();
    const agent = agents.get("claude-code");
    const draft = await installArtifact({
      artifact: style, skillsRepo,
      target: { type: "working-repo", workingRepoId: workingRepo.id },
      workingRepo, agent, sha: fx.shas[0]!, autoUpdate: true, existingInstallsInTarget: [],
    });
    const install: Install = { id: "i1", ...draft };

    const updated = await applyUpdate({
      install, skillsRepo, workingRepo, newSha: fx.shas[1]!, agent, otherInstallsInTarget: [],
    });

    expect(updated.installedCommitSha).toBe(fx.shas[1]);
    const content = await readFile(path.join(workingRepo.path, ".claude/rules/style.md"), "utf8");
    expect(content).toContain("Use spaces.");
  });
});
