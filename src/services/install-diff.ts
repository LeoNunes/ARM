import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ServerDeps } from '../server';
import { readFileAtSha, listFilesAtSha } from '../git/show';
import { lastSHATouching } from '../git/log';
import { checkForUpdates } from '../engine/update-check';
import { AppError } from '../util/errors';
import { formatUnifiedDiff, type DiffFilePair } from './unified-diff';

export type InstallDiffMode = "installed-vs-drifted" | "installed-vs-latest";

export interface InstallDiffResult {
  mode: InstallDiffMode;
  fromSha: string;
  toSha: string;
  hasDifferences: boolean;
  diff: string;
}

async function safeReadAtSha(clonePath: string, sha: string, filePath: string): Promise<string | null> {
  try {
    return await readFileAtSha(clonePath, sha, filePath);
  } catch {
    return null;
  }
}

async function safeReadFile(absPath: string): Promise<string | null> {
  try {
    return await readFile(absPath, "utf8");
  } catch {
    return null;
  }
}

/**
 * Renders an install's differences as unified-diff text: either the user's local
 * edits (`installed-vs-drifted`) or what an update would bring in
 * (`installed-vs-latest`).
 */
export async function buildInstallDiff(
  deps: ServerDeps,
  params: { installId: string; mode?: InstallDiffMode },
): Promise<InstallDiffResult> {
  const mode = params.mode ?? "installed-vs-drifted";
  const install = await deps.installs.get(params.installId);
  if (!install) throw new AppError("install_not_found", params.installId);
  const skillsRepo = await deps.skillsRepos.get(install.sourceRepoId);
  if (!skillsRepo) throw new AppError("skills_repo_not_found", install.sourceRepoId);

  if (mode === "installed-vs-drifted") {
    if (install.target.type !== "working-repo") {
      throw new AppError("bad_input", "installed-vs-drifted only supported for working-repo targets");
    }
    const workingRepo = await deps.workingRepos.get(install.target.workingRepoId);
    if (!workingRepo) throw new AppError("working_repo_not_found", install.target.workingRepoId);

    const pairs: DiffFilePair[] = await Promise.all(
      install.installedFiles.map(async (f) => ({
        path: f.targetPath,
        fromContent: await safeReadAtSha(skillsRepo.localClonePath, install.installedCommitSha, f.sourcePath),
        toContent: await safeReadFile(path.join(workingRepo.path, f.targetPath)),
      })),
    );
    const diff = formatUnifiedDiff(pairs, { fromLabel: "installed", toLabel: "working-repo" });
    return {
      mode,
      fromSha: install.installedCommitSha,
      toSha: "working-repo",
      hasDifferences: diff !== "",
      diff,
    };
  }

  const updateResult = await checkForUpdates(install, skillsRepo);
  const installedPaths = install.installedFiles.map((f) => f.sourcePath);
  const latestSha =
    updateResult.availableSha ??
    (await lastSHATouching(skillsRepo.localClonePath, skillsRepo.branch, installedPaths)) ??
    install.installedCommitSha;

  // Union with the latest tree so files added since the install still show up.
  const rootRelativePath = install.artifactKey.split(":", 2)[1]!;
  const latestPaths = await listFilesAtSha(skillsRepo.localClonePath, latestSha, rootRelativePath).catch(() => []);
  const allPaths = [...new Set([...installedPaths, ...latestPaths])];

  const pairs: DiffFilePair[] = await Promise.all(
    allPaths.map(async (p) => ({
      path: p,
      fromContent: await safeReadAtSha(skillsRepo.localClonePath, install.installedCommitSha, p),
      toContent: await safeReadAtSha(skillsRepo.localClonePath, latestSha, p),
    })),
  );
  const diff = formatUnifiedDiff(pairs, {
    fromLabel: `installed (${install.installedCommitSha.slice(0, 7)})`,
    toLabel: `latest (${latestSha.slice(0, 7)})`,
  });
  return {
    mode,
    fromSha: install.installedCommitSha,
    toSha: latestSha,
    hasDifferences: diff !== "",
    diff,
  };
}
