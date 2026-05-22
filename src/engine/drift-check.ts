import { readFile } from "node:fs/promises";
import path from "node:path";
import { readFileAtSha } from "../git/show.ts";
import type { Install, SkillsRepo } from "../state/schema.ts";

export interface DriftedFile {
  sourcePath: string;
  targetPath: string;
}

export interface DriftCheckResult {
  isDrifted: boolean;
  driftedFiles: DriftedFile[];
}

export async function checkForDrift(
  install: Install,
  skillsRepo: SkillsRepo,
  workingRepoPath: string,
): Promise<DriftCheckResult> {
  const driftedFiles: DriftedFile[] = [];
  for (const { sourcePath, targetPath } of install.installedFiles) {
    const sourceContent = await readFileAtSha(
      skillsRepo.localClonePath,
      install.installedCommitSha,
      sourcePath,
    );
    const targetAbs = path.join(workingRepoPath, targetPath);
    let targetContent: string;
    try {
      targetContent = await readFile(targetAbs, "utf8");
    } catch {
      driftedFiles.push({ sourcePath, targetPath });
      continue;
    }
    if (sourceContent !== targetContent) {
      driftedFiles.push({ sourcePath, targetPath });
    }
  }
  return { isDrifted: driftedFiles.length > 0, driftedFiles };
}
