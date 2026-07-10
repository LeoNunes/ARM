import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { readFileAtSha } from '../git/show';
import { writeExcludeBlock } from './exclude-block';
import { AppError } from '../util/errors';
import type { DiscoveredArtifact, AgentAdapter } from '../adapters/types';
import type { Install, InstalledFile, InstallTarget, SkillsRepo, WorkingRepo } from '../state/schema';

export interface InstallArgs {
  artifact: DiscoveredArtifact;
  skillsRepo: SkillsRepo;
  target: InstallTarget;
  workingRepo?: WorkingRepo; // required if target.type === "working-repo"
  agent: AgentAdapter;
  sha: string;
  autoUpdate: boolean;
  /** All installs already in the same working repo (for exclude-block recompute). Empty for global. Only `installedFiles` is read. */
  existingInstallsInTarget: Array<Pick<Install, "installedFiles">>;
}

/** Returns a draft install record (without `id`). The caller persists it via `InstallsStore.add`, which assigns the id. */
export async function installArtifact(args: InstallArgs): Promise<Omit<Install, "id">> {
  const { artifact, skillsRepo, target, workingRepo, agent, sha, autoUpdate, existingInstallsInTarget } = args;
  if (!agent.supports(artifact.type, target.type)) {
    throw new AppError("unsupported_combination", `${agent.id} does not support ${artifact.type} at ${target.type}`);
  }
  if (target.type === "working-repo" && !workingRepo) {
    throw new AppError("bad_input", "workingRepo required for working-repo target");
  }
  const targetRoot = agent.targetRoot({
    scope: target.type,
    workingRepoPath: workingRepo?.path,
    type: artifact.type,
    name: artifact.name,
  });
  const installedFiles: InstalledFile[] = [];
  const writtenAbsPaths: string[] = [];
  try {
    for (const sourcePath of artifact.files) {
      const relativeToArtifact = sourcePath.slice(artifact.rootRelativePath.length + 1);
      const mapped = agent.mapFileName(relativeToArtifact, artifact.type);
      const targetAbs = path.join(targetRoot, mapped);
      const targetRel = workingRepo
        ? path.relative(workingRepo.path, targetAbs).replace(/\\/g, "/")
        : targetAbs;
      const content = await readFileAtSha(skillsRepo.localClonePath, sha, sourcePath);
      await mkdir(path.dirname(targetAbs), { recursive: true });
      await writeFile(targetAbs, content, "utf8");
      writtenAbsPaths.push(targetAbs);
      installedFiles.push({ sourcePath, targetPath: targetRel });
    }
    if (target.type === "working-repo" && workingRepo) {
      const patterns = computeExcludePatterns(
        [...existingInstallsInTarget, { installedFiles }],
      );
      const excludePath = path.join(workingRepo.path, ".git", "info", "exclude");
      await writeExcludeBlock(excludePath, patterns);
    }
  } catch (err) {
    // rollback: delete any files we wrote
    for (const p of writtenAbsPaths) {
      await rm(p, { force: true });
    }
    throw new AppError("io_error", `install failed: ${(err as Error).message}`);
  }
  const record: Omit<Install, "id"> = {
    artifactKey: artifact.artifactKey,
    sourceRepoId: skillsRepo.id,
    target,
    agent: agent.id,
    artifactType: artifact.type,
    installedCommitSha: sha,
    autoUpdate,
    installedFiles,
    installedAt: new Date().toISOString(),
  };
  return record;
}

export function computeExcludePatterns(installs: Array<Pick<Install, "installedFiles">>): string[] {
  const set = new Set<string>();
  for (const inst of installs) {
    for (const f of inst.installedFiles) {
      // Add the parent directory with trailing slash (the skill directory level)
      const dir = f.targetPath.split("/").slice(0, -1).join("/");
      if (dir) set.add(dir + "/");
    }
  }
  return [...set].sort();
}
