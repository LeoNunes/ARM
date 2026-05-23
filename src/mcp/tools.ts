import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ServerDeps } from "../server.js";
import { discoverArtifacts } from "../discovery/discover.js";
import { readFileAtSha } from "../git/show.js";
import { recentShasTouching } from "../git/log.js";
import { GitClient } from "../git/client.js";
import type { DiscoveredArtifact } from "../adapters/types.js";

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
      const versionHistory = await recentShasTouching(repo.localClonePath, repo.branch, artifact.files);
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
      const content = await readFileAtSha(repo.localClonePath, resolvedSha, filePath);
      return { content: [{ type: "text" as const, text: content }] };
    },
  );

  // remaining tools added in later tasks

  return server;
}
