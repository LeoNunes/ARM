import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const created: string[] = [];

export async function tmpDir(prefix = "arm-test-"): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

export async function cleanupTmpDirs(): Promise<void> {
  for (const d of created.splice(0)) {
    await rm(d, { recursive: true, force: true });
  }
}
