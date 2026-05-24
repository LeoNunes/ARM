export type AgentId = "claude-code" | "cursor";
export type ArtifactTypeId = "skills"; // expanded in later slices

export type ActivityCategory =
  | "auto-update"
  | "install"
  | "uninstall"
  | "re-apply"
  | "refresh";

export interface ActivityLogEntry {
  id: string;
  ts: string;
  category: ActivityCategory;
  summary: string;
  detail?: string;
  artifactKey?: string;
  workingRepoId?: string;
  sourceRepoId?: string;
}

export interface SettingsFile {
  favoriteAgent: AgentId;
  mcpPort: number;
  autoRefreshEnabled: boolean;
  autoRefreshIntervalMinutes: number;
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
  artifactType: ArtifactTypeId;
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
