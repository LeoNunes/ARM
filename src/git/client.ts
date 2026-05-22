import { simpleGit, SimpleGit } from "simple-git";

export class GitClient {
  async clone(url: string, dest: string, branch: string): Promise<void> {
    await simpleGit().clone(url, dest, ["--branch", branch]);
  }
  async fetch(repoPath: string): Promise<void> {
    await simpleGit(repoPath).fetch();
  }
  async headSha(repoPath: string, ref = "HEAD"): Promise<string> {
    return (await simpleGit(repoPath).revparse([ref])).trim();
  }
  git(repoPath: string): SimpleGit {
    return simpleGit(repoPath);
  }
}
