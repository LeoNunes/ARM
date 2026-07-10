import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
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

  // Save old file contents before any deletions (for rollback)
  const savedOldFiles: Array<{ abs: string; content: string | null }> = [];
  for (const { targetPath } of install.installedFiles) {
    const abs = path.join(workingRepo.path, targetPath);
    let content: string | null = null;
    try { content = await readFile(abs, "utf8"); } catch { /* file already missing */ }
    savedOldFiles.push({ abs, content });
  }

  const newInstalledFiles: InstalledFile[] = [];
  const writtenPaths: string[] = [];

  try {
    // Remove old files
    for (const { abs } of savedOldFiles) {
      await rm(abs, { force: true });
    }

    // List and write new files
    const newSourceFiles = await listFilesAtSha(skillsRepo.localClonePath, newSha, rootRelativePath);
    for (const sourcePath of newSourceFiles) {
      const relativeToArtifact = sourcePath.slice(rootRelativePath.length + 1);
      const mapped = agent.mapFileName(relativeToArtifact, install.artifactType);
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
    // Rollback: remove new files and restore old ones
    for (const p of writtenPaths) await rm(p, { force: true });
    for (const { abs, content } of savedOldFiles) {
      if (content !== null) {
        await mkdir(path.dirname(abs), { recursive: true });
        await writeFile(abs, content, "utf8").catch(() => {});
      }
    }
    throw new AppError("io_error", `apply-update failed: ${(err as Error).message}`);
  }

  return { installedCommitSha: newSha, installedFiles: newInstalledFiles };
}
