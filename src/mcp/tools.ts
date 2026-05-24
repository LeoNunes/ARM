import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ServerDeps } from "../server.js";
import { discoverArtifacts } from "../discovery/discover.js";
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

function toolError(code: string, message: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ code, message }) }],
    isError: true as const,
  };
}

async function discoverAll(deps: ServerDeps): Promise<DiscoveredArtifact[]> {
  const sources = await deps.skillsRepos.list();
  const out: DiscoveredArtifact[] = [];
  for (const s of sources) out.push(...(await discoverArtifacts(s, deps.registries.types)));
  return out;
}

export function createMcpServer(deps: ServerDeps): McpServer {
  const server = new McpServer({ name: "skills-manager", version: "0.1.0" });

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
      type: z.string().optional().describe("Filter by artifact type (e.g. skills)"),
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
      return { content: [{ type: "text" as const, text: JSON.stringify(filtered) }] };
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
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ ...artifact, versionHistory }) }],
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
      type: z.string().optional(),
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
    "Install an artifact into a target (create-only). Agent defaults to favoriteAgent.",
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
      try {
        const settings = await deps.settings.read();
        const agentId = (agentParam ?? settings.favoriteAgent) as AgentId | undefined;
        if (!agentId) {
          return toolError("agent_not_specified", "No agent specified and no favoriteAgent configured");
        }

        let agent;
        try {
          agent = deps.registries.agents.get(agentId);
        } catch {
          return toolError("bad_input", `unknown agent: ${agentId}`);
        }

        if (target.type === "working-repo" && !target.workingRepoId) {
          return toolError("bad_input", "workingRepoId required for working-repo target");
        }

        const installTarget: InstallTarget =
          target.type === "working-repo"
            ? { type: "working-repo", workingRepoId: target.workingRepoId! }
            : { type: "global" };

        const sources = await deps.skillsRepos.list();
        const [sourceRepoId] = artifactKey.split(":", 1);
        const skillsRepo = sources.find((s) => s.id === sourceRepoId);
        if (!skillsRepo) {
          return toolError("artifact_not_found", `source repo not found: ${sourceRepoId}`);
        }

        const allArtifacts = await discoverArtifacts(skillsRepo, deps.registries.types);
        const artifact = allArtifacts.find((a) => a.artifactKey === artifactKey);
        if (!artifact) return toolError("artifact_not_found", artifactKey);

        let workingRepo;
        if (installTarget.type === "working-repo") {
          workingRepo = await deps.workingRepos.get(installTarget.workingRepoId);
          if (!workingRepo) return toolError("working_repo_not_found", installTarget.workingRepoId);
        }

        const existing = await deps.installs.findExisting(artifactKey, installTarget, agentId);
        if (existing) {
          return toolError("already_installed", `${artifactKey} already installed for ${agentId}`);
        }

        const targetInstalls = workingRepo
          ? await deps.installs.listByWorkingRepo(workingRepo.id)
          : [];
        const resolvedSha = sha ?? artifact.lastTouchedSha;
        if (!resolvedSha) return toolError("bad_input", "could not resolve SHA for artifact");

        const record = await installArtifact({
          artifact, skillsRepo, target: installTarget, workingRepo, agent,
          sha: resolvedSha, autoUpdate: autoUpdate ?? false,
          existingInstallsInTarget: targetInstalls,
        });
        const persisted = await deps.installs.add(record);
        return { content: [{ type: "text" as const, text: JSON.stringify(persisted) }] };
      } catch (err) {
        if (err instanceof AppError) return toolError(err.code, err.message);
        throw err;
      }
    },
  );

  return server;
}
