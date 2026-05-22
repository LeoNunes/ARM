export type AgentId = "claude-code" | "cursor";
export type ArtifactTypeId = "skills"; // expanded in later slices

export interface SettingsFile {
  favoriteAgent: AgentId;
  mcpPort: number;
}

export interface SkillsRepo {
  id: string;
  name: string;
  gitUrl: string;
  branch: string;
  artifactPaths: Partial<Record<ArtifactTypeId, string[]>>;
  presetId: string | null;
  localClonePath: string;
  lastFetchedAt: string | null;
}

export interface WorkingRepo {
  id: string;
  name: string;
  path: string;
  addedAt: string;
}

export type InstallTarget =
  | { type: "working-repo"; workingRepoId: string }
  | { type: "global" };

export interface InstalledFile {
  sourcePath: string;
  targetPath: string;
}

export interface Install {
  id: string;
  artifactKey: string;       // "<sourceRepoId>:<relativePath>"
  sourceRepoId: string;
  target: InstallTarget;
  agent: AgentId;
  installedCommitSha: string;
  autoUpdate: boolean;
  installedFiles: InstalledFile[];
  installedAt: string;
}

export interface Preset {
  id: string;
  name: string;
  gitUrl: string;
  branch: string;
  artifactPaths: Partial<Record<ArtifactTypeId, string[]>>;
}
