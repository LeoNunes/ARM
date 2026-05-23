export interface SkillsRepo {
  id: string; name: string; gitUrl: string; branch: string;
  artifactPaths: { skills?: string[] };
  presetId: string | null; localClonePath: string; lastFetchedAt: string | null;
}
export interface WorkingRepo { id: string; name: string; path: string; addedAt: string; }
export interface Settings { favoriteAgent: "claude-code" | "cursor"; mcpPort: number; }
export interface Artifact {
  artifactKey: string; sourceRepoId: string; type: "skills";
  name: string; description: string | null;
  rootRelativePath: string; files: string[]; lastTouchedSha: string | null;
}
export interface Install {
  id: string; artifactKey: string; sourceRepoId: string;
  target: { type: "working-repo"; workingRepoId: string } | { type: "global" };
  agent: "claude-code" | "cursor";
  artifactType: "skills";
  installedCommitSha: string; autoUpdate: boolean;
  installedFiles: { sourcePath: string; targetPath: string }[];
  installedAt: string;
}
export type InstallStatus =
  | "up-to-date"
  | "update-available"
  | "drifted"
  | "update-available+drifted";

export interface InstallWithStatus extends Install {
  status: InstallStatus;
  availableSha: string | null;
}

async function req<T>(method: string, url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });
  if (!res.ok) {
    let err: { code?: string; message?: string } = {};
    try { err = await res.json(); } catch { /* ignore */ }
    throw Object.assign(new Error(err.message ?? `HTTP ${res.status}`), { code: err.code, status: res.status });
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  getSettings: () => req<Settings>("GET", "/api/settings"),
  updateSettings: (patch: Partial<Settings>) => req<Settings>("PATCH", "/api/settings", patch),

  listSkillsRepos: () => req<SkillsRepo[]>("GET", "/api/skills-repos"),
  getSkillsRepo: (id: string) => req<SkillsRepo>("GET", `/api/skills-repos/${id}`),
  registerSkillsRepo: (body: { name: string; gitUrl: string; branch?: string; artifactPaths?: { skills?: string[] } }) =>
    req<SkillsRepo>("POST", "/api/skills-repos", body),
  deleteSkillsRepo: (id: string) => req<void>("DELETE", `/api/skills-repos/${id}`),
  refreshSkillsRepo: (id: string) => req<SkillsRepo>("POST", `/api/skills-repos/${id}/refresh`),

  listWorkingRepos: () => req<WorkingRepo[]>("GET", "/api/working-repos"),
  registerWorkingRepo: (body: { name: string; path: string }) => req<WorkingRepo>("POST", "/api/working-repos", body),
  deleteWorkingRepo: (id: string) => req<void>("DELETE", `/api/working-repos/${id}`),
  refreshWorkingRepo: (id: string) => req<InstallWithStatus[]>("POST", `/api/working-repos/${id}/refresh`),

  listArtifacts: (q?: { q?: string; type?: string; sourceRepoId?: string }, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    if (q?.q) params.set("q", q.q);
    if (q?.type) params.set("type", q.type);
    if (q?.sourceRepoId) params.set("sourceRepoId", q.sourceRepoId);
    const qs = params.toString();
    return req<Artifact[]>("GET", `/api/artifacts${qs ? `?${qs}` : ""}`, undefined, signal);
  },

  listInstallsByWorkingRepo: (workingRepoId: string) =>
    req<InstallWithStatus[]>("GET", `/api/working-repos/${workingRepoId}/installs`),
  createInstall: (body: {
    artifactKey: string;
    target: { type: "working-repo"; workingRepoId: string } | { type: "global" };
    agent?: "claude-code" | "cursor";
    autoUpdate?: boolean;
    sha?: string;
  }) => req<Install>("POST", "/api/installs", body),
  updateInstall: (id: string, patch: { autoUpdate: boolean }) =>
    req<Install>("PATCH", `/api/installs/${id}`, patch),
  applyInstallUpdate: (id: string) => req<Install>("POST", `/api/installs/${id}/update`),
  deleteInstall: (id: string) => req<void>("DELETE", `/api/installs/${id}`),
};
