import { rm } from "node:fs/promises";
import path from "node:path";
import { writeExcludeBlock } from './exclude-block';
import { computeExcludePatterns } from './install';
import type { Install, WorkingRepo } from '../state/schema';

export interface UninstallArgs {
  /** Only needs installedFiles + target; accepts both persisted Install records and engine drafts (Omit<Install,"id">). */
  install: Pick<Install, "installedFiles" | "target">;
  workingRepo?: WorkingRepo; // required if install.target.type === "working-repo"
  remainingInstallsInTarget: Array<Pick<Install, "installedFiles">>;
}

export async function uninstallArtifact(args: UninstallArgs): Promise<void> {
  const { install, workingRepo, remainingInstallsInTarget } = args;
  for (const f of install.installedFiles) {
    const abs = workingRepo ? path.join(workingRepo.path, f.targetPath) : f.targetPath;
    await rm(abs, { force: true, recursive: true });
  }
  // Best-effort: clean up the now-empty <name>/ directory (and its parent if empty).
  if (workingRepo) {
    const dirs = new Set(install.installedFiles.map((f) => path.dirname(path.join(workingRepo.path, f.targetPath))));
    for (const d of dirs) {
      await rm(d, { force: true, recursive: true }).catch(() => {});
    }
    const excludePath = path.join(workingRepo.path, ".git", "info", "exclude");
    await writeExcludeBlock(excludePath, computeExcludePatterns(remainingInstallsInTarget));
  }
}
