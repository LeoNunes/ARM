import path from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { GitClient } from './client';

export async function cloneIntoCache(args: {
  gitUrl: string;
  branch: string;
  cacheDir: string;
  repoId: string;
}): Promise<string> {
  const dest = path.join(args.cacheDir, args.repoId);
  await mkdir(args.cacheDir, { recursive: true });
  await new GitClient().clone(args.gitUrl, dest, args.branch);
  return dest;
}

export async function removeClone(localClonePath: string): Promise<void> {
  await rm(localClonePath, { recursive: true, force: true });
}
