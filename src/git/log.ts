import { simpleGit } from "simple-git";

export async function lastSHATouching(
  repoPath: string,
  ref: string,
  paths: string[],
): Promise<string | null> {
  const args = ["log", ref, "-n", "1", "--format=%H", "--"];
  for (const p of paths) args.push(p);
  const out = (await simpleGit(repoPath).raw(args)).trim();
  return out.length ? out : null;
}

export async function hasCommitsTouching(
  repoPath: string,
  fromSha: string,
  toRef: string,
  paths: string[],
): Promise<boolean> {
  const args = ["log", `${fromSha}..${toRef}`, "--format=%H", "-n", "1", "--"];
  for (const p of paths) args.push(p);
  const out = (await simpleGit(repoPath).raw(args)).trim();
  return out.length > 0;
}
