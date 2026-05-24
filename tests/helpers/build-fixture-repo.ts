import { simpleGit } from "simple-git";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpDir } from "./tmp-dir.ts";

export interface FixtureCommit {
  message: string;
  files: Record<string, string>; // relative path → content
  deletes?: string[];
}

export interface FixtureResult {
  path: string;       // absolute path to the repo
  fileUrl: string;    // file:// URL suitable for cloning
  shas: string[];     // SHAs of each commit in order
}

export async function buildFixtureRepo(commits: FixtureCommit[]): Promise<FixtureResult> {
  const dir = await tmpDir("arm-fixture-");
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig("user.email", "fixture@example.com");
  await git.addConfig("user.name", "Fixture");
  await git.addConfig("commit.gpgsign", "false");
  await git.checkoutLocalBranch("main");
  const shas: string[] = [];
  for (const c of commits) {
    for (const [rel, content] of Object.entries(c.files)) {
      const abs = path.join(dir, rel);
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, content, "utf8");
      await git.add(rel);
    }
    for (const rel of c.deletes ?? []) {
      await git.rm(rel);
    }
    const r = await git.commit(c.message, ["--allow-empty"]);
    shas.push(r.commit);
  }
  return {
    path: dir,
    fileUrl: `file://${dir.replace(/\\/g, "/")}`,
    shas,
  };
}
