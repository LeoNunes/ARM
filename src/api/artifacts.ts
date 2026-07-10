import type { FastifyInstance } from "fastify";
import type { ServerDeps } from '../server';
import { discoverArtifacts } from '../discovery/discover';
import { sortByFavorite } from '../discovery/sort';
import { readFileAtSha } from '../git/show';
import { recentShasTouching } from '../git/log';
import { GitClient } from '../git/client';
import { AppError } from '../util/errors';
import type { DiscoveredArtifact } from '../adapters/types';

async function repoNameMap(deps: ServerDeps): Promise<Map<string, string>> {
  const repos = await deps.skillsRepos.list();
  return new Map(repos.map((r) => [r.id, r.name]));
}

export async function registerArtifactsRoutes(app: FastifyInstance, deps: ServerDeps): Promise<void> {
  app.get<{ Querystring: { q?: string; type?: string; sourceRepoId?: string } }>(
    "/api/artifacts",
    async (req) => {
      const all = await discoverAll(deps);
      const { q, type, sourceRepoId } = req.query ?? {};
      const filtered = all.filter((a) => {
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
      const favorites = await deps.favorites.listFavorites();
      const sorted = sortByFavorite(filtered, favorites);
      const repoNames = await repoNameMap(deps);
      return sorted.map((a) => ({
        ...a,
        isFavorite: favorites.has(a.artifactKey),
        sourceName: repoNames.get(a.sourceRepoId)!,
      }));
    },
  );

  app.get<{ Params: { artifactKey: string } }>("/api/artifacts/:artifactKey", async (req, reply) => {
    const a = (await discoverAll(deps)).find((x) => x.artifactKey === decodeURIComponent(req.params.artifactKey));
    if (!a) return reply.code(404).send({ code: "artifact_not_found" });
    const isFavorite = await deps.favorites.isFavorite(a.artifactKey);
    const repoNames = await repoNameMap(deps);
    return { ...a, isFavorite, sourceName: repoNames.get(a.sourceRepoId)! };
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

  app.put<{ Params: { artifactKey: string } }>("/api/artifacts/:artifactKey/favorite", async (req, reply) => {
    const key = decodeURIComponent(req.params.artifactKey);
    const a = (await discoverAll(deps)).find((x) => x.artifactKey === key);
    if (!a) throw new AppError("artifact_not_found", `artifact not found: ${key}`);
    await deps.favorites.setFavorite(key, true);
    return reply.code(204).send();
  });

  app.delete<{ Params: { artifactKey: string } }>("/api/artifacts/:artifactKey/favorite", async (req, reply) => {
    const key = decodeURIComponent(req.params.artifactKey);
    const a = (await discoverAll(deps)).find((x) => x.artifactKey === key);
    if (!a) throw new AppError("artifact_not_found", `artifact not found: ${key}`);
    await deps.favorites.setFavorite(key, false);
    return reply.code(204).send();
  });
}

async function discoverAll(deps: ServerDeps): Promise<DiscoveredArtifact[]> {
  const sources = await deps.skillsRepos.list();
  const out: DiscoveredArtifact[] = [];
  for (const s of sources) out.push(...(await discoverArtifacts(s, deps.registries.types)));
  return out;
}
