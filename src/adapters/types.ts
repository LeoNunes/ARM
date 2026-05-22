import type { AgentId, ArtifactTypeId } from "../state/schema.ts";

export type Scope = "working-repo" | "global";

export interface DiscoveredArtifact {
  artifactKey: string;          // "<sourceRepoId>:<relativePath>"
  sourceRepoId: string;
  type: ArtifactTypeId;
  name: string;                 // display name
  description: string | null;
  rootRelativePath: string;     // path within the source repo
  files: string[];              // paths within the source repo (relative)
  lastTouchedSha: string | null;
}

export interface AgentAdapter {
  id: AgentId;
  displayName: string;
  supports(type: ArtifactTypeId, scope: Scope): boolean;
  targetRoot(args: { scope: Scope; workingRepoPath?: string; type: ArtifactTypeId; name: string }): string;
  mapFileName(fileName: string): string;
}

export interface ArtifactTypeAdapter {
  id: ArtifactTypeId;
  displayName: string;
  /**
   * For one configured path inside a source repo (relative), produce DiscoveredArtifact entries.
   */
  discoverAt(args: {
    sourceRepoId: string;
    sourceRepoPath: string;
    configuredPath: string;
    ref: string;
  }): Promise<DiscoveredArtifact[]>;
}
