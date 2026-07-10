import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { ArtifactTypeAdapter, DiscoveredArtifact } from '../types';
import { lastSHATouching } from '../../git/log';
import { frontmatterDescription } from './frontmatter';

const RULE_EXTENSIONS = new Set([".md", ".mdc"]);

export const rulesAdapter: ArtifactTypeAdapter = {
  id: "rules",
  displayName: "Rules",
  async discoverAt({ sourceRepoId, sourceRepoPath, configuredPath, ref }) {
    const absRoot = path.join(sourceRepoPath, configuredPath);
    if (!existsSync(absRoot)) return [];
    const items = await readdir(absRoot, { withFileTypes: true });
    const files = items
      .filter((i) => i.isFile())
      .map((i) => i.name)
      .filter((n) => RULE_EXTENSIONS.has(path.extname(n)) && n.toLowerCase() !== "readme.md")
      .sort();
    const out: DiscoveredArtifact[] = [];
    for (const fileName of files) {
      const rootRelativePath = `${configuredPath}/${fileName}`;
      const description = frontmatterDescription(await readFile(path.join(absRoot, fileName), "utf8"));
      const lastTouchedSha = await lastSHATouching(sourceRepoPath, ref, [rootRelativePath]);
      out.push({
        artifactKey: `${sourceRepoId}:${rootRelativePath}`,
        sourceRepoId,
        type: "rules",
        name: fileName.slice(0, -path.extname(fileName).length),
        description,
        rootRelativePath,
        files: [rootRelativePath],
        lastTouchedSha,
      });
    }
    return out;
  },
};
