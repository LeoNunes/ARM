import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { readFileAtSha, listFilesAtSha } from "../git/show";
import { writeExcludeBlock } from "./exclude-block";
import { computeExcludePatterns } from "./install";
import { AppError } from "../util/errors";
import type { AgentAdapter } from "../adapters/types";
import type { Install, InstalledFile, SkillsRepo, WorkingRepo } from "../state/schema";

export async function applyUpdate(args: {
  install: Install;
  skillsRepo: SkillsRepo;
  workingRepo: WorkingRepo;
  newSha: string;
  agent: AgentAdapter;
  otherInstallsInTarget: Array<Pick<Install, "installedFiles">>;
}): Promise<Pick<Install, "installedCommitSha" | "installedFiles">> {
  const { install, skillsRepo, workingRepo, newSha, agent, otherInstallsInTarget } = args;

  const rootRelativePath = install.artifactKey.split(":", 2)[1]!;
  const artifactName = rootRelativePath.split("/").pop()!;
  const targetRoot = agent.targetRoot({
    scope: "working-repo",
    workingRepoPath: workingRepo.path,
    type: install.artifactType,
    name: artifactName,
  });

  // Remove all currently installed files
  for (const { targetPath } of install.installedFiles) {
    await rm(path.join(workingRepo.path, targetPath), { force: true });
  }

  // List source files at the new SHA
  const newSourceFiles = await listFilesAtSha(skillsRepo.localClonePath, newSha, rootRelativePath);

  const newInstalledFiles: InstalledFile[] = [];
  const writtenPaths: string[] = [];
  try {
    for (const sourcePath of newSourceFiles) {
      const relativeToArtifact = sourcePath.slice(rootRelativePath.length + 1);
      const mapped = agent.mapFileName(relativeToArtifact);
      const targetAbs = path.join(targetRoot, mapped);
      const targetRel = path.relative(workingRepo.path, targetAbs).replace(/\\/g, "/");
      const content = await readFileAtSha(skillsRepo.localClonePath, newSha, sourcePath);
      await mkdir(path.dirname(targetAbs), { recursive: true });
      await writeFile(targetAbs, content, "utf8");
      writtenPaths.push(targetAbs);
      newInstalledFiles.push({ sourcePath, targetPath: targetRel });
    }
    const patterns = computeExcludePatterns([
      ...otherInstallsInTarget,
      { installedFiles: newInstalledFiles },
    ]);
    const excludePath = path.join(workingRepo.path, ".git", "info", "exclude");
    await writeExcludeBlock(excludePath, patterns);
  } catch (err) {
    for (const p of writtenPaths) await rm(p, { force: true });
    throw new AppError("io_error", `apply-update failed: ${(err as Error).message}`);
  }

  return { installedCommitSha: newSha, installedFiles: newInstalledFiles };
}
