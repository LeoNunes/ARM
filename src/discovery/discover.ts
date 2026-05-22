import type { SkillsRepo, ArtifactTypeId } from "../state/schema.ts";
import type { ArtifactTypeRegistry } from "../adapters/registry.ts";
import type { DiscoveredArtifact } from "../adapters/types.ts";

export async function discoverArtifacts(
  repo: SkillsRepo,
  types: ArtifactTypeRegistry,
): Promise<DiscoveredArtifact[]> {
  const out: DiscoveredArtifact[] = [];
  for (const t of types.list()) {
    const typeId = t.id as ArtifactTypeId;
    const paths = repo.artifactPaths[typeId] ?? [];
    for (const p of paths) {
      const found = await t.discoverAt({
        sourceRepoId: repo.id,
        sourceRepoPath: repo.localClonePath,
        configuredPath: p,
        ref: repo.branch,
      });
      out.push(...found);
    }
  }
  return out;
}
