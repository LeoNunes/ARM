// src/mcp/tools.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ServerDeps } from "../server.js";
import { discoverArtifacts } from "../discovery/discover.js";
import { readFileAtSha } from "../git/show.js";
import { recentShasTouching } from "../git/log.js";
import { GitClient } from "../git/client.js";
import { installArtifact } from "../engine/install.js";
import { checkForUpdates } from "../engine/update-check.js";
import { checkForDrift } from "../engine/drift-check.js";
import { computeInstallStatus } from "../engine/status.js";
import { AppError } from "../util/errors.js";
import type { AgentId, InstallTarget } from "../state/schema.js";

function toolError(code: string, message: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ code, message }) }],
    isError: true as const,
  };
}

async function discoverAll(deps: ServerDeps) {
  const sources = await deps.skillsRepos.list();
  const out = [];
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

  // remaining tools added in later tasks

  return server;
}
