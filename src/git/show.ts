import { simpleGit } from "simple-git";

export async function readFileAtSha(repoPath: string, sha: string, filePath: string): Promise<string> {
  return await simpleGit(repoPath).raw(["show", `${sha}:${filePath}`]);
}

export async function listFilesAtSha(repoPath: string, sha: string, prefix: string): Promise<string[]> {
  const out = await simpleGit(repoPath).raw(["ls-tree", "-r", "--name-only", sha, "--", prefix]);
  return out.split(/\r?\n/).filter(Boolean);
}
