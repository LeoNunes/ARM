import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { ArtifactTypeAdapter, DiscoveredArtifact } from '../types';
import { lastSHATouching } from '../../git/log';
import { frontmatterDescription } from './frontmatter';

export const skillsAdapter: ArtifactTypeAdapter = {
  id: "skills",
  displayName: "Skills",
  async discoverAt({ sourceRepoId, sourceRepoPath, configuredPath, ref }) {
    const absRoot = path.join(sourceRepoPath, configuredPath);
    if (!existsSync(absRoot)) return [];
    const entries = await listImmediateDirs(absRoot);
    const out: DiscoveredArtifact[] = [];
    for (const name of entries) {
      const rootRelativePath = `${configuredPath}/${name}`;
      const files = await listFilesRecursive(path.join(sourceRepoPath, rootRelativePath), rootRelativePath);
      const skillMd = path.join(sourceRepoPath, rootRelativePath, "SKILL.md");
      const description = existsSync(skillMd) ? frontmatterDescription(await readFile(skillMd, "utf8")) : null;
      const lastTouchedSha = await lastSHATouching(sourceRepoPath, ref, files);
      out.push({
        artifactKey: `${sourceRepoId}:${rootRelativePath}`,
        sourceRepoId,
        type: "skills",
        name,
        description,
        rootRelativePath,
        files,
        lastTouchedSha,
      });
    }
    return out;
  },
};

async function listImmediateDirs(dir: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const items = await readdir(dir, { withFileTypes: true });
  return items.filter((d) => d.isDirectory()).map((d) => d.name).sort();
}

async function listFilesRecursive(absDir: string, relPrefix: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const out: string[] = [];
  const items = await readdir(absDir, { withFileTypes: true });
  for (const item of items) {
    const abs = path.join(absDir, item.name);
    const rel = `${relPrefix}/${item.name}`;
    if (item.isDirectory()) out.push(...(await listFilesRecursive(abs, rel)));
    else if (item.isFile()) out.push(rel);
  }
  return out;
}

