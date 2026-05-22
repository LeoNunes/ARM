import { hasCommitsTouching, lastSHATouching } from "../git/log";
import type { Install, SkillsRepo } from "../state/schema";

export interface UpdateCheckResult {
  hasUpdate: boolean;
  availableSha: string | null;
}

export async function checkForUpdates(
  install: Install,
  skillsRepo: SkillsRepo,
): Promise<UpdateCheckResult> {
  const files = install.installedFiles.map((f) => f.sourcePath);
  if (files.length === 0) return { hasUpdate: false, availableSha: null };
  const hasUpdate = await hasCommitsTouching(
    skillsRepo.localClonePath,
    install.installedCommitSha,
    skillsRepo.branch,
    files,
  );
  if (!hasUpdate) return { hasUpdate: false, availableSha: null };
  const availableSha = await lastSHATouching(skillsRepo.localClonePath, skillsRepo.branch, files);
  return { hasUpdate: true, availableSha };
}
