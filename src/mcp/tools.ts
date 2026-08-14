import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ServerDeps } from "../server.js";
import { discoverArtifacts } from "../discovery/discover.js";
import { sortByFavorite } from "../discovery/sort.js";
import { readFileAtSha } from "../git/show.js";
import { recentShasTouching } from "../git/log.js";
import { GitClient } from "../git/client.js";
import type { DiscoveredArtifact } from "../adapters/types.js";
import { checkForUpdates } from "../engine/update-check.js";
import { checkForDrift } from "../engine/drift-check.js";
import { computeInstallStatus } from "../engine/status.js";
import { installArtifact } from "../engine/install.js";
import { AppError } from "../util/errors.js";
import type { AgentId, InstallTarget } from "../state/schema.js";
import { buildInstallDiff } from "../services/install-diff.js";
import { createInstall, updateInstall, reapplyInstall, removeInstall } from "../services/install-ops.js";

function toolError(code: string, message: string, details?: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(details === undefined ? { code, message } : { code, message, details }),
      },
    ],
    isError: true as const,
  };
}

/** Every lifecycle tool reports AppErrors the same way, carrying `details` when present. */
function appErrorToToolError(err: unknown) {
  if (err instanceof AppError) return toolError(err.code, err.message, err.details);
  throw err;
}

async function discoverAll(deps: ServerDeps): Promise<DiscoveredArtifact[]> {
  const sources = await deps.skillsRepos.list();
  const out: DiscoveredArtifact[] = [];
  for (const s of sources) out.push(...(await discoverArtifacts(s, deps.registries.types)));
  return out;
}

