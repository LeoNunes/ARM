import { simpleGit, SimpleGit } from "simple-git";

export class GitClient {
  async clone(url: string, dest: string, branch: string): Promise<void> {
    await simpleGit().clone(url, dest, ["--branch", branch]);
  }
  async fetch(repoPath: string): Promise<void> {
    await simpleGit(repoPath).fetch();
  }
  async fetchAndReset(repoPath: string, branch: string): Promise<void> {
    const g = simpleGit(repoPath);
    await g.fetch();
    await g.raw(["reset", "--hard", `origin/${branch}`]);
  }
  async headSha(repoPath: string, ref = "HEAD"): Promise<string> {
    return (await simpleGit(repoPath).revparse([ref])).trim();
  }
  git(repoPath: string): SimpleGit {
    return simpleGit(repoPath);
  }
}
