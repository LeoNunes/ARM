import type { FastifyInstance } from "fastify";
import type { ServerDeps } from '../server';
import { discoverArtifacts } from '../discovery/discover';
import { readFileAtSha } from '../git/show';
import { recentShasTouching } from '../git/log';
import { GitClient } from '../git/client';
import { AppError } from '../util/errors';
import type { DiscoveredArtifact } from '../adapters/types';

export async function registerArtifactsRoutes(app: FastifyInstance, deps: ServerDeps): Promise<void> {
  app.get<{ Querystring: { q?: string; type?: string; sourceRepoId?: string } }>(
    "/api/artifacts",
    async (req) => {
      const all = await discoverAll(deps);
      const { q, type, sourceRepoId } = req.query ?? {};
      return all.filter((a) => {
        if (sourceRepoId && a.sourceRepoId !== sourceRepoId) return false;
        if (type && a.type !== type) return false;
        if (q) {
          const needle = q.toLowerCase();
          if (!a.name.toLowerCase().includes(needle) && !(a.description ?? "").toLowerCase().includes(needle)) {
            return false;
          }
        }
        return true;
      });
    },
  );

  app.get<{ Params: { artifactKey: string } }>("/api/artifacts/:artifactKey", async (req, reply) => {
    const a = (await discoverAll(deps)).find((x) => x.artifactKey === decodeURIComponent(req.params.artifactKey));
    if (!a) return reply.code(404).send({ code: "artifact_not_found" });
    return a;
  });

  app.get<{ Params: { artifactKey: string; "*": string }; Querystring: { sha?: string } }>(
    "/api/artifacts/:artifactKey/files/*",
    async (req, reply) => {
      const key = decodeURIComponent(req.params.artifactKey);
      const filePath = (req.params as Record<string, string>)["*"] as string;
      const artifact = (await discoverAll(deps)).find((a) => a.artifactKey === key);
      if (!artifact) return reply.code(404).send({ code: "artifact_not_found" });
      if (!artifact.files.includes(filePath)) {
        throw new AppError("bad_input", `file not in artifact: ${filePath}`);
      }
      const repo = await deps.skillsRepos.get(artifact.sourceRepoId);
      if (!repo) return reply.code(404).send({ code: "skills_repo_not_found" });
      const sha = req.query.sha ?? artifact.lastTouchedSha ?? await new GitClient().headSha(repo.localClonePath, repo.branch);
      const content = await readFileAtSha(repo.localClonePath, sha, filePath);
      reply.header("content-type", "text/plain; charset=utf-8");
      return content;
    },
  );

  app.get<{ Params: { artifactKey: string }; Querystring: { limit?: string } }>(
    "/api/artifacts/:artifactKey/history",
    async (req, reply) => {
      const key = decodeURIComponent(req.params.artifactKey);
      const artifact = (await discoverAll(deps)).find((a) => a.artifactKey === key);
      if (!artifact) return reply.code(404).send({ code: "artifact_not_found" });
      const repo = await deps.skillsRepos.get(artifact.sourceRepoId);
      if (!repo) return reply.code(404).send({ code: "skills_repo_not_found" });
      const limit = Math.min(parseInt(req.query.limit ?? "20", 10) || 20, 100);
      const history = await recentShasTouching(repo.localClonePath, repo.branch, artifact.files, limit);
      return history;
    },
  );
}

async function discoverAll(deps: ServerDeps): Promise<DiscoveredArtifact[]> {
  const sources = await deps.skillsRepos.list();
  const out: DiscoveredArtifact[] = [];
  for (const s of sources) out.push(...(await discoverArtifacts(s, deps.registries.types)));
  return out;
}