export function createMcpServer(deps: ServerDeps): McpServer {
  const server = new McpServer({ name: "ai-resources-manager", version: "0.1.0" });

  server.tool(
    "list_skills_repositories",
    "List all registered skills repositories",
    {},
    async () => {
      const repos = await deps.skillsRepos.list();
      return { content: [{ type: "text" as const, text: JSON.stringify(repos) }] };
    },
  );

  server.tool(
    "list_working_repositories",
    "List all registered working repositories",
    {},
    async () => {
      const repos = await deps.workingRepos.list();
      return { content: [{ type: "text" as const, text: JSON.stringify(repos) }] };
    },
  );

  server.tool(
    "search_artifacts",
    "Search artifacts across registered sources; optional q, type, sourceRepoId filters",
    {
      q: z.string().optional().describe("Case-insensitive search in name and description"),
      type: z.string().optional().describe("Filter by artifact type: skills or rules"),
      sourceRepoId: z.string().optional().describe("Filter by source repository id"),
    },
    async ({ q, type, sourceRepoId }) => {
      const all = await discoverAll(deps);
      const filtered = all.filter((a) => {
        if (sourceRepoId && a.sourceRepoId !== sourceRepoId) return false;
        if (type && a.type !== type) return false;
        if (q) {
          const needle = q.toLowerCase();
          if (
            !a.name.toLowerCase().includes(needle) &&
            !(a.description ?? "").toLowerCase().includes(needle)
          ) {
            return false;
          }
        }
        return true;
      });
      const favorites = await deps.favorites.listFavorites();
      const sorted = sortByFavorite(filtered, favorites);
      const withFavorites = sorted.map((a) => ({ ...a, isFavorite: favorites.has(a.artifactKey) }));
      return { content: [{ type: "text" as const, text: JSON.stringify(withFavorites) }] };
    },
  );

  server.tool(
    "get_artifact",
    "Get artifact metadata, file list, and version history (no file contents)",
    { artifactKey: z.string() },
    async ({ artifactKey }) => {
      const all = await discoverAll(deps);
      const artifact = all.find((a) => a.artifactKey === artifactKey);
      if (!artifact) return toolError("artifact_not_found", `artifact not found: ${artifactKey}`);
      const repo = await deps.skillsRepos.get(artifact.sourceRepoId);
      if (!repo) return toolError("artifact_not_found", `source repo not found: ${artifact.sourceRepoId}`);
      let versionHistory: Awaited<ReturnType<typeof recentShasTouching>> = [];
      try {
        versionHistory = await recentShasTouching(repo.localClonePath, repo.branch, artifact.files);
      } catch {
        // leave versionHistory empty if the clone is temporarily unreachable
      }
      const isFavorite = await deps.favorites.isFavorite(artifact.artifactKey);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ ...artifact, versionHistory, isFavorite }) }],
      };
    },
  );

  server.tool(
    "read_artifact_file",
    "Read the content of one file within an artifact at a specific SHA",
    {
      artifactKey: z.string(),
      filePath: z.string().describe("Path as it appears in artifact.files"),
      sha: z.string().optional().describe("SHA to read at; defaults to lastTouchedSha"),
    },
    async ({ artifactKey, filePath, sha }) => {
      const all = await discoverAll(deps);
      const artifact = all.find((a) => a.artifactKey === artifactKey);
      if (!artifact) return toolError("artifact_not_found", `artifact not found: ${artifactKey}`);
      if (!artifact.files.includes(filePath)) {
        return toolError("bad_input", `file not in artifact: ${filePath}`);
      }
      const repo = await deps.skillsRepos.get(artifact.sourceRepoId);
      if (!repo) return toolError("artifact_not_found", `source repo not found`);
      const resolvedSha =
        sha ?? artifact.lastTouchedSha ?? (await new GitClient().headSha(repo.localClonePath, repo.branch));
      let content: string;
      try {
        content = await readFileAtSha(repo.localClonePath, resolvedSha, filePath);
      } catch (err) {
        return toolError("bad_input", `could not read file at ${resolvedSha}: ${(err as Error).message}`);
      }
      return { content: [{ type: "text" as const, text: content }] };
    },
  );

  server.tool(
    "list_installs",
    "List current installs with status; optional filters: workingRepoId, agent, type",
    {
      workingRepoId: z.string().optional(),
      agent: z.string().optional(),
      type: z.string().optional().describe("Filter by artifact type: skills or rules"),
    },
    async ({ workingRepoId, agent, type }) => {
      const allInstalls = await deps.installs.list();
      const filtered = allInstalls.filter((i) => {
        if (
          workingRepoId &&
          (i.target.type !== "working-repo" || i.target.workingRepoId !== workingRepoId)
        ) {
          return false;
        }
        if (agent && i.agent !== agent) return false;
        if (type && i.artifactType !== type) return false;
        return true;
      });

      const allRepos = await deps.skillsRepos.list();
      const reposById = new Map(allRepos.map((r) => [r.id, r]));
      const allWorkingRepos = await deps.workingRepos.list();
      const workingReposById = new Map(allWorkingRepos.map((r) => [r.id, r]));

      const result = await Promise.all(
        filtered.map(async (install) => {
          const sr = reposById.get(install.sourceRepoId);
          if (!sr) return { ...install, status: "up-to-date", availableSha: null };
          try {
            const updateResult = await checkForUpdates(install, sr);
            let isDrifted = false;
            if (install.target.type === "working-repo") {
              const wr = workingReposById.get(install.target.workingRepoId);
              if (wr) {
                const driftResult = await checkForDrift(install, sr, wr.path);
                isDrifted = driftResult.isDrifted;
              }
            }
            const status = computeInstallStatus(updateResult.hasUpdate, isDrifted);
            return { ...install, status, availableSha: updateResult.availableSha };
          } catch {
            return { ...install, status: "up-to-date" as const, availableSha: null };
          }
        }),
      );

      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    },
  );

  server.tool(
    "install_artifact",
    "Install an artifact into a target (create-only; use update_install to move an existing install to a newer version). Agent defaults to favoriteAgent.",
    {
      artifactKey: z.string(),
      target: z.object({
        type: z.enum(["working-repo", "global"]),
        workingRepoId: z.string().optional(),
      }),
      agent: z.string().optional().describe("claude-code or cursor; defaults to favoriteAgent"),
      sha: z.string().optional().describe("Source SHA to install at; defaults to latest"),
      autoUpdate: z.boolean().optional(),
    },
    async ({ artifactKey, target, agent: agentParam, sha, autoUpdate }) => {
      if (target.type === "working-repo" && !target.workingRepoId) {
        return toolError("bad_input", "workingRepoId required for working-repo target");
      }
      const installTarget: InstallTarget =
        target.type === "working-repo"
          ? { type: "working-repo", workingRepoId: target.workingRepoId! }
          : { type: "global" };
      try {
        const persisted = await createInstall(deps, {
          artifactKey,
          target: installTarget,
          agent: agentParam as AgentId | undefined,
          sha,
          autoUpdate,
        });
        return { content: [{ type: "text" as const, text: JSON.stringify(persisted) }] };
      } catch (err) {
        return appErrorToToolError(err);
      }
    },
  );

  server.tool(
    "update_install",
    "Update an install to the newest available version. Refuses with drift_detected if the installed files have local edits; pass force to discard them.",
    {
      installId: z.string(),
      force: z.boolean().optional().describe("Discard local edits and update anyway"),
    },
    async ({ installId, force }) => {
      try {
        const { install } = await updateInstall(deps, { installId, force });
        return { content: [{ type: "text" as const, text: JSON.stringify(install) }] };
      } catch (err) {
        return appErrorToToolError(err);
      }
    },
  );

  server.tool(
    "reapply_install",
    "Re-apply an install at its current version, restoring the installed files from the source. Refuses with drift_detected if that would discard local edits; pass force to proceed.",
    {
      installId: z.string(),
      force: z.boolean().optional().describe("Discard local edits and re-apply anyway"),
    },
    async ({ installId, force }) => {
      try {
        const { install } = await reapplyInstall(deps, { installId, force });
        return { content: [{ type: "text" as const, text: JSON.stringify(install) }] };
      } catch (err) {
        return appErrorToToolError(err);
      }
    },
  );

  server.tool(
    "uninstall_artifact",
    "Remove an install: delete its installed files and forget the record. Refuses with drift_detected if the files have local edits; pass force to delete them anyway.",
    {
      installId: z.string(),
      force: z.boolean().optional().describe("Delete the files even if they have local edits"),
    },
    async ({ installId, force }) => {
      try {
        await removeInstall(deps, { installId, force });
        return { content: [{ type: "text" as const, text: JSON.stringify({ removed: installId }) }] };
      } catch (err) {
        return appErrorToToolError(err);
      }
    },
  );

  server.tool(
    "get_install_diff",
    "Show an install's differences as unified diff text: local edits (installed-vs-drifted, default) or what an update would change (installed-vs-latest)",
    {
      installId: z.string(),
      mode: z
        .enum(["installed-vs-drifted", "installed-vs-latest"])
        .optional()
        .describe("Defaults to installed-vs-drifted"),
    },
    async ({ installId, mode }) => {
      try {
        const result = await buildInstallDiff(deps, { installId, mode });
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (err) {
        return appErrorToToolError(err);
      }
    },
  );

  return server;
}
